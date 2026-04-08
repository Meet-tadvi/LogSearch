/**
 * LLMPanel.jsx — v4 (UI Redesign)
 * Better chat bubbles, polished input area, improved context bar.
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
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 10,
      }}
    >
      {!isUser && (
        <div style={{
          width: 28, height: 28,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #1c2333, #21262d)',
          border: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
          marginRight: 10,
          marginTop: 2,
        }}>🤖</div>
      )}
      <div
        className={isUser ? 'msg-user' : 'msg-assistant'}
        style={{ maxWidth: '85%' }}
      >
        {content}
      </div>
      {isUser && (
        <div style={{
          width: 28, height: 28,
          borderRadius: 8,
          background: 'rgba(240,165,0,0.15)',
          border: '1px solid rgba(240,165,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
          marginLeft: 10,
          marginTop: 2,
        }}>👤</div>
      )}
    </div>
  )
}

const EXAMPLE_QUESTIONS = [
  'What caused the errors?',
  'Which component has the most warnings?',
  'Summarise the activity in this time range.',
  'Are there any patterns in the error messages?',
]

export default function LLMPanel({
  selectedIds, appliedFilters, fieldDefinitions, totalEntries,
  history, onHistoryChange,
}) {
  const [streaming,   setStreaming]   = useState(false)
  const [streamBuf,   setStreamBuf]   = useState('')
  const [question,    setQuestion]    = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewCsv,  setPreviewCsv]  = useState('')
  const bottomRef          = useRef(null)
  const abortControllerRef = useRef(null)
  const inputRef           = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, streamBuf])

  const estTokens = Math.round(totalEntries * 80 / 4)
  const estKb     = Math.round(totalEntries * 80 / 1024)

  function buildFiltersReq() {
    return {
      text:        appliedFilters.text        || null,
      filters:     Object.keys(appliedFilters.filters || {}).length
                     ? appliedFilters.filters : null,
      file_filter: appliedFilters.file_filter || null,
      time_start:  appliedFilters.time_start  || null,
      time_end:    appliedFilters.time_end    || null,
      line_start:  appliedFilters.line_start  ? parseInt(appliedFilters.line_start) : null,
      line_end:    appliedFilters.line_end    ? parseInt(appliedFilters.line_end)   : null,
    }
  }

  async function handleSend() {
    if (!question.trim() || streaming) return
    const q = question.trim()
    setQuestion('')

    const newHistory = [...history, { role: 'user', content: q }]
    onHistoryChange(newHistory)
    setStreaming(true)
    setStreamBuf('')

    const controller = new AbortController()
    abortControllerRef.current = controller

    let fullResponse = ''

    await api.streamLLMChat(
      {
        question: q,
        file_ids: selectedIds.length ? selectedIds : null,
        filters:  buildFiltersReq(),
        history:  newHistory.slice(0, -1),
      },
      (token) => { fullResponse += token; setStreamBuf(fullResponse) },
      () => {
        abortControllerRef.current = null
        onHistoryChange([...newHistory, { role: 'assistant', content: fullResponse }])
        setStreamBuf(''); setStreaming(false)
      },
      (err) => {
        abortControllerRef.current = null
        onHistoryChange([...newHistory, { role: 'assistant', content: `⚠️ ${err}` }])
        setStreamBuf(''); setStreaming(false)
      },
      controller.signal,
      () => {
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
        filters:  buildFiltersReq(),
      })
      setPreviewCsv(data.csv || 'No data.')
    } catch (e) {
      setPreviewCsv(`Error: ${e.message}`)
    }
  }

  if (!selectedIds.length) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: 320,
        gap: 12,
        color: '#6e7681',
      }}>
        <div style={{ fontSize: 36, opacity: 0.4 }}>🤖</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14 }}>Select files to use the LLM panel</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: 12 }}>

      {/* ── Context info bar ── */}
      <div className="card card-accent" style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12, color: '#f0a500', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            LLM Context
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>
              📊 <span style={{ color: '#e6edf3', fontWeight: 600 }}>{totalEntries.toLocaleString()}</span> entries
            </span>
            <span style={{ color: '#30363d' }}>·</span>
            <span>
              ~<span style={{ color: '#e6edf3', fontWeight: 600 }}>{estKb.toLocaleString()} KB</span>
            </span>
            <span style={{ color: '#30363d' }}>·</span>
            <span>
              ~<span style={{ color: tokenColor(estTokens), fontWeight: 600 }}>
                {estTokens.toLocaleString()} tokens
              </span>
            </span>
          </div>
        </div>

        {estTokens > WARN_TOKENS && (
          <span className="chip" style={{ color: tokenColor(estTokens), background: tokenColor(estTokens) + '1a', borderColor: tokenColor(estTokens) + '44' }}>
            {estTokens > ERROR_TOKENS
              ? '❌ Exceeds context limit — narrow filters'
              : '⚠ Large context — model may degrade'}
          </span>
        )}

        <button
          className="btn"
          style={{ marginLeft: 'auto', fontSize: 12 }}
          onClick={() => {
            if (!showPreview) handleLoadPreview()
            setShowPreview(v => !v)
          }}
        >
          🔍 {showPreview ? 'Hide' : 'Preview'} data
        </button>
      </div>

      {/* ── CSV preview ── */}
      {showPreview && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '8px 14px',
            borderBottom: '1px solid #21262d',
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            color: '#6e7681',
            background: '#1c2333',
          }}>
            First 50 rows of data sent to LLM (CSV format)
          </div>
          <pre style={{
            padding: 14,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            color: '#8b949e',
            overflow: 'auto',
            maxHeight: 200,
            margin: 0,
            lineHeight: 1.6,
          }}>
            {previewCsv || 'Loading…'}
          </pre>
        </div>
      )}

      {/* ── Chat history ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0, padding: '4px 0' }}>
        {history.length === 0 && !streaming && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 16,
            color: '#6e7681',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40 }}>🤖</div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#8b949e' }}>
              Ask anything about the{' '}
              <strong style={{ color: '#e6edf3' }}>{totalEntries.toLocaleString()}</strong>{' '}
              filtered log entries
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {EXAMPLE_QUESTIONS.map((ex, i) => (
                <button
                  key={i}
                  style={{
                    background: 'rgba(240,165,0,0.08)',
                    border: '1px solid rgba(240,165,0,0.2)',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 13,
                    color: '#c9a14a',
                    cursor: 'pointer',
                    transition: 'all .18s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,165,0,0.14)'; e.currentTarget.style.color = '#f0a500' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(240,165,0,0.08)'; e.currentTarget.style.color = '#c9a14a' }}
                  onClick={() => { setQuestion(ex); inputRef.current?.focus() }}
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
          <MessageBubble
            role="assistant"
            content={streamBuf}
          />
        )}
        {streaming && !streamBuf && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10, alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1c2333, #21262d)',
              border: '1px solid #30363d',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14,
            }}>🤖</div>
            <div className="card" style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              color: '#8b949e',
            }}>
              <div className="spinner" />
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input row ── */}
      <div style={{
        display: 'flex',
        gap: 8,
        borderTop: '1px solid #21262d',
        paddingTop: 12,
        alignItems: 'flex-end',
      }}>
        <input
          ref         = {inputRef}
          className   = "inp"
          style       = {{ flex: 1, fontSize: 14, padding: '10px 14px' }}
          placeholder = {`Ask about ${totalEntries.toLocaleString()} log entries…`}
          value       = {question}
          onChange    = {e => setQuestion(e.target.value)}
          onKeyDown   = {e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled    = {streaming}
        />
        {streaming ? (
          <button
            id        = "llm-stop-btn"
            className = "btn"
            onClick   = {handleStop}
            title     = "Stop generating"
            style={{
              background:  'rgba(248,81,73,0.12)',
              border:      '1px solid rgba(248,81,73,0.40)',
              color:       '#ff7b72',
              fontWeight:  700,
              padding:     '10px 16px',
              flexShrink:  0,
            }}
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            id        = "llm-send-btn"
            className = "btn btn-primary"
            onClick   = {handleSend}
            disabled  = {!question.trim()}
            style     = {{ padding: '10px 18px', flexShrink: 0 }}
          >
            Send ↵
          </button>
        )}
        {history.length > 0 && (
          <button
            className = "btn btn-ghost"
            onClick   = {() => { onHistoryChange([]); setStreamBuf('') }}
            disabled  = {streaming}
            title     = "Clear chat history"
            style     = {{ padding: '10px 12px', flexShrink: 0 }}
          >
            🗑
          </button>
        )}
      </div>

    </div>
  )
}
