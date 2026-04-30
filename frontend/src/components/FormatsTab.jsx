/**
 * FormatsTab.jsx — v4 (Redesign)
 *
 * Chat-style wizard:
 *   1. Upload log file (drag-and-drop or browse) — no paste mode
 *   2. AI analyzes file → generates regex pattern
 *   3. User edits fields (name/type CRUD) + advanced pattern editor (collapsible)
 *   4. Save format
 *
 * Fixes vs v3:
 *   - Removed paste textarea entirely
 *   - Removed mandatory (?P<message>...) requirement
 *   - Fixed JS live tester: converts (?P<name>) → (?<name>) for browser RegExp
 */

import { useState, useEffect, useRef } from 'react'
import * as api from '../api.js'

const FIELD_TYPES = ['timestamp', 'level', 'text', 'number', 'message']

const TYPE_COLORS = {
  timestamp: '#39d3bb',
  level:     '#f85149',
  text:      '#f0a500',
  number:    '#bc8cff',
  message:   '#8b949e',
}

// Convert Python named groups (?P<name>...) → JS (?<name>...) for browser RegExp
function pyToJs(pattern) {
  return pattern.replace(/\(\?P</g, '(?<')
}

function testPattern(pattern, lines) {
  let regex
  try {
    regex = new RegExp(pyToJs(pattern))
  } catch (e) {
    return { error: `Invalid regex: ${e.message}` }
  }
  const results = lines.filter(Boolean).map(line => {
    const m = regex.exec(line.trim())
    return m ? { line, matched: true, groups: m.groups || {} } : { line, matched: false }
  })
  const matched = results.filter(r => r.matched).length
  return { results, matched, total: results.length,
    matchRate: results.length ? Math.round(matched / results.length * 100) : 0 }
}

const EMPTY_FORM = { name: '', description: '', pattern: '', fields: [], example: '' }

// ── Stages: idle → file_selected → analyzing → review ───────────

export default function FormatsTab() {
  const [formats,     setFormats]     = useState({})
  const [loadingFmts, setLoadingFmts] = useState(true)

  const [stage,        setStage]        = useState('idle')
  const [selectedFile, setSelectedFile] = useState(null)
  const [isDragOver,   setIsDragOver]   = useState(false)
  const [genError,     setGenError]     = useState(null)
  const [aiResult,     setAiResult]     = useState(null)

  const [form,         setForm]         = useState(EMPTY_FORM)
  const [showPattern,  setShowPattern]  = useState(false)
  const [showLines,    setShowLines]    = useState(false)
  const [testResult,   setTestResult]   = useState(null)

  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveOk,    setSaveOk]    = useState(false)

  const fileInputRef = useRef(null)

  useEffect(() => { loadFormats() }, [])

  // Live-test whenever pattern changes in review mode
  useEffect(() => {
    if (stage !== 'review' || !form.pattern.trim() || !aiResult?.sampled_lines?.length) {
      setTestResult(null); return
    }
    setTestResult(testPattern(form.pattern, aiResult.sampled_lines))
  }, [form.pattern, aiResult, stage])

  async function loadFormats() {
    setLoadingFmts(true)
    try { const d = await api.listFormats(); setFormats(d.formats || {}) }
    catch (e) { console.error(e) }
    finally { setLoadingFmts(false) }
  }

  // ── File selection ─────────────────────────────────────────────
  function pickFile(file) {
    if (!file) return
    setSelectedFile(file); setStage('file_selected')
    setGenError(null); setAiResult(null); setSaveOk(false); setSaveError(null)
  }

  function handleDrop(e) {
    e.preventDefault(); setIsDragOver(false)
    const f = e.dataTransfer.files?.[0]; if (f) pickFile(f)
  }

  // ── AI analysis ────────────────────────────────────────────────
  async function handleAnalyze() {
    if (!selectedFile) return
    setStage('analyzing'); setGenError(null)
    try {
      const result = await api.generateFormatFromFile(selectedFile)
      setAiResult(result)
      setForm({
        name:        result.name        || '',
        description: result.description || '',
        pattern:     result.pattern     || '',
        fields:      result.fields      || [],
        example:     result.example     || '',
      })
      setStage('review'); setShowPattern(false); setShowLines(false)
    } catch (e) {
      setGenError(e.message); setStage('file_selected')
    }
  }

  // ── Save ───────────────────────────────────────────────────────
  async function handleSave() {
    setSaveError(null); setSaveOk(false)
    if (!form.name.trim())    { setSaveError('Format name is required.'); return }
    if (!form.pattern.trim()) { setSaveError('Pattern is required.');     return }
    const validFields = form.fields.filter(f => f.name.trim())
    if (!validFields.length)  { setSaveError('Add at least one field.'); return }
    setSaving(true)
    try {
      await api.addFormat({
        name: form.name.trim(), description: form.description.trim(),
        pattern: form.pattern.trim(), fields: validFields, example: form.example.trim(),
      })
      await loadFormats(); setSaveOk(true)
      setTimeout(() => { resetWizard() }, 1600)
    } catch (e) { setSaveError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete format "${name}"?`)) return
    try { await api.deleteFormat(name); await loadFormats() }
    catch (e) { alert(e.message) }
  }

  function resetWizard() {
    setStage('idle'); setSelectedFile(null); setAiResult(null)
    setForm(EMPTY_FORM); setGenError(null); setSaveError(null)
    setSaveOk(false); setShowPattern(false); setShowLines(false); setTestResult(null)
  }

  // ── Form helpers ───────────────────────────────────────────────
  const setF    = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setFd   = (i, k, v) => setForm(f => ({
    ...f, fields: f.fields.map((fd, j) => j === i ? { ...fd, [k]: v } : fd)
  }))
  const addFd   = () => setForm(f => ({ ...f, fields: [...f.fields, { name: '', type: 'text' }] }))
  const removeFd = i => setForm(f => ({ ...f, fields: f.fields.filter((_, j) => j !== i) }))

  // ── Render ─────────────────────────────────────────────────────

  const rateColor = r => r >= 90 ? '#3fb950' : r >= 60 ? '#d29922' : '#f85149'

  return (
    <div className="flex flex-col gap-5 w-full">

      {/* ── Section 1: Existing Formats ── */}
      <div className="card card-accent">
        <div className="font-mono font-bold text-xs text-accent mb-3">
          // existing_formats ({Object.keys(formats).length})
        </div>
        {loadingFmts ? (
          <div className="flex gap-2 text-muted text-xs items-center"><div className="spinner" /> Loading…</div>
        ) : Object.keys(formats).length === 0 ? (
          <div className="text-muted text-xs">No formats defined yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {Object.entries(formats).map(([name, fmt]) => (
              <div key={name} className="card flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold text-sm text-text">{name}</div>
                  {fmt.description && <div className="text-muted text-xs mt-0.5">{fmt.description}</div>}
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(fmt.fields || []).map(fd => (
                      <span key={fd.name} className="chip text-xs" style={{
                        color: TYPE_COLORS[fd.type] || '#8b949e',
                        borderColor: (TYPE_COLORS[fd.type] || '#8b949e') + '55',
                        background:  (TYPE_COLORS[fd.type] || '#8b949e') + '15',
                      }}>
                        {fd.name}<span style={{ opacity: 0.6, marginLeft: 3 }}>:{fd.type}</span>
                      </span>
                    ))}
                  </div>
                  {fmt.example && (
                    <div className="font-mono text-xs text-muted mt-2 truncate">{fmt.example}</div>
                  )}
                </div>
                <button className="btn btn-danger text-xs flex-shrink-0" onClick={() => handleDelete(name)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Add New Format (wizard) ── */}
      <div className="card card-accent">
        <div className="font-mono font-bold text-xs text-accent mb-1">// add_new_format</div>

        {/* Stage label */}
        <div className="text-xs text-muted mb-4" style={{ minHeight: 18 }}>
          {stage === 'idle'          && 'Upload a log file — the AI will generate the regex pattern for you.'}
          {stage === 'file_selected' && 'File ready. Click Analyze to send it to the AI.'}
          {stage === 'analyzing'     && 'AI is reading your file and generating the pattern…'}
          {stage === 'review'        && 'Pattern generated. Review fields, then save.'}
        </div>

        {/* ── Drop zone (hidden after AI result shown) ── */}
        {stage !== 'review' && (
          <div
            className={`drop-zone${isDragOver ? ' drop-zone-active' : ''}${stage === 'file_selected' ? ' drop-zone-filled' : ''}`}
            onDrop      ={handleDrop}
            onDragOver  ={e => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave ={e => { e.preventDefault(); setIsDragOver(false) }}
            onClick     ={() => fileInputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
            aria-label="Upload log file"
          >
            <input ref={fileInputRef} type="file" style={{ display: 'none' }}
              onChange={e => pickFile(e.target.files?.[0])} />

            {stage === 'file_selected' ? (
              <div className="flex flex-col items-center gap-2">
                <div style={{ fontSize: 30 }}>📄</div>
                <div className="font-mono text-sm text-ok" style={{ fontWeight: 600 }}>
                  {selectedFile.name}
                </div>
                <div className="text-muted text-xs">
                  {(selectedFile.size / 1024).toFixed(1)} KB &nbsp;·&nbsp; click to change
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div style={{ fontSize: 38, opacity: isDragOver ? 1 : 0.45, transition: 'opacity 0.2s' }}>📂</div>
                <div className="text-sm" style={{
                  color: isDragOver ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: 500, transition: 'color 0.2s',
                }}>
                  Drop your log file here
                </div>
                <div className="text-xs text-muted">or click to browse</div>
                <div className="chip text-xs" style={{ opacity: 0.6, marginTop: 4 }}>
                  .log · .txt · .adlog · any text file
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Analyze button ── */}
        {stage === 'file_selected' && (
          <div className="flex items-center gap-3 mt-3">
            <button className="btn btn-primary" onClick={handleAnalyze} style={{ width: 'fit-content' }}>
              🤖 Analyze with AI
            </button>
            {genError && <span className="text-xs text-err">{genError}</span>}
          </div>
        )}

        {/* ── Analyzing spinner ── */}
        {stage === 'analyzing' && (
          <div className="ai-bubble mt-3">
            <div className="flex items-center gap-3">
              <div className="spinner" />
              <span className="text-sm" style={{ color: 'var(--accent)' }}>
                Analyzing <span className="font-mono">{selectedFile?.name}</span> …
              </span>
            </div>
            <div className="text-xs text-muted mt-1 ml-6">
              Reading lines · detecting structure · generating regex
            </div>
          </div>
        )}

        {/* ── AI Result bubble ── */}
        {stage === 'review' && aiResult && (
          <div className="ai-bubble" style={{ animation: 'fadeSlideIn 0.3s ease' }}>
            {/* Bubble header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 16 }}>🤖</span>
                <span className="font-mono font-bold text-xs text-accent">AI Analysis Complete</span>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                {aiResult.total_sampled && (
                  <span className="chip text-xs text-muted">
                    {aiResult.total_sampled} lines sampled
                  </span>
                )}
                {aiResult.source_file && (
                  <span className="chip text-xs text-muted font-mono" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {aiResult.source_file}
                  </span>
                )}
                {testResult && !testResult.error && (
                  <span className="chip text-xs" style={{
                    color: rateColor(testResult.matchRate),
                    borderColor: rateColor(testResult.matchRate) + '55',
                    background:  rateColor(testResult.matchRate) + '18',
                  }}>
                    {testResult.matchRate}% match · {testResult.matched}/{testResult.total} lines
                  </span>
                )}
              </div>
            </div>

            {/* Pattern preview (read-only unless expanded below) */}
            <div className="inp-label mb-1">Generated Pattern</div>
            <div className="font-mono text-xs p-2 rounded mb-2" style={{
              background: 'rgba(0,0,0,0.28)', color: '#79c0ff',
              wordBreak: 'break-all', lineHeight: 1.75,
            }}>
              {form.pattern || '—'}
            </div>

            {/* Live test lines toggle */}
            {testResult && !testResult.error && (
              <div className="mb-1">
                <button
                  className="text-xs"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           padding: 0, color: 'var(--accent)', textDecoration: 'underline' }}
                  onClick={() => setShowLines(v => !v)}
                >
                  {showLines ? '▲ Hide test lines' : '▼ Show test lines'}
                </button>
                {showLines && (
                  <div className="mt-2 font-mono text-xs flex flex-col gap-0.5"
                       style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {testResult.results.map((r, i) => (
                      <div key={i} style={{ color: r.matched ? '#3fb950' : '#f85149', opacity: r.matched ? 1 : 0.6 }}>
                        {r.matched ? '✓' : '✗'} {r.line.slice(0, 110)}{r.line.length > 110 ? '…' : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {testResult?.error && <div className="text-xs text-err mt-1">{testResult.error}</div>}
          </div>
        )}

        {/* ── Fields editor (only in review) ── */}
        {stage === 'review' && (
          <div className="mt-4">
            <div className="font-mono font-bold text-xs text-accent mb-3">// edit_fields</div>

            <div className="flex flex-col gap-2 mb-3">
              {form.fields.map((fd, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    className="inp flex-1" placeholder="field_name"
                    value={fd.name} onChange={e => setFd(i, 'name', e.target.value)}
                    style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}
                  />
                  <select
                    className="inp" value={fd.type} onChange={e => setFd(i, 'type', e.target.value)}
                    style={{ width: 120, color: TYPE_COLORS[fd.type] || '#e6edf3' }}
                  >
                    {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="chip text-xs flex-shrink-0" style={{
                    color:       TYPE_COLORS[fd.type] || '#8b949e',
                    borderColor: (TYPE_COLORS[fd.type] || '#8b949e') + '55',
                    background:  (TYPE_COLORS[fd.type] || '#8b949e') + '18',
                    minWidth: 72, textAlign: 'center',
                  }}>
                    {fd.type}
                  </span>
                  <button className="btn btn-danger text-xs px-2 flex-shrink-0"
                    onClick={() => removeFd(i)} title="Remove field">✕</button>
                </div>
              ))}
            </div>

            <button className="btn text-xs" onClick={addFd} style={{ width: 'fit-content' }}>
              + Add Field
            </button>

            {/* Advanced: raw pattern editor */}
            <div className="mt-4">
              <button
                onClick={() => setShowPattern(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                         padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ fontSize: 10, transition: 'transform 0.2s', display: 'inline-block',
                               transform: showPattern ? 'rotate(90deg)' : 'rotate(0deg)',
                               color: 'var(--text-muted)' }}>▶</span>
                <span className="text-xs text-muted">Advanced — edit raw regex pattern</span>
              </button>

              {showPattern && (
                <div className="mt-2">
                  <div className="inp-label">Regex Pattern</div>
                  <textarea
                    className="inp font-mono" rows={4}
                    value={form.pattern} onChange={e => setF('pattern', e.target.value)}
                    style={{ fontSize: 11, resize: 'vertical', fontFamily: 'Consolas, monospace' }}
                  />
                  <div className="text-xs text-muted mt-1">
                    Python named groups: <code className="text-accent">{'(?P<field_name>...)'}</code>
                    &nbsp;·&nbsp; Optional fields: <code className="text-accent">{'(?:...(?P<name>...))?'}</code>
                  </div>
                </div>
              )}
            </div>

            {/* Format name + description */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <div className="inp-label">Format Name *</div>
                <input className="inp" placeholder="my_format_name"
                  value={form.name} onChange={e => setF('name', e.target.value)}
                  style={{ fontFamily: 'Consolas, monospace' }} />
              </div>
              <div>
                <div className="inp-label">Description</div>
                <input className="inp" placeholder="Brief description"
                  value={form.description} onChange={e => setF('description', e.target.value)} />
              </div>
            </div>

            {/* Save row */}
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><div className="spinner" /> Saving…</>
                  : saveOk ? '✓ Saved!' : '💾 Save Format'}
              </button>
              <button className="btn" onClick={resetWizard}>↺ Start Over</button>
              {saveError && <span className="text-xs text-err">{saveError}</span>}
              {saveOk    && <span className="chip chip-ok text-xs">✓ Format saved successfully</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 3: Field type guide ── */}
      <div className="card">
        <div className="font-mono font-bold text-xs text-accent mb-3">// field_type_guide</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { type: 'timestamp', desc: 'Date/time — enables time range filter' },
            { type: 'level',     desc: 'Severity — colour-coded chips (INFO/ERROR…)' },
            { type: 'text',      desc: 'Repeating category — multiselect dropdown' },
            { type: 'number',    desc: 'Numeric value — min/max filter inputs' },
            { type: 'message',   desc: 'Main log text — drives keyword search' },
          ].map(({ type, desc }) => (
            <div key={type} className="card p-2">
              <span className="chip text-xs mb-1 inline-block" style={{
                color: TYPE_COLORS[type], borderColor: TYPE_COLORS[type] + '55',
                background: TYPE_COLORS[type] + '15',
              }}>{type}</span>
              <div className="text-muted text-xs">{desc}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
