/**
 * FormatsTab.jsx — v3 (NEW)
 *
 * Three sections:
 *   1. Existing formats list — shows all saved formats with delete button
 *   2. Live regex tester    — paste sample lines, see field extraction in real time
 *   3. Add format form      — name, description, pattern, fields [{name,type}], example
 *                             with "🤖 Generate with AI" button that pre-fills the form
 *
 * The live tester runs entirely in the browser (JS RegExp) — no API call needed.
 * AI generation calls POST /api/formats/generate via api.generateFormat().
 * Saving calls POST /api/formats via api.addFormat().
 * Deleting calls DELETE /api/formats/{name} via api.deleteFormat().
 */

import { useState, useEffect } from 'react'
import * as api from '../api.js'

const FIELD_TYPES = ['timestamp', 'level', 'text', 'number', 'message']

const TYPE_COLORS = {
  timestamp: '#39d3bb',
  level:     '#f85149',
  text:      '#f0a500',
  number:    '#bc8cff',
  message:   '#8b949e',
}

// ── Live regex tester (browser-side, no API) ─────────────────────
function testPatternLocally(pattern, sampleLines) {
  let regex
  try {
    regex = new RegExp(pattern)
  } catch (e) {
    return { error: `Invalid regex: ${e.message}` }
  }

  const results = sampleLines.filter(Boolean).map(line => {
    const match = regex.exec(line.trim())
    if (!match) return { line, matched: false }
    return { line, matched: true, groups: match.groups || {} }
  })

  const matched = results.filter(r => r.matched).length
  return {
    results,
    matchRate: results.length ? Math.round(matched / results.length * 100) : 0,
    matched,
    total: results.length,
  }
}

// ── Empty form state ─────────────────────────────────────────────
const EMPTY_FORM = {
  name:        '',
  description: '',
  pattern:     '',
  fields:      [{ name: '', type: 'text' }],
  example:     '',
}

export default function FormatsTab() {
  const [formats,     setFormats]     = useState({})
  const [loadingFmts, setLoadingFmts] = useState(true)

  // Sample lines textarea
  const [sampleText,  setSampleText]  = useState('')

  // AI generation state
  const [generating,  setGenerating]  = useState(false)
  const [genError,    setGenError]    = useState(null)
  const [genMatchRate, setGenMatchRate] = useState(null)

  // Editable form
  const [form, setForm] = useState(EMPTY_FORM)

  // Live test result (updates as pattern or sample lines change)
  const [testResult,  setTestResult]  = useState(null)

  // Save state
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState(null)
  const [saveOk,     setSaveOk]     = useState(false)

  // Load existing formats on mount
  useEffect(() => {
    loadFormats()
  }, [])

  // Re-run live tester whenever pattern or sample lines change
  useEffect(() => {
    if (!form.pattern.trim() || !sampleText.trim()) {
      setTestResult(null)
      return
    }
    const lines = sampleText.split('\n')
    setTestResult(testPatternLocally(form.pattern, lines))
  }, [form.pattern, sampleText])

  async function loadFormats() {
    setLoadingFmts(true)
    try {
      const d = await api.listFormats()
      setFormats(d.formats || {})
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingFmts(false)
    }
  }

  // ── AI generation ─────────────────────────────────────────────
  async function handleGenerate() {
    const lines = sampleText.split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      setGenError('Please paste at least 2 sample log lines.')
      return
    }
    setGenerating(true)
    setGenError(null)
    setGenMatchRate(null)
    setSaveOk(false)

    try {
      const result = await api.generateFormat(lines)

      setForm({
        name:        result.name        || '',
        description: result.description || '',
        pattern:     result.pattern     || '',
        fields:      result.fields      || [{ name: '', type: 'text' }],
        example:     result.example     || lines[0] || '',
      })

      setGenMatchRate(result.match_rate ?? null)

      if (result.match_rate < 100) {
        setGenError(
          `Pattern matched ${result.matched_lines}/${result.total_lines} lines ` +
          `(${result.match_rate}%). Review the pattern and fields below.`
        )
      }
    } catch (e) {
      setGenError(`Generation failed: ${e.message}`)
    } finally {
      setGenerating(false)
    }
  }

  // ── Save format ───────────────────────────────────────────────
  async function handleSave() {
    setSaveError(null)
    setSaveOk(false)

    if (!form.name.trim())    { setSaveError('Format name is required.'); return }
    if (!form.pattern.trim()) { setSaveError('Pattern is required.');     return }

    const validFields = form.fields.filter(f => f.name.trim())
    if (!validFields.length)  { setSaveError('Add at least one field.'); return }

    setSaving(true)
    try {
      await api.addFormat({
        name:        form.name.trim(),
        description: form.description.trim(),
        pattern:     form.pattern.trim(),
        fields:      validFields,
        example:     form.example.trim(),
      })
      await loadFormats()
      setSaveOk(true)
      setForm(EMPTY_FORM)
      setSampleText('')
      setTestResult(null)
      setGenError(null)
      setGenMatchRate(null)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete format ─────────────────────────────────────────────
  async function handleDelete(name) {
    if (!window.confirm(`Delete format "${name}"? This cannot be undone.`)) return
    try {
      await api.deleteFormat(name)
      await loadFormats()
    } catch (e) {
      alert(e.message)
    }
  }

  // ── Form field helpers ────────────────────────────────────────
  function setFormField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function setFieldDef(index, key, val) {
    setForm(f => ({
      ...f,
      fields: f.fields.map((fd, i) => i === index ? { ...fd, [key]: val } : fd),
    }))
  }

  function addFieldDef() {
    setForm(f => ({ ...f, fields: [...f.fields, { name: '', type: 'text' }] }))
  }

  function removeFieldDef(index) {
    setForm(f => ({ ...f, fields: f.fields.filter((_, i) => i !== index) }))
  }

  return (
    <div className="flex flex-col gap-5 w-full">

      {/* ── Section 1 — Existing formats ── */}
      <div className="card card-accent">
        <div className="font-mono font-bold text-xs text-accent mb-3">
          // existing_formats ({Object.keys(formats).length})
        </div>

        {loadingFmts ? (
          <div className="flex gap-2 text-muted text-xs items-center">
            <div className="spinner" /> Loading…
          </div>
        ) : Object.keys(formats).length === 0 ? (
          <div className="text-muted text-xs">No formats defined yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {Object.entries(formats).map(([name, fmt]) => (
              <div key={name} className="card flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold text-sm text-text">{name}</div>
                  {fmt.description && (
                    <div className="text-muted text-xs mt-0.5">{fmt.description}</div>
                  )}
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(fmt.fields || []).map(fd => (
                      <span
                        key={fd.name}
                        className="chip text-xs"
                        style={{
                          color:       TYPE_COLORS[fd.type] || '#8b949e',
                          borderColor: (TYPE_COLORS[fd.type] || '#8b949e') + '55',
                          background:  (TYPE_COLORS[fd.type] || '#8b949e') + '15',
                        }}
                      >
                        {fd.name}
                        <span style={{ opacity: 0.6, marginLeft: 3 }}>:{fd.type}</span>
                      </span>
                    ))}
                  </div>
                  {fmt.example && (
                    <div className="font-mono text-xs text-muted mt-2 truncate">
                      {fmt.example}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-danger text-xs flex-shrink-0"
                  onClick={() => handleDelete(name)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2 — Sample lines + Live tester ── */}
      <div className="card card-accent">
        <div className="font-mono font-bold text-xs text-accent mb-3">
          // add_new_format
        </div>

        <div className="inp-label">Step 1 — Paste 3–10 sample lines from your log file</div>
        <textarea
          className   = "inp mb-3"
          rows        = {5}
          placeholder = {"Paste sample log lines here…\n\nExample:\n2025-04-17 08:35:19 ERROR auth-service Login failed\n2025-04-17 08:35:20 INFO  auth-service User logged out"}
          value       = {sampleText}
          onChange    = {e => setSampleText(e.target.value)}
          style       = {{ fontFamily: 'inherit', resize: 'vertical' }}
        />

        <div className="inp-label mb-2">Step 2 — Generate format with AI or write pattern manually</div>
        <button
          className = "btn btn-primary mb-3"
          onClick   = {handleGenerate}
          disabled  = {generating || !sampleText.trim()}
          style     = {{ width: 'fit-content' }}
        >
          {generating
            ? <><div className="spinner" /> Generating…</>
            : '🤖 Generate Format with AI'}
        </button>

        {genError && (
          <div className="text-xs mb-3 p-2 rounded border"
               style={{ color: genMatchRate && genMatchRate > 0 ? '#d29922' : '#f85149',
                        background: 'rgba(248,81,73,.08)', borderColor: 'rgba(248,81,73,.3)' }}>
            {genError}
          </div>
        )}

        {/* Pattern input */}
        <div className="inp-label">Regex Pattern</div>
        <input
          className   = "inp mb-1 font-mono"
          placeholder = '(?P<timestamp>\d{4}-\d{2}-\d{2}) (?P<level>\w+) (?P<message>.+)'
          value       = {form.pattern}
          onChange    = {e => setFormField('pattern', e.target.value)}
          style       = {{ fontSize: 11 }}
        />
        <div className="text-xs text-muted mb-3">
          Use named groups: <code className="text-accent">(?P&lt;field_name&gt;...)</code>
          &nbsp;· <code className="text-accent">(?P&lt;message&gt;...)</code> is required
        </div>

        {/* Live test results */}
        {testResult && (
          <div className="card mb-3 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono font-bold text-xs text-accent">
                Live Test Results
              </div>
              <span className={`chip text-xs ${testResult.matchRate === 100 ? 'chip-ok' : testResult.matchRate > 0 ? '' : 'chip-err'}`}>
                {testResult.matched}/{testResult.total} matched ({testResult.matchRate}%)
              </span>
            </div>

            {testResult.error ? (
              <div className="text-err text-xs">{testResult.error}</div>
            ) : (
              testResult.results.map((r, i) => (
                <div key={i} className="mb-2 text-xs">
                  <div className={r.matched ? 'text-ok' : 'text-err'}>
                    {r.matched ? '✓' : '✗'} Line {i + 1}: <span className="text-muted font-mono">{r.line.slice(0, 80)}</span>
                  </div>
                  {r.matched && Object.entries(r.groups).map(([k, v]) => (
                    <div key={k} className="ml-4 font-mono" style={{ color: '#8b949e' }}>
                      <span style={{ color: TYPE_COLORS.text }}>{k}</span>
                      <span style={{ color: '#484f58' }}> → </span>
                      <span style={{ color: '#e6edf3' }}>"{v}"</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {/* Fields editor */}
        <div className="inp-label mb-2">Fields — one per named group in your pattern</div>
        <div className="flex flex-col gap-2 mb-3">
          {form.fields.map((fd, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                className   = "inp flex-1"
                placeholder = "field_name"
                value       = {fd.name}
                onChange    = {e => setFieldDef(i, 'name', e.target.value)}
                style       = {{ fontFamily: 'Consolas, monospace', fontSize: 12 }}
              />
              <select
                className = "inp"
                value     = {fd.type}
                onChange  = {e => setFieldDef(i, 'type', e.target.value)}
                style     = {{ width: 110, color: TYPE_COLORS[fd.type] || '#e6edf3' }}
              >
                {FIELD_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {form.fields.length > 1 && (
                <button
                  className="btn btn-danger text-xs px-2"
                  onClick={() => removeFieldDef(i)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            className="btn text-xs"
            onClick={addFieldDef}
            style={{ width: 'fit-content' }}
          >
            + Add Field
          </button>
        </div>

        {/* Name, description, example */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="inp-label">Format Name</div>
            <input
              className   = "inp"
              placeholder = "my_app_logs"
              value       = {form.name}
              onChange    = {e => setFormField('name', e.target.value)}
              style       = {{ fontFamily: 'Consolas, monospace' }}
            />
          </div>
          <div>
            <div className="inp-label">Description</div>
            <input
              className   = "inp"
              placeholder = "Brief description of this format"
              value       = {form.description}
              onChange    = {e => setFormField('description', e.target.value)}
            />
          </div>
        </div>

        <div className="mb-4">
          <div className="inp-label">Example Line (optional)</div>
          <input
            className   = "inp font-mono"
            placeholder = "A representative sample line from this format"
            value       = {form.example}
            onChange    = {e => setFormField('example', e.target.value)}
            style       = {{ fontSize: 11 }}
          />
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            className = "btn btn-primary"
            onClick   = {handleSave}
            disabled  = {saving}
          >
            {saving ? <><div className="spinner" /> Saving…</> : '💾 Save Format'}
          </button>
          <button
            className = "btn"
            onClick   = {() => { setForm(EMPTY_FORM); setSaveError(null); setSaveOk(false); setGenError(null) }}
          >
            Reset
          </button>
          {saveOk && (
            <span className="chip chip-ok text-xs">✓ Format saved successfully</span>
          )}
          {saveError && (
            <span className="text-xs text-err">{saveError}</span>
          )}
        </div>

      </div>

      {/* ── Field type legend ── */}
      <div className="card">
        <div className="font-mono font-bold text-xs text-accent mb-3">// field_type_guide</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { type: 'timestamp', desc: 'Date/time — enables time range filter' },
            { type: 'level',     desc: 'Severity — gets colour-coded chips (INFO/ERROR etc)' },
            { type: 'text',      desc: 'Repeating category — gets multiselect dropdown' },
            { type: 'number',    desc: 'Numeric value — min/max filter inputs' },
            { type: 'message',   desc: 'Main log text — drives keyword text search' },
          ].map(({ type, desc }) => (
            <div key={type} className="card p-2">
              <span
                className="chip text-xs mb-1 inline-block"
                style={{
                  color:       TYPE_COLORS[type],
                  borderColor: TYPE_COLORS[type] + '55',
                  background:  TYPE_COLORS[type] + '15',
                }}
              >
                {type}
              </span>
              <div className="text-muted text-xs">{desc}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
