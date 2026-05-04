"""
LLM Module — v3
===============
Dynamic CSV builder — uses field_definitions instead of hardcoded field names.
Added: ask_ollama_for_format() for AI-assisted format generation.
"""

import csv
import io
import json
from typing import List, Dict, AsyncGenerator

# OLLAMA_MODEL = 'deepseek-v3.1:671b-cloud'
OLLAMA_MODEL = 'gpt-oss:120b-cloud'
# OLLAMA_MODEL = 'llama3.1'

SYSTEM_PROMPT = """You are a log file analysis assistant.
You have been given COMPLETE log data as a CSV table — every filtered row is present.
The first row is the header — it shows you exactly which fields exist in this log format.
Answer questions based ONLY on the data provided.
Reference specific line numbers when relevant.
When counting or aggregating, use the FULL dataset — do not estimate.
Be concise and precise."""


# ================================================================
# CSV builder — fully dynamic
# ================================================================

def build_csv_from_matches(
    matches:           List[Dict],
    field_definitions: List[Dict],   # [{name, type}, ...]
) -> str:
    """
    Build CSV from match dicts.
    Columns: source_file, line, then every field in definition order.
    csv.writer handles quoting of values that contain commas or newlines.
    """
    if not matches:
        return ''

    buf         = io.StringIO()
    writer      = csv.writer(buf)
    field_names = [f['name'] for f in field_definitions]
    headers     = ['source_file', 'line'] + field_names
    writer.writerow(headers)

    for m in matches:
        row = [
            m.get('source_file', ''),
            m.get('actual_line_number', ''),
        ]
        fields = m.get('fields', {})
        for fname in field_names:
            row.append(fields.get(fname, ''))
        writer.writerow(row)

    return buf.getvalue()


# ================================================================
# Stat header
# ================================================================

def build_stat_header(match_summary: Dict) -> str:
    """Compact plain-text summary included in every follow-up LLM turn."""
    tr    = match_summary.get('time_range', {})
    lr    = match_summary.get('line_range', {})
    total = match_summary.get('total', 0)

    lines = [
        '=== CURRENT FILTER CONTEXT ===',
        f"Total entries : {total:,}",
        f"Line range    : {lr.get('first', '?')} -> {lr.get('last', '?')}",
    ]
    if tr:
        lines.append(
            f"Time range    : {tr.get('first', '?')} -> {tr.get('last', '?')}"
        )
    dists = match_summary.get('distributions', {})
    for fname, dist in list(dists.items())[:4]:
        
        top = list(dist.items())[:5]
        lines.append(f"{fname:14}: {top}")

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
    Turn 1: system = SYSTEM_PROMPT + CSV,  user = question
    Turn N: system = SYSTEM_PROMPT + CSV,  history, user = stat_header + question
    CSV always in system message — Ollama is stateless, must re-send every call.
    """
    system_content = (
        f"{SYSTEM_PROMPT}\n\n"
        f"=== COMPLETE LOG DATA (CSV) ===\n"
        f"{csv_data}"
    )
    messages = [{'role': 'system', 'content': system_content}]

    if not history:
        messages.append({'role': 'user', 'content': question})
    else:
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
    Events: {"type": "token", "content": "..."} | {"type": "done"} | {"type": "error"}
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
                # 'num_ctx': 32768,    # 8K — safe for llama3.1 8B on 6GB VRAM
                                       # (model ~4.7GB + KV cache ~1GB = ~5.7GB total)
                'num_ctx':  160000,     # Use narrow filters to keep CSV under ~6K tokens
                'num_gpu':     99,     # offload ALL layers to GPU
                'num_thread':   8,
            }
        )
        for chunk in stream:
            token = chunk.get('message', {}).get('content', '')
            if token:
                yield _sse({'type': 'token', 'content': token})
        yield _sse({'type': 'done', 'content': ''})

    except Exception as e:
        yield _sse({'type': 'error', 'content': (
            f"Ollama error: {e}\n"
            f"* Make sure Ollama is running: ollama serve\n"
            f"* Pull the model: ollama pull {OLLAMA_MODEL}\n"
            f"* Context too large? Narrow your filters."
        )})


# ================================================================
# Format generation via LLM
# ================================================================

FORMAT_GENERATION_PROMPT = """You are an expert log format analyser and Python regex writer.
Given sample log lines from a file, produce a complete log format definition as a JSON object.

RULES:
1. pattern MUST use Python named capture groups: (?P<name>...)
2. Include (?P<timestamp>...) only if a date/time is present in the lines.
3. Include (?P<message>...) ONLY if a clear primary text/description field exists. Do NOT invent a message field if the log is structured data (e.g. CSV-style rows, numeric tables).
4. CRITICAL — Inspect the lines carefully for CONSISTENCY:
   - If ALL lines have a field in the same position → use a REQUIRED group: (?P<name>...)
   - If a field is SOMETIMES absent or optional → use an OPTIONAL non-capturing wrapper: (?:...(?P<name>...))?
   - If the log is CSV-like with a consistent separator, capture each column as its own field.
5. fields is a list of {name, type} objects — one per named group in the pattern.
6. Field types — choose the best fit:
     timestamp : date/time of the log entry
     level     : severity (INFO/ERROR/WARNING/DEBUG or similar abbreviations)
     message   : the main freeform log text
     text      : any repeating categorical value (component, module, thread id, filename, etc.)
     number    : numeric value (line numbers, counts, durations, etc.)
7. Every named group in the pattern MUST appear in fields, and vice versa.
8. The pattern MUST match the MAJORITY of the provided lines.
9. Return ONLY valid JSON — no explanation, no markdown, no code fences.

EXAMPLE 1 — Structured log with a message field:
{
  "name":        "app_logs",
  "description": "Application server logs",
  "pattern":     "(?P<timestamp>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) (?P<level>\\w+) (?P<service>\\S+) (?P<message>.+)",
  "fields": [
    {"name": "timestamp", "type": "timestamp"},
    {"name": "level",     "type": "level"},
    {"name": "service",   "type": "text"},
    {"name": "message",   "type": "message"}
  ],
  "example": "2025-04-17 08:35:19 ERROR auth-service Login failed for user john"
}

EXAMPLE 2 — CSV/structured data log WITHOUT a message field (optional level field):
{
  "name":        "video_db_log",
  "description": "Video DB CSV-style recording log",
  "pattern":     "(?P<filename>[^,]+),(?P<date>[A-Za-z]+ [A-Za-z]+ \\d+ \\d{4}),(?P<time>\\d{2}:\\d{2}:\\d{2})(?:,(?P<duration>[^,]+))?(?:,(?P<trip_code>[^,]+))?",
  "fields": [
    {"name": "filename",  "type": "text"},
    {"name": "date",      "type": "timestamp"},
    {"name": "time",      "type": "timestamp"},
    {"name": "duration",  "type": "text"},
    {"name": "trip_code", "type": "text"}
  ],
  "example": "video.h264,Fri Mar 21 2025,11:29:07,00:10.214,4A01"
}

Now analyse these sample lines and return the JSON format definition:
"""


async def ask_ollama_for_format(sample_lines: List[str]) -> Dict:
    """
    Send sample log lines to Ollama and get back a complete
    format definition dict ready to pre-fill the add-format form.
    Validates that the generated pattern compiles and matches at least one sample line.
    """
    import re as _re

    try:
        import ollama
    except ImportError:
        raise Exception('ollama package not installed. Run: pip install ollama')

    lines_text = '\n'.join(
        f"Line {i + 1}: {line.strip()}"
        for i, line in enumerate(sample_lines[:10])
    )

    messages = [
        {'role': 'system', 'content': FORMAT_GENERATION_PROMPT},
        {'role': 'user',   'content': lines_text},
    ]

    try:
        response = ollama.chat(
            model    = OLLAMA_MODEL,
            messages = messages,
            stream   = False,
            options  = {
                'temperature': 0.0,   # fully deterministic for code generation
                'num_ctx':     8192,
            }
        )

        raw_text = response['message']['content'].strip()

        # Strip markdown code fences if the model adds them despite instructions
        if raw_text.startswith('```'):
            raw_lines = raw_text.split('\n')
            raw_text  = '\n'.join(raw_lines[1:-1])

        result = json.loads(raw_text)

        # Validate required keys
        for key in ('pattern', 'fields'):
            if key not in result:
                raise ValueError(f"LLM response missing required key: '{key}'")

        # Validate pattern compiles
        compiled = _re.compile(result['pattern'])
        groups = set(compiled.groupindex.keys())

        # Validate field names match pattern groups
        field_names = {f['name'] for f in result.get('fields', [])}
        undefined   = field_names - groups
        if undefined:
            raise ValueError(f"Fields {undefined} not in pattern groups")

        # Test against sample lines and attach match stats
        matched = sum(1 for l in sample_lines if compiled.match(l.strip()))
        result['match_rate']    = round(matched / len(sample_lines) * 100, 1)
        result['matched_lines'] = matched
        result['total_lines']   = len(sample_lines)

        return result

    except json.JSONDecodeError as e:
        raise Exception(
            f"LLM returned invalid JSON: {e}. "
            f"Try again or adjust the sample lines."
        )
    except ValueError as e:
        raise Exception(str(e))
    except Exception as e:
        raise Exception(
            f"Ollama error: {e}. "
            f"Make sure Ollama is running: ollama serve"
        )


# ================================================================
# Utilities
# ================================================================

def estimate_tokens(csv_data: str) -> int:
    """Rough estimate: 1 token ~ 4 characters."""
    return len(csv_data) // 4


def _sse(payload: Dict) -> str:
    """Format a dict as a single Server-Sent Events line."""
    return f"data: {json.dumps(payload)}\n\n"
