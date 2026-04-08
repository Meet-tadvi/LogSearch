"""
Log Parser Module — v3
======================
Fully dynamic field-based parser.

No fixed LogEntry attributes, no level_map, no timestamp_format,
no ISO normalisation, no cross-file sorting by timestamp.

Field types (used only as UI hints — values stored exactly as parsed):
    timestamp  -> raw string, drives time-range filter
    level      -> raw string, drives colour-coded multiselect
    text       -> raw string, drives multiselect dropdown
    number     -> raw string, drives min/max filter
    message    -> raw string, drives text search
"""

import re
import json
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from pathlib import Path
from collections import Counter


# ================================================================
# LogEntry — fully dynamic
# ================================================================

@dataclass
class LogEntry:
    """
    One parsed log line. All field values live in `fields` dict.
    Keys and value types depend entirely on the format definition.

    pis_railway example:
        fields = {
            'timestamp':   '2025-04-17T08:35:19:981',
            'component':   'XRAIL',
            'file_path':   'nvramserialiser.cpp',
            'line_number': '15',
            'level':       'INFO',
            'thread_id':   '1',
            'message':     'Found NvRam.',
        }

    wdog_system example:
        fields = {
            'timestamp':   '04-02 02:55:24.115',
            'thread_id':   'b72d6000',
            'component':   'WDOG',
            'level':       'Inf',
            'priority':    'p0',
            'file_path':   'wdg_SystemAvai',
            'line_number': '0399',
            'message':     'System available',
        }
    """
    actual_line_number: int
    raw_line:           str
    format_name:        str
    fields:             dict = field(default_factory=dict)
    source_file:        str  = ''   # set by session_store after parsing

    def to_dict(self) -> Dict:
        return {
            'actual_line_number': self.actual_line_number,
            'raw_line':           self.raw_line,
            'format_name':        self.format_name,
            'source_file':        self.source_file,
            'fields':             dict(self.fields),
        }


# ================================================================
# Format loading / saving
# ================================================================

_DEFAULT_FORMATS_PATH = Path(__file__).parent / 'log_formats.json'

_BUILTIN_FORMATS_RAW = {
    "pis_railway": {
        "description": "Railway PIS system logs",
        "pattern": r"(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}:\d{3})\s*\|(?P<component>[^:]+?)\s*:\s*(?P<file_path>[^:]+?):(?P<line_number>\d+):\(\):(?P<level>\w+):(?P<thread_id>\d+):(?P<message>.+)",
        "fields": [
            {"name": "timestamp",   "type": "timestamp"},
            {"name": "component",   "type": "text"},
            {"name": "file_path",   "type": "text"},
            {"name": "line_number", "type": "number"},
            {"name": "level",       "type": "level"},
            {"name": "thread_id",   "type": "text"},
            {"name": "message",     "type": "message"},
        ],
        "example": "2025-04-17T08:35:19:981 |XRAIL :  nvramserialiser.cpp:15:():INFO:1:Found NvRam."
    },
    "wdog_system": {
        "description": "WDOG watchdog system logs",
        "pattern": r"(?P<timestamp>\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(?P<thread_id>[0-9a-fA-F]{8})\s+(?P<component>\S+)\s+(?P<level>\w{3})\s+(?P<priority>p\d+)\s+(?P<file_path>[\w.]+):(?P<line_number>\d+)\s+(?P<message>.+)",
        "fields": [
            {"name": "timestamp",   "type": "timestamp"},
            {"name": "thread_id",   "type": "text"},
            {"name": "component",   "type": "text"},
            {"name": "level",       "type": "level"},
            {"name": "priority",    "type": "text"},
            {"name": "file_path",   "type": "text"},
            {"name": "line_number", "type": "number"},
            {"name": "message",     "type": "message"},
        ],
        "example": "04-02 02:55:24.115 b72d6000  WDOG Inf p0 wdg_SystemAvai:0399 System available"
    }
}


def _compile_formats(raw: Dict) -> Dict:
    """Compile raw dicts — adds compiled regex and field_map lookup."""
    compiled = {}
    for name, cfg in raw.items():
        field_list = cfg.get('fields', [])
        compiled[name] = {
            **cfg,
            'pattern':   re.compile(cfg['pattern']),
            'field_map': {f['name']: f['type'] for f in field_list},
        }
    return compiled


def load_formats(path: Path = _DEFAULT_FORMATS_PATH) -> Dict:
    """Load and compile formats from JSON. Falls back to built-ins if file missing."""
    if path.exists():
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            return _compile_formats(raw)
        except Exception as e:
            print(f'[LogParser] Warning: could not load {path}: {e}. Using built-ins.')
    return _compile_formats(_BUILTIN_FORMATS_RAW)


def save_formats(raw: Dict, path: Path = _DEFAULT_FORMATS_PATH):
    """Save raw (non-compiled) format definitions to JSON."""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(raw, f, indent=2)


def get_raw_formats(path: Path = _DEFAULT_FORMATS_PATH) -> Dict:
    """Return raw (non-compiled) format definitions for API responses."""
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return dict(_BUILTIN_FORMATS_RAW)


# ================================================================
# LogParser
# ================================================================

class LogParser:
    """
    Parses log files into LogEntry objects using dynamic field definitions.

    Format auto-detected via stratified sampling (beginning + middle + end).
    All field values stored exactly as captured — no normalisation.
    """

    SEPARATOR_PATTERN = re.compile(r'^[-=]{10,}$')

    def __init__(self, formats_path: Path = _DEFAULT_FORMATS_PATH):
        self._formats_path          = formats_path
        self.LOG_FORMATS            = load_formats(formats_path)
        self.parsed_logs:           List[LogEntry] = []
        self.unparsed_lines:        List[Dict]     = []
        self.active_format:         Optional[str]  = None
        self.field_definitions:     List[Dict]     = []   # [{name, type}, ...]
        self.field_map:             Dict[str, str] = {}   # {name: type}
        self.detection_confidence:  float          = 0.0

    def reload_formats(self):
        """Reload formats from disk without restarting the server."""
        self.LOG_FORMATS = load_formats(self._formats_path)

    # ── Format detection ──────────────────────────────────────────

    def detect_format(self, lines: List[str]) -> Optional[str]:
        """
        Stratified sampling across beginning, middle, and end of file.
        Requires >= 30% match rate to declare a winner.
        Avoids false positives from header/comment blocks at the top of files.
        """
        n       = len(lines)
        indices = (
            list(range(min(10, n)))
            + list(range(n // 2, min(n // 2 + 10, n)))
            + list(range(max(0, n - 10), n))
        )
        # Deduplicate while preserving order
        sample = [lines[i] for i in dict.fromkeys(indices)]

        scores = {}
        for fmt_name, fmt in self.LOG_FORMATS.items():
            scores[fmt_name] = sum(
                1 for line in sample
                if line.strip() and fmt['pattern'].match(line.strip())
            )

        if not scores:
            self.detection_confidence = 0.0
            return None

        best_name  = max(scores, key=scores.get)
        best_score = scores[best_name]
        total      = sum(1 for l in sample if l.strip())
        confidence = (best_score / total * 100) if total else 0

        self.detection_confidence = round(confidence, 1)
        return best_name if confidence >= 30 else None

    # ── Entry extraction ──────────────────────────────────────────

    def extract_entry(
        self,
        match:              re.Match,
        fmt_name:           str,
        actual_line_number: int,
    ) -> LogEntry:
        """
        Build a LogEntry from a regex match object.
        All captured group values stripped of whitespace.
        No normalisation — values stored exactly as they appear in the log.
        """
        groups = match.groupdict()
        parsed_fields = {
            name: value.strip()
            for name, value in groups.items()
            if value is not None
        }
        return LogEntry(
            actual_line_number = actual_line_number,
            raw_line           = match.string.strip(),
            format_name        = fmt_name,
            fields             = parsed_fields,
        )

    # ── Single line parsing ───────────────────────────────────────

    def _parse_line(
        self,
        line:               str,
        actual_line_number: int,
        pattern:            re.Pattern,
    ) -> Optional[LogEntry]:
        """
        Try to parse one log line.
        Blank lines and separator lines (-----) are silently skipped.
        Lines that don't match the pattern go into unparsed_lines.
        """
        line = line.strip()
        if not line or self.SEPARATOR_PATTERN.match(line):
            return None

        match = pattern.match(line)
        if match:
            return self.extract_entry(match, self.active_format, actual_line_number)

        # Store unparsed lines for export and future reference
        self.unparsed_lines.append({
            'line_number': actual_line_number,
            'content':     line,
        })
        return None

    # ── Full file parse ───────────────────────────────────────────

    def parse_file(
        self,
        file_path: str,
        max_lines: Optional[int] = None,
    ) -> List[LogEntry]:
        """
        Synchronous parse — reads entire file, returns all LogEntry objects.
        Used by the upload endpoint.
        Enforces 200 MB cap.
        """
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        if max_lines:
            lines = lines[:max_lines]

        # Rough 200 MB cap by line count
        total_bytes = sum(len(l.encode('utf-8')) for l in lines)
        if total_bytes > 200 * 1024 * 1024:
            # Keep first ~half — rough proportional trim
            ratio = (200 * 1024 * 1024) / total_bytes
            lines = lines[:int(len(lines) * ratio)]

        self.active_format = self.detect_format(lines)
        if not self.active_format:
            raise ValueError(
                f'Could not detect log format '
                f'(best confidence: {self.detection_confidence:.1f}%). '
                f'Define the format in the Formats tab and re-upload.'
            )

        fmt                    = self.LOG_FORMATS[self.active_format]
        active_pattern         = fmt['pattern']
        self.field_definitions = fmt.get('fields', [])
        self.field_map         = fmt.get('field_map', {})

        for idx, line in enumerate(lines, 1):
            entry = self._parse_line(line, idx, active_pattern)
            if entry:
                self.parsed_logs.append(entry)

        return self.parsed_logs

    # ── Metadata ──────────────────────────────────────────────────

    def get_log_metadata(self) -> Dict:
        """
        Returns field_definitions and distinct values for every
        text / level / number field.
        Used by session_store and the /api/metadata endpoint to
        populate sidebar filter dropdowns dynamically.
        """
        distinct: Dict[str, set] = {}
        for entry in self.parsed_logs:
            for fname, ftype in self.field_map.items():
                if ftype in ('text', 'level', 'number'):
                    val = entry.fields.get(fname)
                    if val:
                        distinct.setdefault(fname, set()).add(val)

        return {
            'format_name':          self.active_format,
            'detection_confidence': self.detection_confidence,
            'field_definitions':    self.field_definitions,
            'field_map':            self.field_map,
            'distinct_values': {
                k: sorted(v) for k, v in distinct.items()
            },
        }
