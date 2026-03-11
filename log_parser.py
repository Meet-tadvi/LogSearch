"""
Log Parser Module
=================
Multi-format log parser with auto-detection and JSON caching.

Supported formats:
    1. pis_railway  — Railway PIS system
    2. wdog_system  — WDOG watchdog system

Key design decisions:
    - Extra fields hold genuinely format-specific data (e.g. 'priority').
    - Adding a new format: add one entry to LOG_FORMATS. Nothing else changes.
"""

import re
import json
import os
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from collections import Counter

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
    """

    # ── CORE ──────────────────────────────────────────────────────
    timestamp:           str
    message:             str
    raw_line:            str
    actual_line_number:  int

    # ── STANDARD (None if format doesn't have them) ───────────────
    component:   Optional[str] = None
    level:       Optional[str] = None
    thread_id:   Optional[str] = None   # stored as original string
    file_path:   Optional[str] = None
    line_number: Optional[int] = None

    # ── EXTRA (format-specific, no standard slot) ─────────────────
    extra_fields: dict = field(default_factory=dict)

    # ── FORMAT METADATA ───────────────────────────────────────────
    format_name: str = 'unknown'

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
        }

# ================================================================
# LogParser
# ================================================================

class LogParser:
    """
    Parses log files into LogEntry objects.
    Auto-detects format from a sample of the file.
    Saves/loads parsed data as JSON for fast repeated access.
    """

    LOG_FORMATS = {

        # ── Railway PIS System ────────────────────────────────────
        # 2025-04-17T08:35:19:981 |XRAIL :  nvramserialiser.cpp:15:():INFO:1:Found NvRam.
        'pis_railway': {
            'pattern': re.compile(
                r'(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}:\d{3})\s*\|'
                r'(?P<component>[^:]+?)\s*:\s*'
                r'(?P<file_path>[^:]+?):'
                r'(?P<line_number>\d+):\(\):'
                r'(?P<level>\w+):'
                r'(?P<thread_id>\d+):'
                r'(?P<message>.+)'
            ),
            'fields': [
                'timestamp', 'component', 'file_path',
                'line_number', 'level', 'thread_id', 'message'
            ],
            'description': 'Railway PIS system format',
            # level_map not needed — already uses INFO/WARNING/ERROR
        },

        # ── WDOG Watchdog System ──────────────────────────────────
        # 04-02 02:55:24.115 b72d6000  WDOG Inf p0 wdg_SystemAvai:0399 msg
        'wdog_system': {
            'pattern': re.compile(
                r'(?P<timestamp>\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+'
                r'(?P<thread_id>[0-9a-fA-F]{8})\s+'
                r'(?P<component>\S+)\s+'
                r'(?P<level>\w{3})\s+'
                r'(?P<priority>p\d+)\s+'
                r'(?P<file_path>[\w.]+):(?P<line_number>\d+)\s+'
                r'(?P<message>.+)'
            ),
            'fields': [
                'timestamp', 'thread_id', 'component',
                'level', 'priority', 'file_path', 'line_number', 'message'
            ],
            'description': 'WDOG watchdog system format',
            'level_map': {
                'Inf': 'INFO',
                'Err': 'ERROR',
                'Wrn': 'WARNING',
                'Dbg': 'DEBUG',
            },
            # NOTE: 'priority' is not in STANDARD_FIELDS → goes to extra_fields
        },
    }

    # Named groups in this set → LogEntry named attributes
    # Any group NOT in this set → LogEntry.extra_fields
    STANDARD_FIELDS = {
        'timestamp', 'component', 'file_path', 'line_number',
        'level', 'thread_id', 'message'
    }

    SEPARATOR_PATTERN = re.compile(r'^-{10,}$')

    def __init__(self):
        self.parsed_logs:           List[LogEntry] = []
        self.unparsed_lines:        List[dict]     = []   # {line_number, content}
        self.active_format:         Optional[str]  = None
        self.available_fields:      List[str]      = []
        self.detection_confidence:  float          = 0.0  # 0–100 percent

    # ── Format Detection ─────────────────────────────────────────

    def detect_format(self, lines: List[str]) -> Optional[str]:
        """
        Stratified sampling: draws candidates from beginning, middle, and end
        of the file so that long headers / comment blocks don't skew the result.

        Requires ≥30 % match rate to declare a winner (vs old "any match").
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

        if scores[best] < 0.30:          # require at least 30 % match rate
            self.detection_confidence = round(scores[best] * 100, 1)
            return None

        self.detection_confidence = round(scores[best] * 100, 1)
        return best

    # ── Entry Extraction ─────────────────────────────────────────

    def extract_entry(self, match, fmt_name: str,
                      actual_line_number: int) -> LogEntry:
        """
        Build a LogEntry from a regex match.

        Standard named groups  → LogEntry named attributes
        Extra named groups     → LogEntry.extra_fields

        level_map is applied when the format defines abbreviated level names.
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
        # No int conversion. 'b72d6000' stays 'b72d6000'. '1' stays '1'.
        # This is simpler, more readable, and requires no extra_fields copy.
        thread_id = None
        if 'thread_id' in fmt_fields and groups.get('thread_id'):
            thread_id = groups['thread_id'].strip() or None

        # ── extra fields ──────────────────────────────────────────
        # Any regex group NOT in STANDARD_FIELDS goes here.
        # e.g. wdog 'priority' → extra_fields['priority'] = 'p0'
        extra_fields = {}
        for key, value in groups.items():
            if key not in self.STANDARD_FIELDS and value is not None:
                extra_fields[key] = value.strip() if isinstance(value, str) else value

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

    # ── File Parsing ──────────────────────────────────────────────

    def parse_file(self, file_path: str,
                   max_lines: Optional[int] = None) -> List[LogEntry]:
        """
        Parse a log file with auto format detection.
        Returns list of LogEntry objects.
        """
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        if max_lines:
            lines = lines[:max_lines]

        self.active_format = self.detect_format(lines)
        if not self.active_format:
            raise ValueError(
                "Could not detect log format. "
                "Please add a new format to LogParser.LOG_FORMATS."
            )

        active_pattern = self.LOG_FORMATS[self.active_format]['pattern']
        fmt_fields     = self.LOG_FORMATS[self.active_format]['fields']
        self.available_fields = [f for f in fmt_fields if f in self.STANDARD_FIELDS]

        for idx, line in enumerate(lines, 1):
            entry = self._parse_line(line, actual_line_number=idx,
                                     pattern=active_pattern)
            if entry:
                self.parsed_logs.append(entry)

        return self.parsed_logs

    # ── Metadata ─────────────────────────────────────────────────

    def get_log_metadata(self) -> Dict:
        """
        Return real values found in the parsed logs.
        Used by SearchOperations (index building) and the Streamlit UI (filter options).
        """
        if not self.parsed_logs:
            return {}

        components = sorted(set(l.component for l in self.parsed_logs if l.component))
        levels     = sorted(set(l.level     for l in self.parsed_logs if l.level))
        thread_ids = sorted(set(l.thread_id for l in self.parsed_logs if l.thread_id))

        extra_field_keys = set()
        for log in self.parsed_logs:
            extra_field_keys.update(log.extra_fields.keys())

        return {
            'format_name':      self.active_format,
            'available_fields': self.available_fields,
            'extra_field_keys': sorted(extra_field_keys),
            'components':       components,
            'levels':           levels,
            'thread_ids':       thread_ids,
        }

    # ── JSON Cache ────────────────────────────────────────────────

    def save_to_json(self, output_path: str):
        """Save parsed logs + format metadata to JSON cache."""
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        cache = {
            'metadata': {
                'format_name':      self.active_format,
                'available_fields': self.available_fields,
                'total_entries':    len(self.parsed_logs),
            },
            'logs': [log.to_dict() for log in self.parsed_logs]
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)

    def load_from_json(self, json_path: str) -> List[LogEntry]:
        """Load previously parsed logs from JSON cache."""
        with open(json_path, 'r', encoding='utf-8') as f:
            cache = json.load(f)

        meta = cache.get('metadata', {})
        self.active_format    = meta.get('format_name', 'unknown')
        self.available_fields = meta.get('available_fields', [])

        self.parsed_logs = []
        for d in cache['logs']:
            entry = LogEntry(
                timestamp          = d['timestamp'],
                message            = d['message'],
                raw_line           = d['raw_line'],
                actual_line_number = d['actual_line_number'],
                component          = d.get('component'),
                level              = d.get('level'),
                thread_id          = d.get('thread_id'),   # already a string
                file_path          = d.get('file_path'),
                line_number        = d.get('line_number'),
                extra_fields       = d.get('extra_fields', {}),
                format_name        = d.get('format_name', self.active_format),
            )
            self.parsed_logs.append(entry)

        return self.parsed_logs

    # ── Statistics ────────────────────────────────────────────────

    def get_statistics(self) -> Dict:
        if not self.parsed_logs:
            return {}
        components = Counter(l.component for l in self.parsed_logs if l.component)
        levels     = Counter(l.level     for l in self.parsed_logs if l.level)
        files      = Counter(l.file_path for l in self.parsed_logs if l.file_path)
        return {
            'total_entries': len(self.parsed_logs),
            'format':        self.active_format,
            'time_range': {
                'start': self.parsed_logs[0].timestamp  if self.parsed_logs else None,
                'end':   self.parsed_logs[-1].timestamp if self.parsed_logs else None,
            },
            'components': dict(components.most_common()),
            'log_levels': dict(levels),
            'top_files':  dict(files.most_common(10)),
        }