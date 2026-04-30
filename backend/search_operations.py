"""
Search Operations Module — v3
==============================
Fully dynamic — indices and filters built from field_definitions.
No hardcoded field names anywhere.

filter dict shape: { field_name: [allowed_value, ...] }
  e.g. {"level": ["INFO", "ERROR"], "component": ["GPS", "XRAIL"]}
"""

from typing import List, Dict, Optional, Set
from collections import Counter
from log_parser import LogEntry


class SearchOperations:
    """
    Builds one index per field, searches via single-pass AND logic.

    field_definitions drives everything:
        - which indices are built
        - which fields appear in get_distinct_values()
        - which field is the timestamp (for time-range filtering)
        - which field is the message (for text search context)
    """

    def __init__(
        self,
        logs:              List[LogEntry],
        field_definitions: List[Dict],       # [{name, type}, ...]
    ):
        self.logs              = logs
        self.field_definitions = field_definitions
        self.field_map: Dict[str, str] = {
            f['name']: f['type'] for f in field_definitions
        }

        # Which field name carries each special role (None if absent)
        self.timestamp_field = self._field_of_type('timestamp')
        self.message_field   = self._field_of_type('message')



    # ── Helpers ───────────────────────────────────────────────────

    def _field_of_type(self, ftype: str) -> Optional[str]:
        """Return the name of the first field with the given type, or None."""
        for f in self.field_definitions:
            if f['type'] == ftype:
                return f['name']
        return None

    # ── Metadata for sidebar ──────────────────────────────────────

    def get_distinct_values(self) -> Dict[str, List[str]]:
        """
        Return distinct values for every text / level / number field.
        Used by /api/metadata to populate sidebar filter dropdowns.

        Returns original-case values sorted alphabetically:
            {
              "level":     ["DEBUG", "ERROR", "INFO", "WARNING"],
              "component": ["DIAG", "GPS", "SCHED", "XRAIL"],
              "priority":  ["p0", "p1", "p2"],
              ...
            }
        """
        filterable = {
            f['name'] for f in self.field_definitions
            if f['type'] in ('text', 'level', 'number')
        }
        result = {}
        for fname in filterable:
            values = sorted(set(
                e.fields[fname]
                for e in self.logs
                if e.fields.get(fname)
            ))
            if values:
                result[fname] = values
        return result

    # ── Line operations ───────────────────────────────────────────

    def get_line(self, line_number: int) -> Optional[Dict]:
        for entry in self.logs:
            if entry.actual_line_number == line_number:
                return entry.to_dict()
        return None

    def get_first_n(self, n: int) -> List[Dict]:
        return [e.to_dict() for e in self.logs[:n]]

    def get_last_n(self, n: int) -> List[Dict]:
        return [e.to_dict() for e in self.logs[-n:]]

    # ── Combined filter — single-pass AND logic ───────────────────

    def find_combined(
        self,
        text:           Optional[str]                  = None,
        filters:        Optional[Dict[str, List[str]]] = None,
        start_time:     Optional[str]                  = None,
        end_time:       Optional[str]                  = None,
        line_start:     Optional[int]                  = None,
        line_end:       Optional[int]                  = None,
        uploaded_file:  Optional[str]                  = None,
        case_sensitive: bool                           = False,
    ) -> List[Dict]:
        """
        Single-pass AND filter across all active parameters.

        text          -- comma-separated keywords, ANY must appear in raw_line (OR logic)
                         e.g. "gps, location" matches lines containing gps OR location (or both)
                         single keyword works as before
        filters       -- {field_name: [allowed_values]}
                         OR logic within each field, AND logic across fields
                         e.g. {"level": ["ERROR","WARNING"], "component": ["GPS"]}
                         means: (level==ERROR OR level==WARNING) AND component==GPS
        start_time    -- prefix or lexicographic range on timestamp field value
        end_time      -- prefix or lexicographic range on timestamp field value
        line_start    -- minimum actual_line_number (inclusive)
        line_end      -- maximum actual_line_number (inclusive)
        uploaded_file -- substring match on entry.source_file (uploaded filename)
        """
        # Pre-process text search term(s)
        # Split by comma → strip whitespace → drop empty strings
        # e.g. "GPS, ERROR" → ["gps", "error"]  (case-insensitive)
        search_terms: List[str] = []
        if text:
            raw_terms = [t.strip() for t in text.split(',')]
            search_terms = [
                (t if case_sensitive else t.lower())
                for t in raw_terms if t
            ]

        # Build lowercase allowed-value sets for each active field filter
        active: Dict[str, Set[str]] = {}
        if filters:
            for fname, vals in filters.items():
                if vals and fname in self.field_map:
                    active[fname] = {v.lower() for v in vals}

        ufile = uploaded_file.lower() if uploaded_file else None

        matches = []

        for entry in self.logs:

            # ── Text search on full raw line (OR logic across keywords) ───
            # A line matches if it contains ANY of the comma-separated keywords.
            # e.g. "gps, location" → lines with gps OR location (or both).
            if search_terms:
                hay = entry.raw_line if case_sensitive else entry.raw_line.lower()
                if not any(term in hay for term in search_terms):
                    continue

            # ── Timestamp range ────────────────────────────────────
            # Rules (work for full, partial, or mixed timestamps):
            #   start_time: exclude entry if ts is strictly before it
            #               (ts.startswith(start_time) means ts >= start_time always)
            #   end_time:   exclude entry if ts is strictly after it
            #               BUT allow ts that begins with end_time —
            #               e.g. filter="26032025:095355" must match "26032025:095355.384"
            if (start_time or end_time) and self.timestamp_field:
                ts = entry.fields.get(self.timestamp_field, '')
                if not ts:
                    continue
                if start_time:
                    if ts < start_time and not ts.startswith(start_time):
                        continue
                if end_time:
                    if ts > end_time and not ts.startswith(end_time):
                        continue

            # ── Line number range ──────────────────────────────────
            if line_start is not None and entry.actual_line_number < line_start:
                continue
            if line_end is not None and entry.actual_line_number > line_end:
                continue

            # ── Uploaded file filter ───────────────────────────────
            if ufile and ufile not in entry.source_file.lower():
                continue

            # ── Dynamic field filters ──────────────────────────────
            # AND across fields, OR within each field's allowed set
            skip = False
            for fname, allowed in active.items():
                val = entry.fields.get(fname, '')
                if not val or val.lower() not in allowed:
                    skip = True
                    break
            if skip:
                continue

            matches.append(entry.to_dict())

        return matches

    # ── Summary statistics ────────────────────────────────────────

    def get_summary(self) -> Dict:
        """Comprehensive statistics for all loaded entries."""
        total   = len(self.logs)
        summary = {
            'total_entries':     total,
            'field_definitions': self.field_definitions,
        }

        # Time range from timestamp field
        if self.timestamp_field:
            ts_vals = [
                e.fields[self.timestamp_field]
                for e in self.logs
                if e.fields.get(self.timestamp_field)
            ]
            if ts_vals:
                summary['time_range'] = {
                    'start': ts_vals[0],
                    'end':   ts_vals[-1],
                }

        # Value distribution for every text / level / number field
        distributions = {}
        for fname, ftype in self.field_map.items():
            if ftype in ('text', 'level', 'number'):
                ctr = Counter(
                    e.fields[fname]
                    for e in self.logs
                    if e.fields.get(fname)
                )
                if ctr:
                    distributions[fname] = dict(ctr.most_common(20))
        if distributions:
            summary['distributions'] = distributions

        # Top 5 repeated messages
        if self.message_field:
            ctr = Counter(
                e.fields[self.message_field]
                for e in self.logs
                if e.fields.get(self.message_field)
            )
            summary['top_messages'] = dict(ctr.most_common(5))

        # Sample entries where level value looks like an error
        level_field = self._field_of_type('level')
        if level_field:
            error_vals = {'ERROR', 'ERR', 'FATAL', 'CRIT', 'CRITICAL',
                          'error', 'err', 'fatal', 'crit', 'critical'}
            errors = [
                e.to_dict() for e in self.logs
                if e.fields.get(level_field, '') in error_vals
            ][:5]
            if errors:
                summary['error_samples'] = errors

        return summary

    def build_match_summary(self, matches: List[Dict]) -> Dict:
        """
        Compact summary for a filtered result set.
        Sent to the LLM as context header on multi-turn conversations.
        """
        if not matches:
            return {}

        summary: Dict = {
            'total':      len(matches),
            'line_range': {
                'first': matches[0]['actual_line_number'],
                'last':  matches[-1]['actual_line_number'],
            },
        }

        # Time range
        if self.timestamp_field:
            ts_vals = [
                m['fields'].get(self.timestamp_field, '')
                for m in matches
                if m['fields'].get(self.timestamp_field)
            ]
            if ts_vals:
                summary['time_range'] = {
                    'first': ts_vals[0],
                    'last':  ts_vals[-1],
                }

        # Distributions for every text/level/number field
        distributions = {}
        for fname, ftype in self.field_map.items():
            if ftype in ('text', 'level', 'number'):
                ctr = Counter(
                    m['fields'].get(fname)
                    for m in matches
                    if m['fields'].get(fname)
                )
                if ctr:
                    distributions[fname] = dict(ctr.most_common(10))
        if distributions:
            summary['distributions'] = distributions

        return summary
