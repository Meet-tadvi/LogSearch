/**
 * api.js — centralised backend communication layer — v3
 *
 * All fetch() calls go through here.
 * Session UUID generated once per browser, stored in localStorage,
 * sent as X-Session-ID on every request.
 *
 * Key change from v2:
 *   search() now sends a `filters` dict instead of fixed
 *   levels / components / threads fields.
 *   e.g. filters: { "level": ["ERROR"], "component": ["GPS"] }
 *
 * New function:
 *   generateFormat(sampleLines) -> calls POST /api/formats/generate
 */

// Use relative paths in production (PyWebview) to avoid CORS issues
const BASE_URL = import.meta.env.DEV ? 'http://localhost:8000' : ''

// ── Session ID ────────────────────────────────────────────────────
export function getSessionId() {
  let id = localStorage.getItem('log_search_session_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('log_search_session_id', id)
  }
  return id
}

// ── Base fetch helpers ────────────────────────────────────────────
function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Session-ID': getSessionId(),
  }
}

function fileHeaders() {
  // No Content-Type — browser sets multipart boundary automatically
  return { 'X-Session-ID': getSessionId() }
}

async function post(path, body) {
  const res = await fetch(BASE_URL + path, {
    method:  'POST',
    headers: jsonHeaders(),
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || res.statusText)
  }
  return res.json()
}

async function get(path) {
  const res = await fetch(BASE_URL + path, { headers: fileHeaders() })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || res.statusText)
  }
  return res.json()
}

async function del(path) {
  const res = await fetch(BASE_URL + path, {
    method:  'DELETE',
    headers: jsonHeaders(),
  })
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

// ================================================================
// FILE endpoints
// ================================================================

/**
 * Upload one or more File objects.
 * Returns { uploaded: [{file_id, filename, status, format,
 *                       field_definitions, time_range, ...}] }
 */
export async function uploadFiles(fileList) {
  const form = new FormData()
  for (const f of fileList) form.append('files', f)

  const res = await fetch(BASE_URL + '/api/files/upload', {
    method:  'POST',
    headers: fileHeaders(),
    body:    form,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || res.statusText)
  }
  return res.json()
}

/** Returns { files: [{file_id, filename, format, field_definitions, time_range, ...}] } */
export async function listFiles() {
  return get('/api/files')
}

/** Remove one file from the session. */
export async function deleteFile(fileId) {
  return del(`/api/files/${fileId}`)
}

// ================================================================
// METADATA
// ================================================================

/**
 * Fetch field definitions and distinct values for the selected files.
 * fileIds: string[] | null (null = all files)
 *
 * Returns:
 *   {
 *     field_definitions: [{name, type}, ...],
 *     distinct_values:   { field_name: [value, ...], ... }
 *   }
 *
 * The frontend uses distinct_values to build sidebar dropdowns dynamically.
 * Every text/level/number field gets its own multiselect.
 */
export async function getMetadata(fileIds) {
  const qs = fileIds && fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
  return get(`/api/metadata${qs}`)
}

// ================================================================
// SEARCH
// ================================================================

/**
 * Main search call — fully dynamic filters.
 *
 * params shape:
 *   {
 *     file_ids:    string[] | null,
 *     text:        string   | null,
 *     filters:     { field_name: [allowed_values] } | null,
 *     time_start:  string   | null,
 *     time_end:    string   | null,
 *     line_start:  number   | null,
 *     line_end:    number   | null,
 *     file_filter: string   | null,
 *     page:        number,
 *     page_size:   number,
 *   }
 *
 * Returns { matches, total, page, total_pages, summary }
 */
export async function search(params) {
  return post('/api/search', params)
}

// ================================================================
// SUMMARY
// ================================================================

/** Full statistics for the selected files. */
export async function getSummary(fileIds) {
  const qs = fileIds && fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
  return get(`/api/summary${qs}`)
}

/** Per-file statistics array. */
export async function getPerFileSummaries(fileIds) {
  const qs = fileIds && fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
  return get(`/api/summary/per-file${qs}`)
}

// ================================================================
// EXPORT
// ================================================================

/** Trigger a CSV download of all filtered results. */
export async function exportCsv(params) {
  const res = await fetch(BASE_URL + '/api/export/csv', {
    method:  'POST',
    headers: jsonHeaders(),
    body:    JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'filtered_logs.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** Trigger a CSV download of unparsed lines. */
export async function exportUnparsed(fileIds) {
  const res = await fetch(BASE_URL + '/api/export/unparsed', {
    method:  'POST',
    headers: jsonHeaders(),
    body:    JSON.stringify(fileIds || null),
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'unparsed_lines.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ================================================================
// LLM
// ================================================================

/** Token estimate without building the full CSV. */
export async function getContextInfo(fileIds) {
  const qs = fileIds && fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
  return get(`/api/llm/context-info${qs}`)
}

/** First 50 rows of the exact CSV that would be sent to Ollama. */
export async function getCsvPreview(params) {
  return post('/api/llm/csv-preview', params)
}

/**
 * Stream an LLM chat response via Server-Sent Events.
 *
 * params shape:
 *   {
 *     question: string,
 *     file_ids: string[] | null,
 *     filters:  SearchRequest | null,
 *     history:  [{role, content}] | null,
 *   }
 *
 * Callbacks:
 *   onToken(str)    — called for each streamed token
 *   onDone()        — called when the model finishes naturally
 *   onError(str)    — called on any network / model error
 *   onStopped()     — called when user aborts mid-stream (optional)
 *
 * @param {AbortSignal} [signal]    - Optional AbortSignal from an AbortController
 * @param {function}    [onStopped] - Called when aborted by the user
 */
export async function streamLLMChat(params, onToken, onDone, onError, signal, onStopped) {
  let res
  try {
    res = await fetch(BASE_URL + '/api/llm/chat', {
      method:  'POST',
      headers: jsonHeaders(),
      body:    JSON.stringify(params),
      signal,                        // ← AbortController signal
    })
  } catch (err) {
    if (err.name === 'AbortError') { onStopped?.(); return }
    onError(`Network error: ${err.message}`)
    return
  }

  if (!res.ok) {
    onError(`HTTP ${res.status}: ${res.statusText}`)
    return
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()   // keep last incomplete line for next iteration

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'token')      onToken(event.content)
          else if (event.type === 'done')  onDone()
          else if (event.type === 'error') onError(event.content)
        } catch {
          // malformed JSON chunk — skip silently
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      reader.cancel()   // release the stream lock
      onStopped?.()
    } else {
      onError(`Stream error: ${err.message}`)
    }
  }
}

// ================================================================
// FORMATS
// ================================================================

/** List all log formats. */
export async function listFormats() {
  return get('/api/formats')
}

/**
 * Add a new log format.
 * body: { name, description, pattern, fields: [{name, type}], example }
 */
export async function addFormat(body) {
  return post('/api/formats', body)
}

/** Remove a format by name. */
export async function deleteFormat(name) {
  return del(`/api/formats/${encodeURIComponent(name)}`)
}

/**
 * Upload a log file directly for AI-assisted format generation.
 * file: File object from a file input or drag-and-drop event.
 * Returns: { name, description, pattern, fields, example, match_rate,
 *            sampled_lines, total_sampled, source_file, ... }
 */
export async function generateFormatFromFile(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(BASE_URL + '/api/formats/generate-from-file', {
    method:  'POST',
    headers: fileHeaders(),
    body:    form,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || res.statusText)
  }
  return res.json()
}

// ================================================================
// SESSION / HEALTH
// ================================================================

/** Wipe the entire session (all files + data). */
export async function deleteSession() {
  return del('/api/session')
}

/** Health check. */
export async function getHealth() {
  return get('/api/health')
}
