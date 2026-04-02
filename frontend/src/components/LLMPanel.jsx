/**
 * LLMPanel.jsx
 *
 * Fix 2: token estimate computed from filtered totalEntries prop (not getContextInfo
 *        which returns total entries, not filtered entries)
 * Fix 5: history + onHistoryChange received as props (state lives in App.jsx)
 *        so chat history survives tab switches
 */

import { useState, useRef, useEffect } from 'react'
import * as api from '../api.js'

const WARN_TOKENS  = 50_000
const ERROR_TOKENS = 100_000

function tokenColor(n) {
  if (n > ERROR_TOKENS) return '#f85149'
  if (n > WARN_TOKENS)  return '#d29922'
  return '#3fb950'
}

function MessageBubble({ role, content }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className="rounded-lg px-3 py-2 max-w-[85%] text-xs font-mono whitespace-pre-wrap leading-relaxed"
        style={{
          background: isUser ? 'rgba(240,165,0,.15)' : '#161b22',
          border:     `1px solid ${isUser ? 'rgba(240,165,0,.4)' : '#30363d'}`,
          color:      '#e6edf3',
        }}
      >
        {content}
      </div>
    </div>
  )
}

export default function LLMPanel({
  selectedIds, appliedFilters, availableFields, totalEntries,
  history, onHistoryChange,   // Fix 5: from App.jsx state
}) {
  const [streaming,   setStreaming]   = useState(false)
  const [streamBuf,   setStreamBuf]   = useState('')
  const [question,    setQuestion]    = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewCsv,  setPreviewCsv]  = useState('')
  const bottomRef          = useRef(null)
  const abortControllerRef = useRef(null)  // holds the AbortController for the active request

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, streamBuf])

  // Fix 2: compute token estimate directly from filtered totalEntries prop.
  // getContextInfo returns TOTAL entries (unfiltered) — wrong for filtered context.
  // 80 chars/row average, 4 chars/token — same formula as backend.
  const estTokens = Math.round(totalEntries * 80 / 4)
  const estKb     = Math.round(totalEntries * 80 / 1024)

  async function handleSend() {
    if (!question.trim() || streaming) return
    const q = question.trim()
    setQuestion('')

    const newHistory = [...history, { role: 'user', content: q }]
    onHistoryChange(newHistory)
    setStreaming(true)
    setStreamBuf('')

    // Fresh AbortController for this request
    const controller = new AbortController()
    abortControllerRef.current = controller

    let fullResponse = ''

    await api.streamLLMChat(
      {
        question: q,
        file_ids: selectedIds.length ? selectedIds : null,
        filters: {
          text:        appliedFilters.text        || null,
          levels:      appliedFilters.levels.length      ? appliedFilters.levels      : null,
          components:  appliedFilters.components.length  ? appliedFilters.components  : null,
          threads:     appliedFilters.threads.length     ? appliedFilters.threads     : null,
          file_filter: appliedFilters.file_filter || null,
          time_start:  appliedFilters.time_start  || null,
          time_end:    appliedFilters.time_end    || null,
          line_start:  appliedFilters.line_start  ? parseInt(appliedFilters.line_start) : null,
          line_end:    appliedFilters.line_end    ? parseInt(appliedFilters.line_end)   : null,
        },
        history: newHistory.slice(0, -1),
      },
      (token) => { fullResponse += token; setStreamBuf(fullResponse) },
      () => {
        // Natural completion
        abortControllerRef.current = null
        onHistoryChange([...newHistory, { role: 'assistant', content: fullResponse }])
        setStreamBuf(''); setStreaming(false)
      },
      (err) => {
        // Error from Ollama / network
        abortControllerRef.current = null
        onHistoryChange([...newHistory, { role: 'assistant', content: `⚠️ ${err}` }])
        setStreamBuf(''); setStreaming(false)
      },
      controller.signal,   // AbortSignal ← passed to fetch()
      () => {
        // User clicked Stop — save whatever arrived so far
        abortControllerRef.current = null
        const saved = fullResponse
          ? fullResponse + '\n\n⏹️ _Stopped by user._'
          : '⏹️ _Stopped before any output._'
        onHistoryChange([...newHistory, { role: 'assistant', content: saved }])
        setStreamBuf(''); setStreaming(false)
      },
    )
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleLoadPreview() {
    setPreviewCsv('Loading…')
    try {
      const data = await api.getCsvPreview({
        file_ids: selectedIds.length ? selectedIds : null,
        filters: {
          text:        appliedFilters.text        || null,
          levels:      appliedFilters.levels.length      ? appliedFilters.levels      : null,
          components:  appliedFilters.components.length  ? appliedFilters.components  : null,
          threads:     appliedFilters.threads.length     ? appliedFilters.threads     : null,
          file_filter: appliedFilters.file_filter || null,
          time_start:  appliedFilters.time_start  || null,
          time_end:    appliedFilters.time_end    || null,
          line_start:  appliedFilters.line_start  ? parseInt(appliedFilters.line_start) : null,
          line_end:    appliedFilters.line_end    ? parseInt(appliedFilters.line_end)   : null,
        },
      })
      setPreviewCsv(data.csv || 'No data.')
    } catch (e) {
      setPreviewCsv(`Error: ${e.message}`)
    }
  }

  if (!selectedIds.length) {
    return <div className="text-muted text-sm">Select files to use the LLM panel.</div>
  }

  return (
    <div className="flex flex-col h-full max-w-3xl gap-3">

      {/* Context info bar */}
      <div className="card card-accent flex flex-wrap items-center gap-3">
        <span className="font-mono font-bold text-xs text-accent">// llm_chat</span>
        <span className="text-muted text-xs">
          📊 <span className="text-text font-semibold">{totalEntries.toLocaleString()}</span> entries
          &nbsp;·&nbsp; ~<span className="text-text font-semibold">{estKb.toLocaleString()} KB</span>
          &nbsp;·&nbsp; ~<span style={{ color: tokenColor(estTokens) }} className="font-semibold">
            {estTokens.toLocaleString()} tokens
          </span>
        </span>

        {estTokens > WARN_TOKENS && (
          <span className="chip" style={{ color: tokenColor(estTokens) }}>
            {estTokens > ERROR_TOKENS
              ? '❌ Exceeds context limit — narrow filters'
              : '⚠ Large context — model may degrade'}
          </span>
        )}

        <button
          className="btn text-xs ml-auto"
          onClick={() => { if (!showPreview) handleLoadPreview(); setShowPreview(v => !v) }}
        >
          🔍 {showPreview ? 'Hide' : 'Preview'} data
        </button>
      </div>

      {/* CSV preview */}
      {showPreview && (
        <div className="card p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-border text-muted text-xs">
            First 50 rows of data sent to LLM (CSV)
          </div>
          <pre className="p-3 text-xs text-muted overflow-auto max-h-48 font-mono leading-relaxed">
            {previewCsv || 'Loading…'}
          </pre>
        </div>
      )}

      {/* Chat history */}
      <div className="flex-1 overflow-auto flex flex-col min-h-0">
        {history.length === 0 && !streaming && (
          <div className="text-muted text-xs text-center mt-8">
            <div className="text-2xl mb-2">🤖</div>
            Ask anything about the {totalEntries.toLocaleString()} filtered log entries.
            <div className="mt-3 flex flex-col gap-1">
              {[
                'What caused the errors?',
                'Which component has the most warnings?',
                'Summarise the activity between 08:35 and 08:45.',
                'Are there any patterns in the error messages?',
              ].map((ex, i) => (
                <button
                  key={i}
                  className="text-accent/70 hover:text-accent text-xs underline"
                  onClick={() => setQuestion(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((turn, i) => (
          <MessageBubble key={i} role={turn.role} content={turn.content} />
        ))}

        {streaming && streamBuf && (
          <MessageBubble role="assistant" content={streamBuf + '▌'} />
        )}
        {streaming && !streamBuf && (
          <div className="flex justify-start mb-3">
            <div className="card flex items-center gap-2 text-xs text-muted">
              <div className="spinner" /> Thinking…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2 border-t border-border pt-3">
        <input
          className   = "inp flex-1"
          placeholder = {`Ask about ${totalEntries.toLocaleString()} log entries…`}
          value       = {question}
          onChange    = {e => setQuestion(e.target.value)}
          onKeyDown   = {e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled    = {streaming}
        />

        {streaming ? (
          /* Stop button — visible only while generating */
          <button
            id        = "llm-stop-btn"
            className = "btn flex-shrink-0"
            onClick   = {handleStop}
            title     = "Stop generating"
            style={{
              background: 'rgba(248,81,73,.15)',
              border:     '1px solid rgba(248,81,73,.5)',
              color:      '#f85149',
              fontWeight: 600,
            }}
          >
            ⏹️ Stop
          </button>
        ) : (
          <button
            id        = "llm-send-btn"
            className = "btn btn-primary flex-shrink-0"
            onClick   = {handleSend}
            disabled  = {!question.trim()}
          >
            Send ↵
          </button>
        )}

        {history.length > 0 && (
          <button
            className = "btn flex-shrink-0"
            onClick   = {() => { onHistoryChange([]); setStreamBuf('') }}
            disabled  = {streaming}
            title     = "Clear chat history"
          >
            🗑
          </button>
        )}
      </div>

    </div>
  )
}