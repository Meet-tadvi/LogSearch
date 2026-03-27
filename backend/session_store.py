"""
Session Store
=============
Two-layer storage for parsed log data.

  Hot  layer — SearchOperations in RAM  (fast index lookups)
  Cold layer — LogEntry list in JSON on disk (survives server restarts)

Lifecycle
---------
  Parse     → tag entries with source_file
            → save entries to JSON (cold)
            → build SearchOperations (hot)
            → register FileData in session

  Restart   → scan data/sessions/ for existing session dirs
            → load JSON (cold) → rebuild SearchOperations (hot)
            → session is fully restored

  Search    → get_combined_ops() merges selected files in RAM
            → SearchOperations.find_combined() — no disk read

  Delete    → remove from RAM + delete JSON files

Disk layout
-----------
  data/sessions/
  └── <session_uuid>/
      ├── session.json              registry (filenames, format, stats)
      ├── <file_id>_entries.json    serialised LogEntry list
      └── <file_id>_unparsed.json   unparsed lines
"""

import json
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Dict, Optional, List
from pathlib import Path

from log_parser import LogEntry
from search_operations import SearchOperations


# ── Data directory ────────────────────────────────────────────────
DATA_DIR          = Path(__file__).parent / "data" / "sessions"
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
    available_fields:     List[str]
    search_ops:           SearchOperations   # hot layer — RAM
    entries_path:         str               # cold layer — disk path
    unparsed_path:        str               # cold layer — disk path
    time_range:           dict = field(default_factory=lambda: {'start': None, 'end': None})


@dataclass
class SessionData:
    """One browser session — holds all uploaded files."""
    session_id: str
    files:      Dict[str, FileData]  = field(default_factory=dict)
    last_seen:  datetime             = field(default_factory=datetime.utcnow)


# ── Global in-memory registry ────────────────────────────────────
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
                'available_fields':     f.available_fields,
                'entries_path':         f.entries_path,
                'unparsed_path':        f.unparsed_path,
                'time_range':           f.time_range,
            }
            for fid, f in session.files.items()
        }
    }
    path = _session_dir(session.session_id) / 'session.json'
    path.write_text(json.dumps(registry, indent=2), encoding='utf-8')


def _save_entries_json(session_id: str, file_id: str,
                       entries: List[LogEntry]) -> str:
    """Serialise LogEntry list to JSON. Returns the file path."""
    path = _session_dir(session_id) / f'{file_id}_entries.json'
    data = [e.to_dict() for e in entries]
    path.write_text(json.dumps(data), encoding='utf-8')
    return str(path)


def _save_unparsed_json(session_id: str, file_id: str,
                        unparsed: List[dict]) -> str:
    """Serialise unparsed lines to JSON. Returns the file path."""
    path = _session_dir(session_id) / f'{file_id}_unparsed.json'
    path.write_text(json.dumps(unparsed), encoding='utf-8')
    return str(path)


def _load_entries_from_json(entries_path: str,
                             available_fields: List[str],
                             filename: str) -> SearchOperations:
    """
    Load LogEntry list from JSON and rebuild SearchOperations.
    Called on server restart to restore the hot layer from disk.
    """
    path = Path(entries_path)
    if not path.exists():
        return SearchOperations(logs=[], available_fields=available_fields)

    raw_list = json.loads(path.read_text(encoding='utf-8'))
    entries  = []
    for d in raw_list:
        entry = LogEntry(
            timestamp          = d.get('timestamp', ''),
            message            = d.get('message', ''),
            raw_line           = d.get('raw_line', ''),
            actual_line_number = d.get('actual_line_number', 0),
            component          = d.get('component'),
            level              = d.get('level'),
            thread_id          = d.get('thread_id'),
            file_path          = d.get('file_path'),
            line_number        = d.get('line_number'),
            extra_fields       = d.get('extra_fields') or {},
            format_name        = d.get('format_name', 'unknown'),
            timestamp_dt       = d.get('timestamp_dt'),
            source_file        = d.get('source_file', filename),
        )
        entries.append(entry)

    return SearchOperations(logs=entries, available_fields=available_fields)


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
    session_id:   str,
    file_id:      str,
    filename:     str,
    entries:      List[LogEntry],
    unparsed:     List[dict],
    format_name:  str,
    parse_rate:   float,
    confidence:   float,
    avail_fields: List[str],
) -> FileData:
    """
    Called after a file is successfully parsed.
    Saves data to disk (cold layer) and builds SearchOperations (hot layer).
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
    search_ops = SearchOperations(logs=entries, available_fields=avail_fields)

    # Compute time range from entries
    timestamps = [e.timestamp_dt or e.timestamp for e in entries
                  if e.timestamp_dt or e.timestamp]
    time_range = {
        'start': min(timestamps) if timestamps else None,
        'end':   max(timestamps) if timestamps else None,
    }

    file_data = FileData(
        file_id              = file_id,
        filename             = filename,
        format_name          = format_name,
        parse_rate           = parse_rate,
        detection_confidence = confidence,
        entry_count          = len(entries),
        unparsed_count       = len(unparsed),
        available_fields     = avail_fields,
        search_ops           = search_ops,
        entries_path         = entries_path,
        unparsed_path        = unparsed_path,
        time_range           = time_range,
    )
    session.files[file_id] = file_data

    # Persist registry
    _save_session_json(session)
    return file_data


def delete_file(session_id: str, file_id: str):
    """Remove a file from session — memory and disk."""
    session = _sessions.get(session_id)
    if not session:
        return
    file_data = session.files.pop(file_id, None)
    if file_data:
        # Remove JSON files from disk
        for p in (file_data.entries_path, file_data.unparsed_path):
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
        _save_session_json(session)


def delete_session(session_id: str):
    """Wipe entire session — memory + all JSON files."""
    session = _sessions.pop(session_id, None)
    if session:
        import shutil
        session_dir = DATA_DIR / session_id
        try:
            shutil.rmtree(session_dir, ignore_errors=True)
        except OSError:
            pass


def get_combined_ops(
    session:  SessionData,
    file_ids: Optional[List[str]] = None,
) -> Optional[SearchOperations]:
    """
    Merge the LogEntry lists from the selected files and return
    a single SearchOperations over all of them.

    If no file_ids given → use all files in session.
    Returns None if session has no files.

    Multi-file merging:
      - Combined logs sorted by timestamp_dt so cross-file results
        appear in chronological order.
      - available_fields = union of all selected files' fields.
      - Each LogEntry already carries source_file so callers can
        filter by file after the fact.
    """
    if file_ids:
        selected = [session.files[fid] for fid in file_ids
                    if fid in session.files]
    else:
        selected = list(session.files.values())

    if not selected:
        return None

    combined_logs:   List[LogEntry] = []
    combined_fields: set            = set()

    for f in selected:
        combined_logs.extend(f.search_ops.logs)
        combined_fields.update(f.search_ops.available_fields)

    # Sort merged list by normalised timestamp so results are chronological
    # Fix 4: entries where timestamp_dt is None (failed parsing) sort to the END.
    # Old key used raw timestamp as fallback — "18-02..." < "1900-04..." alphabetically,
    # causing entries with invalid months to appear before valid ones.
    # '9999' is greater than any valid ISO timestamp so None entries go last.
    combined_logs.sort(
        key=lambda e: (e.timestamp_dt or '9999', e.actual_line_number)
    )

    return SearchOperations(
        logs             = combined_logs,
        available_fields = list(combined_fields),
    )


def get_unparsed(
    session:  SessionData,
    file_ids: Optional[List[str]] = None,
) -> List[dict]:
    """Return unparsed lines for the selected (or all) files."""
    if file_ids:
        selected = [session.files[fid] for fid in file_ids
                    if fid in session.files]
    else:
        selected = list(session.files.values())

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
    Scans data/sessions/ and rebuilds any sessions whose JSON files
    still exist on disk.
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

            # Skip expired sessions
            if datetime.utcnow() - last_seen > timedelta(hours=SESSION_TTL_HOURS):
                import shutil
                shutil.rmtree(session_dir, ignore_errors=True)
                continue

            session            = SessionData(session_id=session_id, last_seen=last_seen)
            _sessions[session_id] = session

            for fid, info in registry.get('files', {}).items():
                entries_path  = info.get('entries_path', '')
                avail_fields  = info.get('available_fields', [])
                filename      = info.get('filename', '')

                # Rebuild hot layer from cold layer
                search_ops = _load_entries_from_json(
                    entries_path, avail_fields, filename
                )

                # Load unparsed count from file
                up_path = Path(info.get('unparsed_path', ''))
                up_count = 0
                if up_path.exists():
                    try:
                        up_count = len(json.loads(up_path.read_text()))
                    except Exception:
                        pass

                session.files[fid] = FileData(
                    file_id              = info['file_id'],
                    filename             = filename,
                    format_name          = info.get('format_name', 'unknown'),
                    parse_rate           = info.get('parse_rate', 0.0),
                    detection_confidence = info.get('detection_confidence', 0.0),
                    entry_count          = info.get('entry_count', len(search_ops.logs)),
                    unparsed_count       = up_count,
                    available_fields     = avail_fields,
                    search_ops           = search_ops,
                    entries_path         = entries_path,
                    unparsed_path        = info.get('unparsed_path', ''),
                    time_range           = info.get('time_range', {'start': None, 'end': None}),
                )

            restored += 1
        except Exception as e:
            print(f"[session_store] Could not restore session {session_dir.name}: {e}")

    if restored:
        print(f"[session_store] Restored {restored} session(s) from disk.")


def cleanup_expired() -> int:
    """Delete sessions older than SESSION_TTL_HOURS. Returns count deleted."""
    cutoff = datetime.utcnow() - timedelta(hours=SESSION_TTL_HOURS)
    stale  = [
        sid for sid, s in _sessions.items()
        if s.last_seen < cutoff
    ]
    for sid in stale:
        delete_session(sid)
    return len(stale)