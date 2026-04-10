"""
Session Store — v3
==================
Two-layer storage for parsed log data.

  Hot  layer — SearchOperations in RAM  (fast index lookups)
  Cold layer — LogEntry list in JSON on disk (survives server restarts)

Key change from v2:
  FileData stores field_definitions [{name,type}] instead of available_fields [str].
  time_range computed from whichever field has type 'timestamp'.
  No available_fields list — field_definitions carries all necessary info.
"""

import json
import os
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Dict, Optional, List
from pathlib import Path

from log_parser import LogEntry
from search_operations import SearchOperations


APP_DATA_DIR      = Path(os.getenv('APPDATA', str(Path.home()))) / 'LogSearch'
DATA_DIR          = APP_DATA_DIR / 'sessions'
SESSION_TTL_HOURS = 24


# ================================================================
# Data classes
# ================================================================

@dataclass
class FileData:
    """All data for one uploaded and parsed log file."""
    file_id:              str
    filename:             str
    format_name:          str
    parse_rate:           float
    detection_confidence: float
    entry_count:          int
    unparsed_count:       int
    field_definitions:    List[Dict]         # [{name, type}, ...]
    search_ops:           SearchOperations   # hot layer — RAM
    entries_path:         str               # cold layer — disk path
    unparsed_path:        str               # cold layer — disk path
    time_range:           dict = field(
        default_factory=lambda: {'start': None, 'end': None}
    )


@dataclass
class SessionData:
    """One browser session — holds all uploaded files."""
    session_id: str
    files:      Dict[str, FileData] = field(default_factory=dict)
    last_seen:  datetime            = field(default_factory=datetime.utcnow)


# Global in-memory registry
_sessions: Dict[str, SessionData] = {}


# ================================================================
# Persistence helpers
# ================================================================

def _session_dir(session_id: str) -> Path:
    d = DATA_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _save_session_json(session: SessionData):
    """Persist the file registry (metadata only — no LogEntry objects)."""
    registry = {
        'session_id': session.session_id,
        'last_seen':  session.last_seen.isoformat(),
        'files': {
            fid: {
                'file_id':              f.file_id,
                'filename':             f.filename,
                'format_name':          f.format_name,
                'parse_rate':           f.parse_rate,
                'detection_confidence': f.detection_confidence,
                'entry_count':          f.entry_count,
                'unparsed_count':       f.unparsed_count,
                'field_definitions':    f.field_definitions,
                'entries_path':         f.entries_path,
                'unparsed_path':        f.unparsed_path,
                'time_range':           f.time_range,
            }
            for fid, f in session.files.items()
        }
    }
    path = _session_dir(session.session_id) / 'session.json'
    path.write_text(json.dumps(registry, indent=2), encoding='utf-8')


def _save_entries_json(
    session_id: str,
    file_id:    str,
    entries:    List[LogEntry],
) -> str:
    """Serialise LogEntry list to JSON. Returns the file path string."""
    path = _session_dir(session_id) / f'{file_id}_entries.json'
    path.write_text(json.dumps([e.to_dict() for e in entries]), encoding='utf-8')
    return str(path)


def _save_unparsed_json(
    session_id: str,
    file_id:    str,
    unparsed:   List[dict],
) -> str:
    """Serialise unparsed lines to JSON. Returns the file path string."""
    path = _session_dir(session_id) / f'{file_id}_unparsed.json'
    path.write_text(json.dumps(unparsed), encoding='utf-8')
    return str(path)


def _load_entries_from_json(
    entries_path:      str,
    field_definitions: List[Dict],
    filename:          str,
) -> SearchOperations:
    """
    Rebuild SearchOperations from cold JSON.
    Called on server restart to restore the hot layer.
    """
    path = Path(entries_path)
    if not path.exists():
        return SearchOperations(logs=[], field_definitions=field_definitions)

    raw_list = json.loads(path.read_text(encoding='utf-8'))
    entries  = []
    for d in raw_list:
        entry = LogEntry(
            actual_line_number = d.get('actual_line_number', 0),
            raw_line           = d.get('raw_line', ''),
            format_name        = d.get('format_name', 'unknown'),
            fields             = d.get('fields', {}),
            source_file        = d.get('source_file', filename),
        )
        entries.append(entry)

    return SearchOperations(logs=entries, field_definitions=field_definitions)


# ================================================================
# Public API
# ================================================================

def get_or_create(session_id: str) -> SessionData:
    """Return existing session or create a fresh one."""
    if session_id not in _sessions:
        _sessions[session_id] = SessionData(session_id=session_id)
    _sessions[session_id].last_seen = datetime.utcnow()
    return _sessions[session_id]


def get(session_id: str) -> Optional[SessionData]:
    """Return session if it exists, else None."""
    session = _sessions.get(session_id)
    if session:
        session.last_seen = datetime.utcnow()
    return session


def register_file(
    session_id:        str,
    file_id:           str,
    filename:          str,
    entries:           List[LogEntry],
    unparsed:          List[dict],
    format_name:       str,
    parse_rate:        float,
    confidence:        float,
    field_definitions: List[Dict],
) -> FileData:
    """
    Called after a file is successfully parsed.
    1. Tags every entry with source_file = filename
    2. Saves entries to disk (cold layer)
    3. Builds SearchOperations in RAM (hot layer)
    4. Computes time_range from the timestamp field
    5. Persists registry to session.json
    Returns the registered FileData.
    """
    session = get_or_create(session_id)

    # Tag every entry with its source filename
    for e in entries:
        e.source_file = filename

    # Cold layer — write JSON to disk
    entries_path  = _save_entries_json(session_id, file_id, entries)
    unparsed_path = _save_unparsed_json(session_id, file_id, unparsed)

    # Hot layer — build in-memory index
    search_ops = SearchOperations(
        logs              = entries,
        field_definitions = field_definitions,
    )

    # Compute time_range from whichever field has type 'timestamp'
    timestamp_field = next(
        (f['name'] for f in field_definitions if f['type'] == 'timestamp'),
        None
    )
    time_range = {'start': None, 'end': None}
    if timestamp_field:
        ts_vals = [
            e.fields[timestamp_field]
            for e in entries
            if e.fields.get(timestamp_field)
        ]
        if ts_vals:
            time_range = {'start': ts_vals[0], 'end': ts_vals[-1]}

    file_data = FileData(
        file_id              = file_id,
        filename             = filename,
        format_name          = format_name,
        parse_rate           = parse_rate,
        detection_confidence = confidence,
        entry_count          = len(entries),
        unparsed_count       = len(unparsed),
        field_definitions    = field_definitions,
        search_ops           = search_ops,
        entries_path         = entries_path,
        unparsed_path        = unparsed_path,
        time_range           = time_range,
    )
    session.files[file_id] = file_data
    _save_session_json(session)
    return file_data


def delete_file(session_id: str, file_id: str):
    """Remove a file from session — memory and disk."""
    session = _sessions.get(session_id)
    if not session:
        return
    file_data = session.files.pop(file_id, None)
    if file_data:
        for p in (file_data.entries_path, file_data.unparsed_path):
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
        _save_session_json(session)


def delete_session(session_id: str):
    """Wipe entire session — memory + all JSON files on disk."""
    session = _sessions.pop(session_id, None)
    if session:
        import shutil
        try:
            shutil.rmtree(DATA_DIR / session_id, ignore_errors=True)
        except OSError:
            pass


def get_combined_ops(
    session:  SessionData,
    file_ids: Optional[List[str]] = None,
) -> Optional[SearchOperations]:
    """
    Merge selected files into one SearchOperations instance.

    field_definitions = union of all selected files' fields (deduped by name).
    Entries from all files concatenated in selection order.
    Returns None if session has no files.
    """
    selected = (
        [session.files[fid] for fid in file_ids if fid in session.files]
        if file_ids
        else list(session.files.values())
    )
    if not selected:
        return None

    combined_logs:  List[LogEntry] = []
    seen_fields:    Dict[str, str] = {}   # name -> type, deduped

    for f in selected:
        combined_logs.extend(f.search_ops.logs)
        for fdef in f.field_definitions:
            # First file's type wins on name collision
            if fdef['name'] not in seen_fields:
                seen_fields[fdef['name']] = fdef['type']

    combined_fields = [
        {'name': name, 'type': ftype}
        for name, ftype in seen_fields.items()
    ]

    return SearchOperations(
        logs              = combined_logs,
        field_definitions = combined_fields,
    )


def get_unparsed(
    session:  SessionData,
    file_ids: Optional[List[str]] = None,
) -> List[dict]:
    """Return unparsed lines for the selected (or all) files."""
    selected = (
        [session.files[fid] for fid in file_ids if fid in session.files]
        if file_ids
        else list(session.files.values())
    )
    result = []
    for f in selected:
        try:
            path = Path(f.unparsed_path)
            if path.exists():
                lines = json.loads(path.read_text(encoding='utf-8'))
                for line in lines:
                    result.append({'source_file': f.filename, **line})
        except Exception:
            pass
    return result


# ================================================================
# Startup restore + cleanup
# ================================================================

def restore_sessions():
    """
    Called on server startup.
    Scans data/sessions/ and rebuilds sessions whose JSON files still exist.
    Expired sessions (> SESSION_TTL_HOURS) are deleted from disk.
    """
    if not DATA_DIR.exists():
        return

    restored = 0
    for session_dir in DATA_DIR.iterdir():
        if not session_dir.is_dir():
            continue
        session_json = session_dir / 'session.json'
        if not session_json.exists():
            continue

        try:
            registry   = json.loads(session_json.read_text(encoding='utf-8'))
            session_id = registry['session_id']
            last_seen  = datetime.fromisoformat(registry['last_seen'])

            # Delete expired sessions
            if datetime.utcnow() - last_seen > timedelta(hours=SESSION_TTL_HOURS):
                import shutil
                shutil.rmtree(session_dir, ignore_errors=True)
                continue

            session               = SessionData(session_id=session_id, last_seen=last_seen)
            _sessions[session_id] = session

            for fid, info in registry.get('files', {}).items():
                field_definitions = info.get('field_definitions', [])
                search_ops = _load_entries_from_json(
                    info.get('entries_path', ''),
                    field_definitions,
                    info.get('filename', ''),
                )

                up_path  = Path(info.get('unparsed_path', ''))
                up_count = 0
                if up_path.exists():
                    try:
                        up_count = len(json.loads(up_path.read_text()))
                    except Exception:
                        pass

                session.files[fid] = FileData(
                    file_id              = info['file_id'],
                    filename             = info.get('filename', ''),
                    format_name          = info.get('format_name', 'unknown'),
                    parse_rate           = info.get('parse_rate', 0.0),
                    detection_confidence = info.get('detection_confidence', 0.0),
                    entry_count          = info.get('entry_count', len(search_ops.logs)),
                    unparsed_count       = up_count,
                    field_definitions    = field_definitions,
                    search_ops           = search_ops,
                    entries_path         = info.get('entries_path', ''),
                    unparsed_path        = info.get('unparsed_path', ''),
                    time_range           = info.get('time_range', {'start': None, 'end': None}),
                )

            restored += 1
        except Exception as e:
            print(f'[session_store] Could not restore {session_dir.name}: {e}')

    if restored:
        print(f'[session_store] Restored {restored} session(s) from disk.')


def cleanup_expired() -> int:
    """Delete sessions older than SESSION_TTL_HOURS. Returns count deleted."""
    cutoff = datetime.utcnow() - timedelta(hours=SESSION_TTL_HOURS)
    stale  = [sid for sid, s in _sessions.items() if s.last_seen < cutoff]
    for sid in stale:
        delete_session(sid)
    return len(stale)
