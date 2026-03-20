"""
Log Parser Module
=================
Multi-format log parser. Formats are loaded from log_formats.json at startup
and can be reloaded at runtime without a server restart.

Key design decisions:
    - thread_id stored as original string — 'b72d6000' stays 'b72d6000'.
    - Extra fields hold format-specific data (e.g. 'priority').
    - detect_format uses stratified sampling (beginning + middle + end of file)
      and requires a >=30% match rate to avoid false positives.
    - timestamp_dt: each entry gets an ISO-normalised timestamp for
      cross-file chronological sorting (uses timestamp_format from JSON).
    - unparsed_lines stores {line_number, content} dicts — never plain strings.
"""

import re
import json
import os
from datetime import datetime
from typing import List, Dict, Optional, AsyncGenerator
from dataclasses import dataclass, field
from collections import Counter
from pathlib import Path


# ================================================================
# LogEntry
# ================================================================

@dataclass
class LogEntry:
    """
    Structured log entry for any log format.

    Core fields     : always present
    Standard fields : None when the format does not have them
    Extra fields    : format-specific data (e.g. priority, host)
    timestamp_dt    : ISO-normalised timestamp for cross-file sorting
    """

    # ── CORE ──────────────────────────────────────────────────────
    timestamp:           str
    message:             str
    raw_line:            str
    actual_line_number:  int

    # ── STANDARD (None if format doesn't have them) ───────────────
    component:    Optional[str] = None
    level:        Optional[str] = None
    thread_id:    Optional[str] = None
    file_path:    Optional[str] = None
    line_number:  Optional[int] = None

    # ── EXTRA (format-specific, no standard slot) ─────────────────
    extra_fields: dict = field(default_factory=dict)

    # ── FORMAT METADATA ───────────────────────────────────────────
    format_name:  str = 'unknown'

    # ── NORMALISED TIMESTAMP for cross-file sort ──────────────────
    timestamp_dt: Optional[str] = None   # ISO format, e.g. '2025-04-17T08:35:19.981000'

    # ── SOURCE FILE — which uploaded file this entry came from ────
    # Set by the API layer after parsing, not by the parser itself.
    # Enables multi-file search and the Source File column in results.
    source_file: str = ''

    def to_dict(self) -> Dict:
        return {
            'timestamp':          self.timestamp,
            'message':            self.message,
            'raw_line':           self.raw_line,
            'actual_line_number': self.actual_line_number,
            'component':          self.component,
            'level':              self.level,
            'thread_id':          self.thread_id,
            'file_path':          self.file_path,
            'line_number':        self.line_number,
            'extra_fields':       self.extra_fields,
            'format_name':        self.format_name,
            'timestamp_dt':       self.timestamp_dt,
            'source_file':        self.source_file,
        }


# ================================================================
# LogParser
# ================================================================

# Hardcoded fallback in case log_formats.json is missing
_BUILTIN_FORMATS_RAW = {
    "pis_railway": {
        "description": "Railway PIS system logs",
        "pattern": r"(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}:\d{3})\s*\|(?P<component>[^:]+?)\s*:\s*(?P<file_path>[^:]+?):(?P<line_number>\d+):\(\):(?P<level>\w+):(?P<thread_id>\d+):(?P<message>.+)",
        "fields": ["timestamp", "component", "file_path", "line_number", "level", "thread_id", "message"],
        "level_map": {},
        "timestamp_format": "%Y-%m-%dT%H:%M:%S:%f",
        "example": "2025-04-17T08:35:19:981 |XRAIL :  nvramserialiser.cpp:15:():INFO:1:Found NvRam."
    },
    "wdog_system": {
        "description": "WDOG watchdog system logs",
        "pattern": r"(?P<timestamp>\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(?P<thread_id>[0-9a-fA-F]{8})\s+(?P<component>\S+)\s+(?P<level>\w{3})\s+(?P<priority>p\d+)\s+(?P<file_path>[\w.]+):(?P<line_number>\d+)\s+(?P<message>.+)",
        "fields": ["timestamp", "thread_id", "component", "level", "priority", "file_path", "line_number", "message"],
        "level_map": {"Inf": "INFO", "Err": "ERROR", "Wrn": "WARNING", "Dbg": "DEBUG"},
        "timestamp_format": "%m-%d %H:%M:%S.%f",
        "example": "04-02 02:55:24.115 b72d6000  WDOG Inf p0 wdg_SystemAvai:0399 System available"
    }
}

# Default path — same directory as this file
_DEFAULT_FORMATS_PATH = Path(__file__).parent / "log_formats.json"


def _compile_formats(raw: Dict) -> Dict:
    """Compile raw format dicts (pattern strings) into usable dicts with compiled regex."""
    compiled = {}
    for name, cfg in raw.items():
        compiled[name] = {
            **cfg,
            'pattern': re.compile(cfg['pattern']),
        }
    return compiled


def load_formats(path: Path = _DEFAULT_FORMATS_PATH) -> Dict:
    """
    Load formats from JSON file. Falls back to built-ins if file is missing.
    Returns compiled format dict ready for use by LogParser.
    """
    if path.exists():
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            return _compile_formats(raw)
        except Exception as e:
            print(f"[LogParser] Warning: could not load {path}: {e}. Using built-in formats.")
    return _compile_formats(_BUILTIN_FORMATS_RAW)


def save_formats(raw: Dict, path: Path = _DEFAULT_FORMATS_PATH):
    """
    Save raw (non-compiled) format definitions to JSON.
    Used by the /api/formats POST endpoint.
    """
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(raw, f, indent=2)


def get_raw_formats(path: Path = _DEFAULT_FORMATS_PATH) -> Dict:
    """Return raw (non-compiled) format definitions from the JSON file."""
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return dict(_BUILTIN_FORMATS_RAW)


class LogParser:
    """
    Parses log files into LogEntry objects.
    Auto-detects format from a stratified sample of the file.
    Format definitions are loaded from log_formats.json at construction time.
    Call reload_formats() to pick up runtime changes without restarting.
    """

    # Named groups in this set → LogEntry named attributes
    # Any group NOT in this set → LogEntry.extra_fields
    STANDARD_FIELDS = {
        'timestamp', 'component', 'file_path', 'line_number',
        'level', 'thread_id', 'message'
    }

    SEPARATOR_PATTERN = re.compile(r'^-{10,}$')

    def __init__(self, formats_path: Path = _DEFAULT_FORMATS_PATH):
        self._formats_path        = formats_path
        self.LOG_FORMATS          = load_formats(formats_path)
        self.parsed_logs:         List[LogEntry]  = []
        self.unparsed_lines:      List[Dict]      = []   # {line_number, content}
        self.active_format:       Optional[str]   = None
        self.available_fields:    List[str]        = []
        self.detection_confidence: float          = 0.0

    def reload_formats(self):
        """
        Reload format definitions from disk without restarting.
        Called by the /api/formats POST/DELETE endpoints.
        """
        self.LOG_FORMATS = load_formats(self._formats_path)

    # ── Format Detection ─────────────────────────────────────────

    def detect_format(self, lines: List[str]) -> Optional[str]:
        """
        Stratified sampling: draws candidates from beginning, middle, and end
        of the file so that long headers / comment blocks don't skew the result.
        Requires >=30% match rate to declare a winner.
        Stores detection_confidence (0–100) for UI display.
        """
        def _extract_zone(zone_lines):
            return [
                l.strip() for l in zone_lines
                if l.strip()
                and not self.SEPARATOR_PATTERN.match(l.strip())
                and not l.strip().startswith('#')
                and len(l.strip()) > 10
            ]

        n   = len(lines)
        mid = n // 2
        candidates = (
            _extract_zone(lines[:100])
            + _extract_zone(lines[max(0, mid - 50): mid + 50])
            + _extract_zone(lines[-100:])
        )

        # deduplicate while preserving order
        seen, sample = set(), []
        for l in candidates:
            if l not in seen:
                seen.add(l)
                sample.append(l)
        sample = sample[:150]

        if not sample:
            self.detection_confidence = 0.0
            return None

        scores = {}
        for fmt_name, fmt in self.LOG_FORMATS.items():
            matched = sum(1 for line in sample if fmt['pattern'].match(line))
            scores[fmt_name] = matched / len(sample)

        best = max(scores, key=scores.get)

        self.detection_confidence = round(scores[best] * 100, 1)
        if scores[best] < 0.30:
            return None

        return best

    # ── Timestamp Normalisation ───────────────────────────────────

    def _normalise_timestamp(self, raw: str, fmt_name: str) -> Optional[str]:
        """
        Convert a raw timestamp string to ISO format using the
        timestamp_format defined in log_formats.json.
        Returns None if parsing fails — the entry is still inserted,
        just without a sortable timestamp_dt.
        """
        ts_fmt = self.LOG_FORMATS[fmt_name].get('timestamp_format')
        if not ts_fmt:
            return None
        try:
            dt = datetime.strptime(raw.strip(), ts_fmt)
            return dt.isoformat()
        except ValueError:
            return None

    # ── Entry Extraction ─────────────────────────────────────────

    def extract_entry(self, match, fmt_name: str,
                      actual_line_number: int) -> LogEntry:
        """
        Build a LogEntry from a regex match.
        Standard named groups  → LogEntry named attributes
        Extra named groups     → LogEntry.extra_fields
        timestamp_dt           → ISO-normalised via timestamp_format
        """
        fmt        = self.LOG_FORMATS[fmt_name]
        fmt_fields = fmt['fields']
        groups     = match.groupdict()

        # ── core fields ───────────────────────────────────────────
        timestamp = (groups.get('timestamp') or '').strip()
        message   = (groups.get('message')   or '').strip() if 'message' in fmt_fields else ''

        # ── component ─────────────────────────────────────────────
        component = None
        if 'component' in fmt_fields and groups.get('component'):
            component = groups['component'].strip() or None

        # ── file_path ─────────────────────────────────────────────
        file_path = None
        if 'file_path' in fmt_fields and groups.get('file_path'):
            file_path = groups['file_path'].strip() or None

        # ── level (with optional level_map) ───────────────────────
        level = None
        if 'level' in fmt_fields and groups.get('level'):
            raw_level = groups['level'].strip()
            level_map = fmt.get('level_map', {})
            level     = level_map.get(raw_level, raw_level.upper()) or None

        # ── line_number (source code line) ────────────────────────
        line_number = None
        if 'line_number' in fmt_fields and groups.get('line_number'):
            try:
                line_number = int(groups['line_number'])
            except (ValueError, TypeError):
                pass

        # ── thread_id — stored as original string ─────────────────
        thread_id = None
        if 'thread_id' in fmt_fields and groups.get('thread_id'):
            thread_id = groups['thread_id'].strip() or None

        # ── extra fields ──────────────────────────────────────────
        extra_fields = {}
        for key, value in groups.items():
            if key not in self.STANDARD_FIELDS and value is not None:
                extra_fields[key] = value.strip() if isinstance(value, str) else value

        # ── ISO-normalised timestamp ───────────────────────────────
        timestamp_dt = self._normalise_timestamp(timestamp, fmt_name) if timestamp else None

        return LogEntry(
            timestamp          = timestamp,
            message            = message,
            raw_line           = match.string.strip(),
            actual_line_number = actual_line_number,
            component          = component,
            level              = level,
            thread_id          = thread_id,
            file_path          = file_path,
            line_number        = line_number,
            extra_fields       = extra_fields,
            format_name        = fmt_name,
            timestamp_dt       = timestamp_dt,
        )

    # ── Line Parsing ──────────────────────────────────────────────

    def _parse_line(self, line: str, actual_line_number: int,
                    pattern) -> Optional[LogEntry]:
        line = line.strip()
        if not line:
            return None
        if self.SEPARATOR_PATTERN.match(line):
            return None
        match = pattern.match(line)
        if match:
            return self.extract_entry(match, self.active_format, actual_line_number)
        else:
            self.unparsed_lines.append({
                'line_number': actual_line_number,
                'content':     line,
            })
            return None

    # ── Streaming File Parser ─────────────────────────────────────

    async def parse_file_stream(    
        self,
        file_path: str,
        progress_callback=None,
        batch_size: int = 1000,
        max_bytes: int = 200 * 1024 * 1024,  # 200 MB hard cap
    ) -> AsyncGenerator[List[LogEntry], None]:
        """
        Async generator that parses a file and yields batches of LogEntry objects.
        Calls progress_callback(pct, parsed, total_lines) after each batch.
        Used by the FastAPI parse endpoint to stream entries into SQLite
        without holding the full list in RAM.

        Usage:
            async for batch in parser.parse_file_stream(path, callback):
                await db.insert_batch(batch, source_file)
        """
        # ── Read all lines (but honour the byte cap) ──────────────
        lines = []
        bytes_read = 0
        truncated  = False
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                bytes_read += len(line.encode('utf-8'))
                if bytes_read > max_bytes:
                    truncated = True
                    break
                lines.append(line)

        total_lines = len(lines)

        # ── Format detection ──────────────────────────────────────
        self.active_format = self.detect_format(lines)
        if not self.active_format:
            raise ValueError(
                f"Could not detect log format "
                f"(best confidence: {self.detection_confidence:.1f}%). "
                f"Add the format to log_formats.json and re-upload."
            )

        active_pattern    = self.LOG_FORMATS[self.active_format]['pattern']
        fmt_fields        = self.LOG_FORMATS[self.active_format]['fields']
        self.available_fields = [f for f in fmt_fields if f in self.STANDARD_FIELDS]

        # ── Parse in batches, yield each batch ────────────────────
        batch = []
        for idx, line in enumerate(lines, 1):
            entry = self._parse_line(line, actual_line_number=idx,
                                     pattern=active_pattern)
            if entry:
                batch.append(entry)

            if len(batch) >= batch_size:
                yield batch
                parsed_so_far = idx
                pct = int(parsed_so_far / total_lines * 100) if total_lines else 100
                if progress_callback:
                    await progress_callback(pct, parsed_so_far, total_lines)
                batch = []

        # Yield final partial batch
        if batch:
            yield batch

        if progress_callback:
            await progress_callback(100, total_lines, total_lines)

    # ── Synchronous parse (kept for compatibility / testing) ──────

    def parse_file(self, file_path: str,
                   max_lines: Optional[int] = None) -> List[LogEntry]:
        """
        Synchronous parse. Returns full list of LogEntry objects.
        Used in tests and CLI tools. Production uses parse_file_stream().
        """
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        if max_lines:
            lines = lines[:max_lines]

        self.active_format = self.detect_format(lines)
        if not self.active_format:
            raise ValueError("Could not detect log format.")

        active_pattern    = self.LOG_FORMATS[self.active_format]['pattern']
        fmt_fields        = self.LOG_FORMATS[self.active_format]['fields']
        self.available_fields = [f for f in fmt_fields if f in self.STANDARD_FIELDS]

        for idx, line in enumerate(lines, 1):
            entry = self._parse_line(line, actual_line_number=idx,
                                     pattern=active_pattern)
            if entry:
                self.parsed_logs.append(entry)

        return self.parsed_logs

    # ── Metadata ─────────────────────────────────────────────────

    def get_log_metadata(self) -> Dict:
        """Return distinct values found in parsed_logs. Used in tests."""
        if not self.parsed_logs:
            return {}

        components     = sorted(set(l.component for l in self.parsed_logs if l.component))
        levels         = sorted(set(l.level     for l in self.parsed_logs if l.level))
        thread_ids     = sorted(set(l.thread_id for l in self.parsed_logs if l.thread_id))
        extra_field_keys = set()
        for log in self.parsed_logs:
            extra_field_keys.update(log.extra_fields.keys())

        return {
            'format_name':         self.active_format,
            'detection_confidence': self.detection_confidence,
            'available_fields':    self.available_fields,
            'extra_field_keys':    sorted(extra_field_keys),
            'components':          components,
            'levels':              levels,
            'thread_ids':          thread_ids,
        }   