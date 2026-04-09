"""
FastAPI Backend — Log Search System v3
=======================================
Fully dynamic — no hardcoded field names in any endpoint.

SearchRequest uses a generic `filters` dict instead of fixed
levels / components / threads fields.

New endpoints vs v2:
    POST /api/formats/generate   LLM-assisted format generation

Run (development):
    uvicorn main:app --reload --port 8000

Run (production):
    uvicorn main:app --port 8000
"""

import csv
import io
import json
import re
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import session_store as store
from llm import (
    build_csv_from_matches,
    estimate_tokens,
    stream_ollama_response,
    ask_ollama_for_format,
)
from log_parser import LogParser, get_raw_formats, save_formats
from search_operations import SearchOperations


# ================================================================
# App setup
# ================================================================

app = FastAPI(
    title       = 'Log Search API',
    description = 'Multi-file dynamic log analysis — v3',
    version     = '3.0.0',
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ['http://localhost:5173'],
    allow_credentials = True,
    allow_methods     = ['*'],
    allow_headers     = ['*'],
)

TEMP_DIR     = Path(tempfile.gettempdir())
FORMATS_PATH = Path(__file__).parent / 'log_formats.json'

# Serve React production build from frontend/dist (production mode)
_frontend_dist = Path(__file__).parent.parent / 'frontend' / 'dist'
if _frontend_dist.exists():
    app.mount('/', StaticFiles(directory=str(_frontend_dist), html=True),
              name='frontend')


# ================================================================
# Startup
# ================================================================

@app.on_event('startup')
async def startup():
    """Restore sessions from disk and clean up expired ones."""
    store.restore_sessions()
    deleted = store.cleanup_expired()
    if deleted:
        print(f'[startup] Cleaned up {deleted} expired session(s).')


# ================================================================
# Session dependency
# ================================================================

def get_session(x_session_id: Optional[str] = Header(default=None)):
    """
    Resolve or create the session for this request.
    Frontend sends X-Session-ID header on every request.
    Auto-creates a new session if the header is missing.
    """
    if not x_session_id:
        x_session_id = str(uuid.uuid4())
    return store.get_or_create(x_session_id)


# ================================================================
# Pydantic models
# ================================================================

class SearchRequest(BaseModel):
    file_ids:    Optional[List[str]]            = None
    text:        Optional[str]                  = None
    # Dynamic field filters: { field_name: [allowed_values] }
    # e.g. {"level": ["INFO","ERROR"], "component": ["GPS","XRAIL"]}
    filters:     Optional[Dict[str, List[str]]] = None
    time_start:  Optional[str]                  = None
    time_end:    Optional[str]                  = None
    line_start:  Optional[int]                  = None
    line_end:    Optional[int]                  = None
    file_filter: Optional[str]                  = None   # substring on source_file
    page:        int                            = 0
    page_size:   int                            = 500


class LLMRequest(BaseModel):
    question: str
    file_ids: Optional[List[str]]     = None
    filters:  Optional[SearchRequest] = None
    history:  Optional[List[dict]]    = None


class CsvPreviewRequest(BaseModel):
    file_ids: Optional[List[str]]     = None
    filters:  Optional[SearchRequest] = None


class AddFormatRequest(BaseModel):
    name:        str
    description: str
    pattern:     str
    fields:      List[Dict]    # [{name, type}, ...]
    example:     Optional[str] = None


class FormatGenerateRequest(BaseModel):
    sample_lines: List[str]


# ================================================================
# Filter helper
# ================================================================

def _apply_filters(ops: SearchOperations, req: SearchRequest) -> list:
    """Translate SearchRequest into a find_combined() call."""
    return ops.find_combined(
        text          = req.text        or None,
        filters       = req.filters     or None,
        start_time    = req.time_start  or None,
        end_time      = req.time_end    or None,
        line_start    = req.line_start,
        line_end      = req.line_end,
        uploaded_file = req.file_filter or None,
    )


# ================================================================
# FILE ENDPOINTS
# ================================================================

@app.post('/api/files/upload')
async def upload_files(
    files:   List[UploadFile] = File(...),
    session = Depends(get_session),
):
    """
    Upload and parse one or more log files.
    Returns parse results immediately (no WebSocket progress).
    Each result includes field_definitions and time_range.
    """
    MAX_BYTES = 200 * 1024 * 1024
    results   = []

    for upload in files:
        content = await upload.read()

        if len(content) > MAX_BYTES:
            results.append({
                'filename': upload.filename,
                'status':   'error',
                'error':    f'File exceeds 200 MB limit '
                            f'({len(content) // 1024 // 1024} MB).',
            })
            continue

        file_id  = str(uuid.uuid4())
        suffix   = Path(upload.filename).suffix or '.log'
        tmp_path = TEMP_DIR / f'logsearch_{file_id}{suffix}'

        try:
            tmp_path.write_bytes(content)
            parser = LogParser()
            parser.parse_file(str(tmp_path))

            metadata          = parser.get_log_metadata()
            field_definitions = metadata.get('field_definitions', [])
            total_lines       = len(parser.parsed_logs) + len(parser.unparsed_lines)
            parse_rate        = (
                round(len(parser.parsed_logs) / total_lines * 100, 1)
                if total_lines else 100.0
            )
            # Cap at 99.9 when unparsed lines exist — avoids misleading 100.0%
            if parser.unparsed_lines and parse_rate >= 100.0:
                parse_rate = 99.9

            file_data = store.register_file(
                session_id        = session.session_id,
                file_id           = file_id,
                filename          = upload.filename,
                entries           = parser.parsed_logs,
                unparsed          = parser.unparsed_lines,
                format_name       = parser.active_format or 'unknown',
                parse_rate        = parse_rate,
                confidence        = parser.detection_confidence,
                field_definitions = field_definitions,
            )

            results.append({
                'file_id':           file_id,
                'filename':          upload.filename,
                'status':            'ready',
                'format':            parser.active_format,
                'confidence':        parser.detection_confidence,
                'parse_rate':        parse_rate,
                'entry_count':       len(parser.parsed_logs),
                'unparsed_count':    len(parser.unparsed_lines),
                'field_definitions': field_definitions,
                'time_range':        file_data.time_range,
            })

        except Exception as e:
            results.append({
                'file_id':  file_id,
                'filename': upload.filename,
                'status':   'error',
                'error':    str(e),
            })
        finally:
            tmp_path.unlink(missing_ok=True)

    return {'uploaded': results}


@app.get('/api/files')
async def list_files(session = Depends(get_session)):
    """List all files registered in this session."""
    return {
        'files': [
            {
                'file_id':           f.file_id,
                'filename':          f.filename,
                'format':            f.format_name,
                'confidence':        f.detection_confidence,
                'parse_rate':        f.parse_rate,
                'entry_count':       f.entry_count,
                'unparsed_count':    f.unparsed_count,
                'field_definitions': f.field_definitions,
                'time_range':        f.time_range,
            }
            for f in session.files.values()
        ]
    }


@app.delete('/api/files/{file_id}')
async def delete_file(file_id: str, session = Depends(get_session)):
    """Remove a file from the session (memory + disk)."""
    if file_id not in session.files:
        raise HTTPException(status_code=404, detail='File not found in this session.')
    filename = session.files[file_id].filename
    store.delete_file(session.session_id, file_id)
    return {'deleted': file_id, 'filename': filename}


# ================================================================
# METADATA
# ================================================================

@app.get('/api/metadata')
async def get_metadata(
    file_ids: Optional[str] = None,
    session = Depends(get_session),
):
    """
    Return field_definitions and distinct values for all
    text / level / number fields across the selected files.

    The frontend uses this to build sidebar filter dropdowns dynamically.
    Every text/level/number field gets its own multiselect dropdown.
    """
    ids = file_ids.split(',') if file_ids else None
    ops = store.get_combined_ops(session, ids)

    if not ops:
        return {'field_definitions': [], 'distinct_values': {}}

    return {
        'field_definitions': ops.field_definitions,
        'distinct_values':   ops.get_distinct_values(),
    }


# ================================================================
# SEARCH
# ================================================================

@app.post('/api/search')
async def search(req: SearchRequest, session = Depends(get_session)):
    """
    Main filter query. Returns paginated results + aggregate summary stats.
    The frontend uses summary to render chips above the results table.
    """
    ids = req.file_ids or None
    ops = store.get_combined_ops(session, ids)

    if not ops:
        return {
            'matches': [], 'total': 0,
            'page': 0, 'total_pages': 1, 'summary': {},
        }

    all_matches = _apply_filters(ops, req)
    total       = len(all_matches)
    total_pages = max(1, (total + req.page_size - 1) // req.page_size)
    start       = req.page * req.page_size
    page_data   = all_matches[start: start + req.page_size]
    summary     = ops.build_match_summary(all_matches) if all_matches else {}

    return {
        'matches':     page_data,
        'total':       total,
        'page':        req.page,
        'total_pages': total_pages,
        'summary':     summary,
    }


# ================================================================
# SUMMARY
# ================================================================

@app.get('/api/summary')
async def get_summary(
    file_ids: Optional[str] = None,
    session = Depends(get_session),
):
    """Full statistics for selected files."""
    ids = file_ids.split(',') if file_ids else None
    ops = store.get_combined_ops(session, ids)
    if not ops:
        return {}
    return ops.get_summary()


@app.get('/api/summary/per-file')
async def get_summary_per_file(
    file_ids: Optional[str] = None,
    session = Depends(get_session),
):
    """Individual statistics for each selected file."""
    ids = file_ids.split(',') if file_ids else None
    if not ids:
        ids = list(session.files.keys())
    
    results = []
    for fid in ids:
        if fid not in session.files:
            continue
        file_data = session.files[fid]
        summary = file_data.search_ops.get_summary()
        results.append({
            'file_id': fid,
            'filename': file_data.filename,
            'summary': summary
        })
        
    return {'files': results}


# ================================================================
# EXPORT
# ================================================================

@app.post('/api/export/csv')
async def export_csv(req: SearchRequest, session = Depends(get_session)):
    """Download ALL filtered results as CSV (no page limit)."""
    ids = req.file_ids or None
    ops = store.get_combined_ops(session, ids)
    if not ops:
        raise HTTPException(status_code=404, detail='No files selected.')

    all_matches = _apply_filters(ops, req)
    csv_data    = build_csv_from_matches(all_matches, ops.field_definitions)

    return StreamingResponse(
        iter([csv_data]),
        media_type = 'text/csv',
        headers    = {'Content-Disposition': 'attachment; filename="filtered_logs.csv"'},
    )


@app.post('/api/export/unparsed')
async def export_unparsed(
    file_ids: Optional[List[str]] = None,
    session = Depends(get_session),
):
    """Download unparsed lines for the selected files as CSV."""
    unparsed = store.get_unparsed(session, file_ids)

    buf    = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames   = ['source_file', 'line_number', 'content'],
        extrasaction = 'ignore',
    )
    writer.writeheader()
    writer.writerows(unparsed)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type = 'text/csv',
        headers    = {'Content-Disposition': 'attachment; filename="unparsed_lines.csv"'},
    )


# ================================================================
# LLM  (SSE streaming)
# ================================================================

@app.post('/api/llm/chat')
async def llm_chat(req: LLMRequest, request: Request, session = Depends(get_session)):
    """
    Send a natural language question about the filtered log data.
    Returns a Server-Sent Events stream of tokens.

    request.is_disconnected() is checked between each yielded chunk so
    that when the user clicks Stop, the backend stops sending immediately
    (no socket.send() spam in logs, Ollama stream closed cleanly).
    """
    filters_req = req.filters or SearchRequest()
    ids         = req.file_ids or None
    ops         = store.get_combined_ops(session, ids)

    async def _err(msg: str):
        yield f'data: {json.dumps({"type": "error", "content": msg})}\n\n'

    if not ops:
        return StreamingResponse(_err('No files selected.'),
                                 media_type='text/event-stream')

    all_matches = _apply_filters(ops, filters_req)
    if not all_matches:
        return StreamingResponse(
            _err('No data matches the current filters. '
                 'Select files and apply filters before using the LLM.'),
            media_type='text/event-stream',
        )

    summary  = ops.build_match_summary(all_matches)
    csv_data = build_csv_from_matches(all_matches, ops.field_definitions)
    history  = req.history or []

    async def _stream_with_disconnect_check():
        """Stop yielding the moment the client disconnects (Stop button)."""
        async for chunk in stream_ollama_response(req.question, csv_data, summary, history):
            if await request.is_disconnected():
                break          # client gone — stop sending, no socket errors
            yield chunk

    return StreamingResponse(
        _stream_with_disconnect_check(),
        media_type = 'text/event-stream',
        headers    = {
            'Cache-Control':     'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


@app.post('/api/llm/csv-preview')
async def llm_csv_preview(req: CsvPreviewRequest, session = Depends(get_session)):
    """
    Return the first 50 rows of the exact CSV that would be sent to Ollama.
    Powers the 'Preview data' button in the LLM panel.
    """
    filters_req = req.filters or SearchRequest()
    ids         = req.file_ids or None
    ops         = store.get_combined_ops(session, ids)
    if not ops:
        return {'csv': '', 'total': 0}
    all_matches = _apply_filters(ops, filters_req)
    preview     = build_csv_from_matches(all_matches[:50], ops.field_definitions)
    return {'csv': preview, 'total': len(all_matches)}


@app.get('/api/llm/context-info')
async def llm_context_info(
    file_ids: Optional[str] = None,
    session = Depends(get_session),
):
    """Token estimate without building the full CSV."""
    ids   = file_ids.split(',') if file_ids else None
    ops   = store.get_combined_ops(session, ids)
    total = len(ops.logs) if ops else 0
    return {
        'total_entries': total,
        'est_tokens':    (total * 80) // 4,
        'est_size_kb':   round(total * 80 / 1024, 1),
    }


# ================================================================
# FORMATS
# ================================================================

@app.get('/api/formats')
async def list_formats():
    """List all log formats from log_formats.json."""
    raw = get_raw_formats(FORMATS_PATH)
    return {'formats': raw}


@app.post('/api/formats')
async def add_format(req: AddFormatRequest):
    """
    Add a new log format.
    Validates: regex compiles, has message group, all field names in pattern.
    Saves to log_formats.json — no server restart needed.
    """
    try:
        compiled = re.compile(req.pattern)
    except re.error as e:
        raise HTTPException(status_code=422, detail=f'Invalid regex: {e}')

    named = set(compiled.groupindex.keys())

    # message group is mandatory
    if 'message' not in named:
        raise HTTPException(
            status_code=422,
            detail="Pattern must include a (?P<message>...) named group.",
        )

    # All declared field names must be captured by the pattern
    field_names = {f['name'] for f in req.fields}
    undefined   = field_names - named
    if undefined:
        raise HTTPException(
            status_code=422,
            detail=f"Fields {sorted(undefined)} are not named groups in the pattern.",
        )

    raw           = get_raw_formats(FORMATS_PATH)
    raw[req.name] = {
        'description': req.description,
        'pattern':     req.pattern,
        'fields':      req.fields,
        'example':     req.example or '',
    }
    save_formats(raw, FORMATS_PATH)
    return {'added': req.name, 'total_formats': len(raw)}


@app.delete('/api/formats/{name}')
async def delete_format(name: str):
    """Remove a format from log_formats.json."""
    raw = get_raw_formats(FORMATS_PATH)
    if name not in raw:
        raise HTTPException(status_code=404, detail=f"Format '{name}' not found.")
    del raw[name]
    save_formats(raw, FORMATS_PATH)
    return {'deleted': name, 'total_formats': len(raw)}


@app.post('/api/formats/generate')
async def generate_format(req: FormatGenerateRequest):
    """
    Send sample lines to Ollama — returns a complete format definition
    ready to pre-fill the add-format form in the UI.
    """
    if len(req.sample_lines) < 2:
        raise HTTPException(
            status_code=422,
            detail='Please provide at least 2 sample log lines.',
        )
    try:
        result = await ask_ollama_for_format(req.sample_lines)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
# SESSION + HEALTH
# ================================================================

@app.delete('/api/session')
async def delete_session(session = Depends(get_session)):
    """Wipe entire session — all files, JSON, and in-memory state."""
    store.delete_session(session.session_id)
    return {'deleted': session.session_id}


@app.get('/api/health')
async def health():
    return {
        'status':          'ok',
        'timestamp':       datetime.utcnow().isoformat(),
        'active_sessions': len(store._sessions),
    }
