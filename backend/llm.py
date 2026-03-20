"""
LLM Module
==========
Builds CSV context from match results and streams Ollama responses
as Server-Sent Events (SSE).

Multi-turn strategy:
    Turn 1 : system = SYSTEM_PROMPT + full CSV  |  user = question
    Turn N : system = SYSTEM_PROMPT + full CSV  |  history + user = stat_header + question

    CSV lives in the system message — paid once per call.
    Follow-up turns only add history + a compact stat reminder.
    This keeps follow-up token cost low while the model always has
    the full dataset in context (Ollama is stateless — no memory
    between calls, so CSV must be re-sent every time).

Change model:
    Edit OLLAMA_MODEL below.  Run: ollama pull <model_name> first.
"""

import csv
import io
import json
from typing import List, Dict, Optional, AsyncGenerator


# ── Change this to switch models ─────────────────────────────────
OLLAMA_MODEL = 'deepseek-v3.1:671b-cloud'   # e.g. 'llama3.2', 'mistral', 'gemma2'
# ─────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a log file analysis assistant.
You have been given COMPLETE log data as a CSV table — every filtered row is present.
Columns: source_file, line, timestamp, and any available fields from:
component, level, thread, file (source code file), message, extra_* fields.
Answer questions based ONLY on the data provided.
Reference specific line numbers and timestamps when relevant.
When counting or aggregating, use the FULL dataset — do not estimate.
Be concise and precise."""


# ================================================================
# CSV builder
# ================================================================

def build_csv_from_matches(
    matches:          List[Dict],
    available_fields: List[str],
) -> str:
    """
    Convert a list of match dicts (from SearchOperations.find_combined)
    to a CSV string for the LLM context.

    Always includes: source_file, line, timestamp, message.
    Conditionally includes: component, level, thread_id, file_path.
    Appends extra_* columns for any extra fields present.

    csv.writer auto-quotes cells that contain commas, quotes, or newlines
    so log messages with commas are handled correctly with no extra code.
    """
    if not matches:
        return ''

    avail = set(available_fields)
    buf   = io.StringIO()

    # Build header
    headers = ['source_file', 'line', 'timestamp']
    if 'component'  in avail: headers.append('component')
    if 'level'      in avail: headers.append('level')
    if 'thread_id'  in avail: headers.append('thread')
    if 'file_path'  in avail: headers.append('file')
    headers.append('message')

    # Collect all extra field keys present across matches
    extra_keys = sorted({
        k
        for m in matches
        for k in (m.get('extra_fields') or {}).keys()
    })
    headers.extend(f'extra_{k}' for k in extra_keys)

    writer = csv.writer(buf)
    writer.writerow(headers)

    for m in matches:
        row = [
            m.get('source_file', ''),
            m.get('actual_line_number', ''),
            m.get('timestamp', ''),
        ]
        if 'component'  in avail: row.append(m.get('component')  or '')
        if 'level'      in avail: row.append(m.get('level')      or '')
        if 'thread_id'  in avail: row.append(m.get('thread_id')  or '')
        if 'file_path'  in avail: row.append(m.get('file_path')  or '')
        row.append(m.get('message', ''))
        ef = m.get('extra_fields') or {}
        for k in extra_keys:
            row.append(ef.get(k, ''))
        writer.writerow(row)

    return buf.getvalue()


# ================================================================
# Stat header (compact summary re-sent on every turn)
# ================================================================

def build_stat_header(match_summary: Dict) -> str:
    """
    Compact plain-text summary of the filtered dataset.
    Included in every user message so the model always knows
    the dataset size even on turn 3, 4, etc.
    """
    tr    = match_summary.get('time_range', {})
    lr    = match_summary.get('line_range', {})
    total = match_summary.get('total', 0)

    lines = [
        '=== CURRENT FILTER CONTEXT ===',
        f"Total entries  : {total:,}",
        f"Line range     : {lr.get('first', '?')} → {lr.get('last', '?')}",
        f"Time range     : {tr.get('first', '?')} → {tr.get('last', '?')}",
    ]
    if match_summary.get('levels'):
        level_str = ', '.join(
            f"{k}:{v}" for k, v in match_summary['levels'].items()
        )
        lines.append(f"Levels         : {level_str}")
    if match_summary.get('components'):
        top = list(match_summary['components'].items())[:6]
        lines.append(f"Top components : {top}")

    return '\n'.join(lines)


# ================================================================
# Message builder
# ================================================================

def build_messages(
    question:      str,
    csv_data:      str,
    match_summary: Dict,
    history:       List[Dict],
) -> List[Dict]:
    """
    Assemble the messages list for Ollama.

    Turn 1 (empty history):
        system = SYSTEM_PROMPT + CSV
        user   = question

    Turn N (has history):
        system  = SYSTEM_PROMPT + CSV  (re-attached — Ollama is stateless)
        history = all prior turns
        user    = stat_header + question
    """
    system_content = (
        f"{SYSTEM_PROMPT}\n\n"
        f"=== COMPLETE LOG DATA (CSV) ===\n"
        f"{csv_data}"
    )

    messages = [{'role': 'system', 'content': system_content}]

    if not history:
        # First turn — just the question
        messages.append({'role': 'user', 'content': question})
    else:
        # Subsequent turns — replay history then compact header + question
        for turn in history:
            messages.append({'role': turn['role'], 'content': turn['content']})
        stat_header = build_stat_header(match_summary)
        messages.append({
            'role':    'user',
            'content': f"{stat_header}\n\nQuestion: {question}",
        })

    return messages


# ================================================================
# SSE streaming
# ================================================================

async def stream_ollama_response(
    question:      str,
    csv_data:      str,
    match_summary: Dict,
    history:       List[Dict],
) -> AsyncGenerator[str, None]:
    """
    Async generator that yields Server-Sent Event strings.

    SSE format (each yielded string is one complete SSE event):
        data: {"type": "token",  "content": "Hello"}\\n\\n
        data: {"type": "done",   "content": ""}\\n\\n
        data: {"type": "error",  "content": "Error message"}\\n\\n

    The browser's EventSource.onmessage receives the JSON after
    the 'data: ' prefix is stripped automatically.
    """
    try:
        import ollama
    except ImportError:
        yield _sse({'type': 'error', 'content':
            'ollama package not installed. Run: pip install ollama'})
        return

    if not csv_data:
        yield _sse({'type': 'error', 'content':
            'No data in context. Select files and apply filters first.'})
        return

    messages = build_messages(question, csv_data, match_summary, history)

    try:
        stream = ollama.chat(
            model    = OLLAMA_MODEL,
            messages = messages,
            stream   = True,
            options  = {
                'temperature': 0.1,
                'num_ctx':     131072,   # request 128k context window
            }
        )
        for chunk in stream:
            token = chunk.get('message', {}).get('content', '')
            if token:
                yield _sse({'type': 'token', 'content': token})

        yield _sse({'type': 'done', 'content': ''})

    except Exception as e:
        yield _sse({'type': 'error', 'content': (
            f"Ollama error: {e}\n\n"
            f"Troubleshooting:\n"
            f"• Make sure Ollama is running: ollama serve\n"
            f"• Pull the model: ollama pull {OLLAMA_MODEL}\n"
            f"• Context too large? Narrow your filters to reduce entries."
        )})


# ================================================================
# Utilities
# ================================================================

def estimate_tokens(csv_data: str) -> int:
    """Rough token estimate: 1 token ≈ 4 characters."""
    return len(csv_data) // 4


def _sse(payload: Dict) -> str:
    """Format a dict as a single Server-Sent Events line."""
    return f"data: {json.dumps(payload)}\n\n"
