/**
 * LLMPanel.jsx — v6
 * ──────────────────
 * Layout:
 *   • Top bar   : entries · KB · tokens (plain) · Preview data button
 *   • Middle    : chat messages
 *   • Bottom    : [prompt input] [⚙ gear popup] [Send / Stop]
 *
 * Settings popup (YouTube-style, opens above the gear icon):
 *   • Model    — dropdown populated from GET /api/llm/models (Ollama tags only)
 *   • num_ctx  — preset dropdown
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import * as api from '../api.js'

// ── num_ctx presets ───────────────────────────────────────────────
const CTX_PRESETS = [
  { label: '8K  — fast / small',   value: 8_192   },
  { label: '32K — standard',       value: 32_768  },
  { label: '64K — large',          value: 65_536  },
  { label: '128K — very large',    value: 131_072 },
  { label: '160K — maximum',       value: 160_000 },
]

// ── Message bubble ────────────────────────────────────────────────
function MessageBubble({ role, content }) {
  const isUser = role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'linear-gradient(135deg, #1c2333, #21262d)',
          border: '1px solid #30363d',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, flexShrink: 0, marginRight: 10, marginTop: 2,
        }}>🤖</div>
      )}
      <div className={isUser ? 'msg-user' : 'msg-assistant'} style={{ maxWidth: '85%' }}>
        {content}
      </div>
      {isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(240,165,0,0.15)',
          border: '1px solid rgba(240,165,0,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, flexShrink: 0, marginLeft: 10, marginTop: 2,
        }}>👤</div>
      )}
    </div>
  )
}

const EXAMPLE_QUESTIONS = [
  'What caused the errors?',
  'Summarise the activity in this time range.',
]

// ── Shared select style ───────────────────────────────────────────
const selectStyle = {
  background:   '#0d1117',
  border:       '1px solid #30363d',
  borderRadius: 6,
  color:        '#e6edf3',
  fontSize:     13,
  padding:      '6px 10px',
  fontFamily:   'Inter, sans-serif',
  cursor:       'pointer',
  outline:      'none',
  width:        '100%',
}

// ── Main component ────────────────────────────────────────────────
export default function LLMPanel({
  selectedIds, appliedFilters, fieldDefinitions, totalEntries,
  history, onHistoryChange,
}) {
  // ── Settings state (persisted) ──────────────────────────────────
  const [selectedModel,   setSelectedModel]   = useState(
    () => localStorage.getItem('llm_model') || ''
  )
  const [selectedNumCtx,  setSelectedNumCtx]  = useState(
    () => parseInt(localStorage.getItem('llm_num_ctx') || '160000', 10)
  )
  const [availableModels,  setAvailableModels]  = useState([])
  const [modelsLoading,    setModelsLoading]    = useState(false)
  const [showSettings,     setShowSettings]     = useState(false)

  // ── Token estimate state ────────────────────────────────────────
  const [estTokens,     setEstTokens]     = useState(null)
  const [estKb,         setEstKb]         = useState(null)
  const [filteredTotal, setFilteredTotal] = useState(totalEntries)

  // ── Chat state ──────────────────────────────────────────────────
  const [streaming,   setStreaming]   = useState(false)
  const [streamBuf,   setStreamBuf]   = useState('')
  const [question,    setQuestion]    = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewCsv,  setPreviewCsv]  = useState('')

  const bottomRef          = useRef(null)
  const abortControllerRef = useRef(null)
  const inputRef           = useRef(null)
  const gearBtnRef         = useRef(null)   // anchor for settings popup
  const settingsPopupRef   = useRef(null)

  // ── Scroll to bottom ────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, streamBuf])

  // ── Close settings when clicking outside ───────────────────────
  useEffect(() => {
    if (!showSettings) return
    function onOutside(e) {
      if (
        settingsPopupRef.current && !settingsPopupRef.current.contains(e.target) &&
        gearBtnRef.current       && !gearBtnRef.current.contains(e.target)
      ) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showSettings])

  // ── Fetch available models on mount ────────────────────────────
  useEffect(() => {
    setModelsLoading(true)
    api.getModels()
      .then(data => {
        const models = data.models || []
        setAvailableModels(models)
        // Set default model if nothing stored yet
        const stored = localStorage.getItem('llm_model')
        if (!stored && data.default_model) {
          setSelectedModel(data.default_model)
        } else if (!stored && models.length > 0) {
          setSelectedModel(models[0].name)
        }
        if (!localStorage.getItem('llm_num_ctx') && data.default_ctx) {
          setSelectedNumCtx(data.default_ctx)
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
  }, [])

  // ── Persist settings ────────────────────────────────────────────
  useEffect(() => { if (selectedModel) localStorage.setItem('llm_model',   selectedModel) }, [selectedModel])
  useEffect(() => { localStorage.setItem('llm_num_ctx', String(selectedNumCtx)) },          [selectedNumCtx])

  // ── Build filter request ────────────────────────────────────────
  const buildFiltersReq = useCallback(() => ({
    text:        appliedFilters.text        || null,
    filters:     Object.keys(appliedFilters.filters || {}).length ? appliedFilters.filters : null,
    file_filter: appliedFilters.file_filter || null,
    time_start:  appliedFilters.time_start  || null,
    time_end:    appliedFilters.time_end    || null,
    line_start:  appliedFilters.line_start  ? parseInt(appliedFilters.line_start) : null,
    line_end:    appliedFilters.line_end    ? parseInt(appliedFilters.line_end)   : null,
  }), [appliedFilters])

  // ── Fetch accurate token estimate on filter/file change ─────────
  useEffect(() => {
    if (!selectedIds.length) { setEstTokens(null); setEstKb(null); return }

    // Show rough estimate immediately while real one loads
    setEstTokens(Math.round(totalEntries * 80 / 4))
    setEstKb(Math.round(totalEntries * 80 / 1024))

    api.getCsvPreview({
      file_ids: selectedIds.length ? selectedIds : null,
      filters:  buildFiltersReq(),
    }).then(data => {
      setFilteredTotal(data.total ?? totalEntries)
      if (data.est_tokens !== undefined) {
        setEstTokens(data.est_tokens)
        setEstKb(data.est_size_kb)
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, appliedFilters])

  useEffect(() => { setFilteredTotal(totalEntries) }, [totalEntries])

  // ── Send message ────────────────────────────────────────────────
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
        model:    selectedModel  || null,
        num_ctx:  selectedNumCtx || null,
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

  function handleStop() { abortControllerRef.current?.abort() }

  async function handleLoadPreview() {
    setPreviewCsv('Loading…')
    try {
      const data = await api.getCsvPreview({
        file_ids: selectedIds.length ? selectedIds : null,
        filters:  buildFiltersReq(),
      })
      setPreviewCsv(data.csv || 'No data.')
      if (data.est_tokens !== undefined) {
        setEstTokens(data.est_tokens)
        setEstKb(data.est_size_kb)
        setFilteredTotal(data.total ?? filteredTotal)
      }
    } catch (e) {
      setPreviewCsv(`Error: ${e.message}`)
    }
  }

  // ── Empty state ─────────────────────────────────────────────────
  if (!selectedIds.length) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: 320, gap: 12, color: '#6e7681',
      }}>
        <div style={{ fontSize: 36, opacity: 0.4 }}>🤖</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
          Select files to use the LLM panel
        </div>
      </div>
    )
  }

  const displayTokens = estTokens ?? Math.round(filteredTotal * 80 / 4)
  const displayKb     = estKb     ?? Math.round(filteredTotal * 80 / 1024)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: 12 }}>

      {/* ── Context info bar ── */}
      <div className="card card-accent" style={{
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        {/* Label */}
        <div style={{
          fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12,
          color: '#f0a500', textTransform: 'uppercase', letterSpacing: '.06em',
          flexShrink: 0,
        }}>
          LLM Context
        </div>

        {/* Stats */}
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
          color: '#8b949e', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span>
            📊 <span style={{ color: '#e6edf3', fontWeight: 600 }}>
              {filteredTotal.toLocaleString()}
            </span> entries
          </span>
          <span style={{ color: '#30363d' }}>·</span>
          <span>
            ~<span style={{ color: '#e6edf3', fontWeight: 600 }}>
              {Number(displayKb).toLocaleString()} KB
            </span>
          </span>
          <span style={{ color: '#30363d' }}>·</span>
          <span>
            ~<span style={{ color: '#e6edf3', fontWeight: 600 }}>
              {displayTokens.toLocaleString()} tokens
            </span>
          </span>
        </div>

        {/* Preview button */}
        <button
          className="btn"
          style={{ marginLeft: 'auto', fontSize: 12 }}
          onClick={() => { if (!showPreview) handleLoadPreview(); setShowPreview(v => !v) }}
        >
          🔍 {showPreview ? 'Hide' : 'Preview'} data
        </button>
      </div>

      {/* ── CSV preview ── */}
      {showPreview && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '8px 14px', borderBottom: '1px solid #21262d',
            fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6e7681',
            background: '#1c2333',
          }}>
            First 50 rows of data sent to LLM (CSV format)
          </div>
          <pre style={{
            padding: 14, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, color: '#8b949e',
            overflow: 'auto', maxHeight: 200, margin: 0, lineHeight: 1.6,
          }}>
            {previewCsv || 'Loading…'}
          </pre>
        </div>
      )}

      {/* ── Chat history ── */}
      <div style={{
        flex: 1, overflow: 'auto',
        display: 'flex', flexDirection: 'column',
        minHeight: 0, padding: '4px 0',
      }}>
        {history.length === 0 && !streaming && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: 16, color: '#6e7681', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40 }}>🤖</div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#8b949e' }}>
              Ask anything about the{' '}
              <strong style={{ color: '#e6edf3' }}>{filteredTotal.toLocaleString()}</strong>{' '}
              filtered log entries
            </div>
            {selectedModel && (
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                color: '#6e7681', background: '#161b22',
                border: '1px solid #21262d', borderRadius: 6,
                padding: '4px 10px',
              }}>
                {selectedModel} · ctx {(selectedNumCtx / 1000).toFixed(0)}K
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {EXAMPLE_QUESTIONS.map((ex, i) => (
                <button
                  key={i}
                  style={{
                    background: 'rgba(240,165,0,0.08)',
                    border: '1px solid rgba(240,165,0,0.2)',
                    borderRadius: 8, padding: '8px 16px',
                    fontFamily: 'Inter, sans-serif', fontSize: 13,
                    color: '#c9a14a', cursor: 'pointer', transition: 'all .18s',
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
          <MessageBubble role="assistant" content={streamBuf} />
        )}
        {streaming && !streamBuf && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10, alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #1c2333, #21262d)',
              border: '1px solid #30363d',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>🤖</div>
            <div className="card" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px',
              fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#8b949e',
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
        display: 'flex', gap: 8,
        borderTop: '1px solid #21262d',
        paddingTop: 12, alignItems: 'center',
        position: 'relative',
      }}>
        {/* Prompt input */}
        <input
          ref         = {inputRef}
          id          = "llm-question-input"
          className   = "inp"
          style       = {{ flex: 1, fontSize: 14, padding: '10px 14px' }}
          placeholder = {`Ask about ${filteredTotal.toLocaleString()} log entries…`}
          value       = {question}
          onChange    = {e => setQuestion(e.target.value)}
          onKeyDown   = {e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled    = {streaming}
        />

        {/* ⚙ Gear settings button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            ref       = {gearBtnRef}
            id        = "llm-settings-btn"
            className = "btn"
            title     = "Model settings"
            onClick   = {() => setShowSettings(v => !v)}
            style={{
              padding:    '10px 12px',
              fontSize:   16,
              lineHeight: 1,
              background: showSettings ? 'rgba(240,165,0,0.12)' : undefined,
              borderColor: showSettings ? 'rgba(240,165,0,0.4)' : undefined,
              color:       showSettings ? '#f0a500' : undefined,
              transition: 'all .18s',
            }}
          >
            ⚙
          </button>

          {/* Settings popup — floats above the button */}
          {showSettings && (
            <div
              ref={settingsPopupRef}
              style={{
                position:    'absolute',
                bottom:      'calc(100% + 10px)',
                right:       0,
                width:       280,
                background:  '#161b22',
                border:      '1px solid #30363d',
                borderRadius: 10,
                boxShadow:   '0 8px 32px rgba(0,0,0,0.5)',
                padding:     '14px 16px',
                zIndex:      100,
                display:     'flex',
                flexDirection: 'column',
                gap:         14,
              }}
            >
              {/* Popup header */}
              <div style={{
                fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12,
                color: '#e6edf3', letterSpacing: '.04em',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                LLM Settings
                <button
                  onClick={() => setShowSettings(false)}
                  style={{
                    background: 'none', border: 'none', color: '#6e7681',
                    cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2,
                  }}
                >✕</button>
              </div>

              {/* Model selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11,
                  color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em',
                }}>
                  Model
                </label>
                {modelsLoading ? (
                  <div style={{
                    ...selectStyle, display: 'flex', alignItems: 'center',
                    gap: 8, color: '#6e7681',
                  }}>
                    <div className="spinner" style={{ width: 10, height: 10 }} />
                    Loading models…
                  </div>
                ) : availableModels.length > 0 ? (
                  <select
                    id="llm-model-select"
                    style={selectStyle}
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                  >
                    {availableModels.map(m => (
                      <option key={m.name} value={m.name}>
                        {m.name}{m.size_gb ? `  (${m.size_gb} GB)` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 12,
                    color: '#6e7681', padding: '6px 0',
                  }}>
                    ⚠ No models found — make sure Ollama is running
                  </div>
                )}
              </div>

              {/* Context size selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11,
                  color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em',
                }}>
                  Context window (num_ctx)
                </label>
                <select
                  id="llm-num-ctx-select"
                  style={selectStyle}
                  value={selectedNumCtx}
                  onChange={e => setSelectedNumCtx(parseInt(e.target.value, 10))}
                >
                  {CTX_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Footer note */}
              <div style={{
                fontFamily: 'Inter, sans-serif', fontSize: 11,
                color: '#6e7681', paddingTop: 2,
              }}>
                💾 Settings saved automatically
              </div>
            </div>
          )}
        </div>

        {/* Send / Stop button */}
        {streaming ? (
          <button
            id        = "llm-stop-btn"
            className = "btn"
            onClick   = {handleStop}
            title     = "Stop generating"
            style={{
              background:  'rgba(248,81,73,0.12)',
              border:      '1px solid rgba(248,81,73,0.40)',
              color:       '#ff7b72', fontWeight: 700,
              padding:     '10px 16px', flexShrink: 0,
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

        {/* Clear history */}
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
