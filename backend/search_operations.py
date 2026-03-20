"""
Search Operations Module
=========================
All search and filter operations for LogEntry data.

Design:
    - thread_id is now a string everywhere (no int conversion).
      Filtering uses case-insensitive substring match.
    - Removed: find_regex, find_diagnostic, find_first_occurrence,
      find_last_occurrence (not needed — UI filters replace them all).
    - find_combined is a clean single-pass AND filter covering all fields.
    - Indices are only built for fields that exist in the parsed format.
"""

from typing import List, Dict, Optional
from collections import Counter, defaultdict
from log_parser import LogEntry

class SearchOperations:
    """
    Search and filter operations for a list of LogEntry objects.
    All indices are built at startup based on available fields.
    """

    def __init__(self, logs: List[LogEntry], available_fields: List[str] = None):
        self.logs = logs

        if available_fields is not None:
            self.available_fields = set(available_fields)
        else:
            self.available_fields = self._detect_available_fields()

        self._build_all_indices()

    def _detect_available_fields(self) -> set:
        """Scan first 100 entries to detect which standard fields have data."""
        fields = {'timestamp', 'message'}
        sample = self.logs[:100]
        if any(l.component   is not None for l in sample): fields.add('component')
        if any(l.level       is not None for l in sample): fields.add('level')
        if any(l.thread_id   is not None for l in sample): fields.add('thread_id')
        if any(l.file_path   is not None for l in sample): fields.add('file_path')
        if any(l.line_number is not None for l in sample): fields.add('line_number')
        return fields

    # ================================================================
    # INDEX BUILDING
    # ================================================================

    def _build_all_indices(self):
        """Build lookup indices for every available field."""

        # line number → LogEntry (always)
        self.line_index: Dict[int, LogEntry] = {}

        # timestamp prefix → [line numbers] (always)
        self.timestamp_index: Dict[str, List[int]] = defaultdict(list)

        # optional field indices
        self.component_index:   Dict[str, List[int]] = defaultdict(list)
        self.file_index:        Dict[str, List[int]] = defaultdict(list)
        self.level_index:       Dict[str, List[int]] = defaultdict(list)
        self.thread_index:      Dict[str, List[int]] = defaultdict(list)  # string keys
        self.source_line_index: Dict[int, List[int]] = defaultdict(list)

        # extra fields: field_name → { value → [line numbers] }
        self.extra_field_index: Dict[str, Dict[str, List[int]]] = defaultdict(
            lambda: defaultdict(list)
        )

        for log in self.logs:
            ln = log.actual_line_number
            self.line_index[ln] = log

            # timestamp at 5 granularities
            ts = log.timestamp
            if ts:
                self.timestamp_index[ts].append(ln)
                if len(ts) >= 19: self.timestamp_index[ts[:19]].append(ln)
                if len(ts) >= 16: self.timestamp_index[ts[:16]].append(ln)
                if len(ts) >= 13: self.timestamp_index[ts[:13]].append(ln)
                if len(ts) >= 10: self.timestamp_index[ts[:10]].append(ln)

            if 'component' in self.available_fields and log.component:
                self.component_index[log.component.lower()].append(ln)

            if 'file_path' in self.available_fields and log.file_path:
                self.file_index[log.file_path.lower()].append(ln)

            if 'level' in self.available_fields and log.level:
                self.level_index[log.level.upper()].append(ln)

            # thread_id is a string — index by lowercase value
            if 'thread_id' in self.available_fields and log.thread_id:
                self.thread_index[log.thread_id.lower()].append(ln)

            if 'line_number' in self.available_fields and log.line_number is not None:
                self.source_line_index[log.line_number].append(ln)

            for key, value in log.extra_fields.items():
                if value is not None:
                    self.extra_field_index[key][str(value).lower()].append(ln)

    # ================================================================
    # LINE OPERATIONS
    # ================================================================

    def get_line(self, line_number: int) -> Optional[Dict]:
        if line_number in self.line_index:
            return self._to_dict(self.line_index[line_number])
        return None

    def get_lines(self, start: int, end: int) -> List[Dict]:
        return [self._to_dict(self.line_index[ln])
                for ln in range(start, end + 1) if ln in self.line_index]

    def get_first_n(self, n: int) -> List[Dict]:
        return [self._to_dict(log) for log in self.logs[:n]]

    def get_last_n(self, n: int) -> List[Dict]:
        return [self._to_dict(log) for log in self.logs[-n:]]

    # ================================================================
    # TIME OPERATIONS
    # ================================================================

    def find_by_time(self, time_string: str) -> List[Dict]:
        """Find logs matching a timestamp string at any granularity."""
        if time_string in self.timestamp_index:
            return [self._to_dict(self.line_index[ln])
                    for ln in self.timestamp_index[time_string]]
        return [self._to_dict(log) for log in self.logs
                if time_string in log.timestamp]

    def find_by_time_range(self, start_time: str, end_time: str) -> List[Dict]:
        """All logs between two timestamps (lexicographic, ISO-safe)."""
        return [self._to_dict(log) for log in self.logs
                if start_time <= log.timestamp <= end_time]

    def find_by_date(self, date_string: str) -> List[Dict]:
        if date_string in self.timestamp_index:
            return [self._to_dict(self.line_index[ln])
                    for ln in self.timestamp_index[date_string]]
        return []

    # ================================================================
    # TEXT SEARCH
    # ================================================================

    def find(self, search_string: str, case_sensitive: bool = False) -> List[Dict]:
        """Substring search on the full raw log line."""
        term = search_string if case_sensitive else search_string.lower()
        return [self._to_dict(log) for log in self.logs
                if term in (log.raw_line if case_sensitive else log.raw_line.lower())]

    # ================================================================
    # COMPONENT
    # ================================================================

    def find_by_component(self, component: str) -> List[Dict]:
        if 'component' not in self.available_fields:
            return []
        key = component.lower()
        if key in self.component_index:
            return [self._to_dict(self.line_index[ln])
                    for ln in self.component_index[key]]
        return [self._to_dict(log) for log in self.logs
                if log.component and key in log.component.lower()]

    def find_by_multiple_components(self, components: List[str]) -> List[Dict]:
        seen, matches = set(), []
        for c in components:
            for r in self.find_by_component(c):
                ln = r['actual_line_number']
                if ln not in seen:
                    seen.add(ln)
                    matches.append(r)
        return sorted(matches, key=lambda x: x['actual_line_number'])

    def get_all_components(self) -> Dict[str, int]:
        return dict(Counter(log.component for log in self.logs if log.component).most_common())

    # ================================================================
    # LEVEL
    # ================================================================

    def find_by_level(self, level: str) -> List[Dict]:
        if 'level' not in self.available_fields:
            return []
        key = level.upper()
        if key in self.level_index:
            return [self._to_dict(self.line_index[ln])
                    for ln in self.level_index[key]]
        return []

    def find_by_multiple_levels(self, levels: List[str]) -> List[Dict]:
        seen, matches = set(), []
        for level in levels:
            for r in self.find_by_level(level):
                ln = r['actual_line_number']
                if ln not in seen:
                    seen.add(ln)
                    matches.append(r)
        return sorted(matches, key=lambda x: x['actual_line_number'])

    # ================================================================
    # THREAD (string matching)
    # ================================================================

    def find_by_thread(self, thread_id: str) -> List[Dict]:
        """
        Find logs by thread_id string.
        Exact match first, then partial/substring fallback.
        e.g. 'b72d6000' matches entries with thread_id='b72d6000'
        """
        if 'thread_id' not in self.available_fields:
            return []
        key = thread_id.lower()
        if key in self.thread_index:
            return [self._to_dict(self.line_index[ln])
                    for ln in self.thread_index[key]]
        # partial match fallback
        return [self._to_dict(log) for log in self.logs
                if log.thread_id and key in log.thread_id.lower()]

    def find_by_multiple_threads(self, thread_ids: List[str]) -> List[Dict]:
        seen, matches = set(), []
        for tid in thread_ids:
            for r in self.find_by_thread(str(tid)):
                ln = r['actual_line_number']
                if ln not in seen:
                    seen.add(ln)
                    matches.append(r)
        return sorted(matches, key=lambda x: x['actual_line_number'])

    def get_all_threads(self) -> Dict[str, int]:
        return dict(Counter(log.thread_id for log in self.logs if log.thread_id).most_common())

    # ================================================================
    # SOURCE FILE
    # ================================================================

    def find_by_source_file(self, filename: str) -> List[Dict]:
        if 'file_path' not in self.available_fields:
            return []
        key = filename.lower()
        if key in self.file_index:
            return [self._to_dict(self.line_index[ln])
                    for ln in self.file_index[key]]
        return [self._to_dict(log) for log in self.logs
                if log.file_path and key in log.file_path.lower()]

    # ================================================================
    # EXTRA FIELDS
    # ================================================================

    def find_by_extra_field(self, field_name: str, field_value: str) -> List[Dict]:
        """Find entries where extra_fields[field_name] contains field_value."""
        key   = field_name.lower()
        value = field_value.lower()
        field_idx = self.extra_field_index.get(key, {})
        if value in field_idx:
            return [self._to_dict(self.line_index[ln]) for ln in field_idx[value]]
        return [self._to_dict(log) for log in self.logs
                if log.extra_fields.get(key) and
                   value in str(log.extra_fields.get(key, '')).lower()]

    def get_all_extra_fields(self) -> Dict[str, Dict[str, int]]:
        """All extra field names → { value → count }."""
        result = {}
        for log in self.logs:
            for key, value in log.extra_fields.items():
                if key not in result:
                    result[key] = Counter()
                result[key][str(value)] += 1
        return {k: dict(v.most_common()) for k, v in result.items()}

    # ================================================================
    # COMBINED SEARCH — single-pass AND filter
    # ================================================================

    def find_combined(self,
                      search_string:  Optional[str]       = None,
                      start_time:     Optional[str]       = None,
                      end_time:       Optional[str]       = None,
                      component:      Optional[str]       = None,
                      components:     Optional[List[str]] = None,
                      level:          Optional[str]       = None,
                      levels:         Optional[List[str]] = None,
                      thread_id:      Optional[str]       = None,
                      thread_ids:     Optional[List[str]] = None,
                      source_file:    Optional[str]       = None,
                      uploaded_file:  Optional[str]       = None,
                      source_line:    Optional[int]       = None,
                      extra_field:    Optional[str]       = None,
                      extra_value:    Optional[str]       = None,
                      case_sensitive: bool                = False) -> List[Dict]:
        """
        AND-filter using any combination of fields.
        Only filters by fields that are actually available in the format.
        A filter parameter of None means "no filter on this field".
        """

        # ── Normalize: handle if caller passes single value as list or vice versa
        if level is not None and isinstance(level, list):
            levels, level = level, None
        if component is not None and isinstance(component, list):
            components, component = component, None

        # ── Precompute lowered filter values ──────────────────────
        search_term    = (search_string if case_sensitive
                          else search_string.lower()) if search_string else None
        comp_filter    = component.lower()             if component    else None
        comps_filter   = [c.lower() for c in components] if components else None
        level_filter   = level.upper()                 if level        else None
        levels_filter  = [l.upper() for l in levels]  if levels       else None
        thread_filter  = thread_id.lower()             if thread_id    else None
        threads_filter = [str(t).lower() for t in thread_ids] if thread_ids else None
        extra_key      = extra_field.lower()           if extra_field  else None
        extra_val      = extra_value.lower()           if extra_value  else None

        # Which field groups are available in this format
        has_component = 'component'   in self.available_fields
        has_level     = 'level'       in self.available_fields
        has_thread    = 'thread_id'   in self.available_fields
        has_file      = 'file_path'   in self.available_fields
        has_line_no   = 'line_number' in self.available_fields

        matches = []

        for log in self.logs:

            # ── text search (raw_line) ────────────────────────────
            if search_term:
                haystack = log.raw_line if case_sensitive else log.raw_line.lower()
                if search_term not in haystack:
                    continue

            # ── time range ────────────────────────────────────────
            # Use substring match for short strings like "08:35",
            # lexicographic range for full ISO timestamps.
            if start_time:
                if len(start_time) >= 10:
                    if log.timestamp < start_time:
                        continue
                else:
                    if start_time not in log.timestamp:
                        continue

            if end_time:
                if len(end_time) >= 10:
                    if log.timestamp > end_time:
                        continue
                else:
                    if end_time not in log.timestamp:
                        continue

            # ── component ─────────────────────────────────────────
            if comp_filter and has_component:
                if not log.component or comp_filter not in log.component.lower():
                    continue

            if comps_filter and has_component:
                if not log.component or \
                   not any(c in log.component.lower() for c in comps_filter):
                    continue

            # ── level ─────────────────────────────────────────────
            if level_filter and has_level:
                if not log.level or log.level.upper() != level_filter:
                    continue

            if levels_filter and has_level:
                if not log.level or log.level.upper() not in levels_filter:
                    continue

            # ── thread (string comparison) ────────────────────────
            if thread_filter and has_thread:
                if not log.thread_id or thread_filter not in log.thread_id.lower():
                    continue

            if threads_filter and has_thread:
                if not log.thread_id or \
                   not any(t in log.thread_id.lower() for t in threads_filter):
                    continue

            # ── uploaded file (log.source_file = original filename) ──
            if uploaded_file:
                if uploaded_file.lower() not in log.source_file.lower():
                    continue

            # ── source file ───────────────────────────────────────
            if source_file and has_file:
                if not log.file_path or \
                   source_file.lower() not in log.file_path.lower():
                    continue

            # ── source line number ────────────────────────────────
            if source_line is not None and has_line_no:
                if log.line_number != source_line:
                    continue

            # ── extra field ───────────────────────────────────────
            if extra_key and extra_val:
                val = log.extra_fields.get(extra_key)
                if val is None or extra_val not in str(val).lower():
                    continue

            matches.append(self._to_dict(log))

        return matches

    # ================================================================
    # SUMMARY & STATISTICS
    # ================================================================

    def get_summary(self, num_lines: Optional[int] = None) -> Dict:
        """Comprehensive statistics for the log file (or first N lines)."""
        logs_to_analyze = self.logs[:num_lines] if num_lines else self.logs
        actual_count    = len(logs_to_analyze)

        components = Counter(log.component for log in logs_to_analyze if log.component)
        levels     = Counter(log.level     for log in logs_to_analyze if log.level)
        files      = Counter(log.file_path for log in logs_to_analyze if log.file_path)
        threads    = Counter(log.thread_id for log in logs_to_analyze if log.thread_id)
        messages   = Counter(log.message   for log in logs_to_analyze if log.message)

        timestamps = [log.timestamp for log in logs_to_analyze]
        errors     = [log for log in logs_to_analyze
                      if log.level and log.level.upper() == 'ERROR']
        warnings   = [log for log in logs_to_analyze
                      if log.level and log.level.upper() == 'WARNING']

        summary = {
            'total_lines':   num_lines or actual_count,
            'total_entries': actual_count,
            'time_range': {
                'start': timestamps[0]  if timestamps else None,
                'end':   timestamps[-1] if timestamps else None,
            },
            'top_messages': dict(messages.most_common(5)),
        }

        if 'component' in self.available_fields:
            summary['components'] = {
                'total':        len(components),
                'distribution': dict(components.most_common(10)),
                'top':          components.most_common(1)[0][0] if components else None,
            }

        if 'level' in self.available_fields:
            summary['levels'] = {
                'distribution': dict(levels),
                'errors':       len(errors),
                'warnings':     len(warnings),
                'info':         levels.get('INFO', 0),
            }
            summary['error_samples']   = [self._to_dict(log) for log in errors[:5]]
            summary['warning_samples'] = [self._to_dict(log) for log in warnings[:5]]

        if 'file_path' in self.available_fields:
            summary['files'] = {
                'total': len(files),
                'top':   dict(files.most_common(5)),
            }

        if 'thread_id' in self.available_fields:
            summary['threads'] = {
                'total':        len(threads),
                'distribution': dict(threads.most_common()),
            }

        extra_summary = self.get_all_extra_fields()
        if extra_summary:
            summary['extra_fields'] = extra_summary

        return summary

    def build_match_summary(self, matches: List[Dict]) -> Dict:
        """Summary statistics for a filtered result set."""
        if not matches:
            return {}

        summary = {
            'total': len(matches),
            'time_range': {
                'first': matches[0]['timestamp'],
                'last':  matches[-1]['timestamp'],
            },
            'line_range': {
                'first': matches[0]['actual_line_number'],
                'last':  matches[-1]['actual_line_number'],
            },
        }

        if 'component' in self.available_fields:
            summary['components'] = dict(Counter(
                m['component'] for m in matches if m.get('component')
            ).most_common())

        if 'level' in self.available_fields:
            summary['levels'] = dict(Counter(
                m['level'] for m in matches if m.get('level')
            ).most_common())

        if 'thread_id' in self.available_fields:
            summary['threads'] = dict(Counter(
                m['thread_id'] for m in matches if m.get('thread_id')
            ).most_common())

        # Extra fields distribution
        extra_keys = set()
        for m in matches:
            extra_keys.update((m.get('extra_fields') or {}).keys())
        if extra_keys:
            summary['extra_fields'] = {
                key: dict(Counter(
                    str((m.get('extra_fields') or {}).get(key))
                    for m in matches if (m.get('extra_fields') or {}).get(key)
                ).most_common(5))
                for key in extra_keys
            }

        return summary

    # ================================================================
    # HELPER
    # ================================================================

    def _to_dict(self, log: LogEntry) -> Dict:
        return {
            'actual_line_number': log.actual_line_number,
            'timestamp':          log.timestamp,
            'timestamp_dt':       log.timestamp_dt,
            'component':          log.component,
            'file_path':          log.file_path,
            'line_number':        log.line_number,
            'level':              log.level,
            'thread_id':          log.thread_id,
            'message':            log.message,
            'raw_line':           log.raw_line,
            'extra_fields':       log.extra_fields,
            'format_name':        log.format_name,
            'source_file':        log.source_file,
        }