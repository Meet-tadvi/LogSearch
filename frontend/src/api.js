/**
 * api.js — centralised backend communication layer
 *
 * Every function here talks to the FastAPI backend.
 * The session UUID is generated once per browser and stored in
 * localStorage.  It is sent as X-Session-ID on every request so
 * the backend knows which session to use.
 *
 * Swap BASE_URL to point at a different host/port if needed.
 */

const BASE_URL = 'http://localhost:8000'

// ── Session ID ────────────────────────────────────────────────
export function getSessionId() {
  let id = localStorage.getItem('log_search_session_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('log_search_session_id', id)
  }
  return id
}

// ── Base fetch helpers ────────────────────────────────────────
function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Session-ID': getSessionId(),
  }
}

function fileHeaders() {
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
  const res = await fetch(BASE_URL + path, {
    headers: fileHeaders(),
  })
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
 * Returns { uploaded: [{file_id, filename, status, format, ...}] }
 */
export async function uploadFiles(fileList) {
  const form = new FormData()
  for (const f of fileList) form.append('files', f)

  const res = await fetch(BASE_URL + '/api/files/upload', {
    method:  'POST',
    headers: fileHeaders(),   // NO Content-Type — browser sets multipart boundary
    body:    form,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || res.statusText)
  }
  return res.json()
}

/** Returns { files: [{file_id, filename, format, entry_count, ...}] } */
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
 * Fetch filter dropdown options for the selected files.
 * fileIds: string[] | null (null = all files)
 * Returns { levels, components, thread_ids, available_fields }
 */
export async function getMetadata(fileIds) {
  const qs = fileIds && fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
  return get(`/api/metadata${qs}`)
}

// ================================================================
// SEARCH
// ================================================================

/**
 * Main search call.
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

// ================================================================
// EXPORT
// ================================================================

/**
 * Trigger a CSV download of all filtered results.
 * Uses a hidden <a> tag to trigger the browser save dialog.
 */
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

/**
 * Get token estimate without building the full CSV.
 * Returns { total_entries, est_tokens, est_size_kb }
 */
export async function getContextInfo(fileIds) {
  const qs = fileIds && fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
  return get(`/api/llm/context-info${qs}`)
}

/**
 * Stream an LLM chat response via Server-Sent Events.
 *
 * Reads the SSE stream from POST /api/llm/chat using fetch + ReadableStream.
 * Calls onToken(str) for each token chunk.
 * Calls onDone() when the model finishes.
 * Calls onError(str) on any error.
 */
export async function streamLLMChat(params, onToken, onDone, onError) {
  let res
  try {
    res = await fetch(BASE_URL + '/api/llm/chat', {
      method:  'POST',
      headers: jsonHeaders(),
      body:    JSON.stringify(params),
    })
  } catch (err) {
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

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()   // keep last incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'token') onToken(event.content)
        else if (event.type === 'done')  onDone()
        else if (event.type === 'error') onError(event.content)
      } catch {
        // malformed JSON chunk — skip
      }
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
