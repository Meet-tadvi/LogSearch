/**
 * Sidebar.jsx — v4 (UI Redesign)
 * Better upload zone, grouped filter sections, sticky apply/clear buttons.
 */

import { useState, useRef } from 'react'

// ── Reusable MultiSelect dropdown ────────────────────────────────
function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  function handleBlur(e) {
    if (!ref.current?.contains(e.relatedTarget)) setOpen(false)
  }

  function toggle(val) {
    onChange(
      selected.includes(val)
        ? selected.filter(s => s !== val)
        : [...selected, val]
    )
  }

  const displayText = selected.length
    ? selected.join(', ')
    : `All ${label}`

  return (
    <div className="multi-select" ref={ref} onBlur={handleBlur}>
      <button
        className="multi-select-trigger"
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span
          className="truncate"
          style={{ color: selected.length ? '#e6edf3' : '#6e7681', fontSize: 13 }}
        >
          {displayText}
        </span>
        <span style={{ color: '#6e7681', fontSize: 10, marginLeft: 8, flexShrink: 0 }}>▾</span>
      </button>

      {open && options.length > 0 && (
        <div className="multi-select-dropdown">
          {options.map(opt => (
            <label key={opt} className="multi-select-option">
              <input
                type     = "checkbox"
                checked  = {selected.includes(opt)}
                onChange = {() => toggle(opt)}
                style    = {{ accentColor: '#f0a500' }}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Filter Group wrapper ──────────────────────────────────────────
function FilterGroup({ children }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {children}
    </div>
  )
}

// ── Main Sidebar ──────────────────────────────────────────────────
export default function Sidebar({
  files, selectedIds,
  uploading,
  onUpload, onPendingChange, onApply, onClear,
  pending, metadata, isOpen, onToggle
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) onUpload(dropped)
  }

  function handleFileInput(e) {
    const picked = Array.from(e.target.files)
    if (picked.length) onUpload(picked)
    e.target.value = ''
  }

  const { field_definitions = [], distinct_values = {} } = metadata

  const dropdownFields = field_definitions.filter(
    fd => fd.type === 'level' || fd.type === 'text'
  )
  const hasTimestamp = field_definitions.some(fd => fd.type === 'timestamp')

  function getFieldFilter(fname) {
    return (pending.filters || {})[fname] || []
  }

  function setFieldFilter(fname, vals) {
    const current = pending.filters || {}
    onPendingChange('filters', { ...current, [fname]: vals })
  }

  const hasActiveFilters = pending.text ||
    pending.file_filter ||
    pending.time_start ||
    pending.time_end ||
    pending.line_start ||
    pending.line_end ||
    Object.values(pending.filters || {}).some(v => v.length > 0)

  return (
    <div
      className="flex-shrink-0"
      style={{
        width: isOpen ? 248 : 48,
        transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
        background: '#161b22',
        borderRight: '1px solid #21262d',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Fixed inner width so content doesn't reflow during animation */}
      <div style={{ width: 248, display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* ── Sidebar header ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          height: 52,
          borderBottom: '1px solid #21262d',
          flexShrink: 0,
          gap: 10,
        }}>
          <button
            onClick={onToggle}
            title="Toggle Sidebar"
            style={{
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid #30363d',
              borderRadius: 7,
              background: 'transparent',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: 14,
              flexShrink: 0,
              transition: 'all .18s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#c9d1d9' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8b949e' }}
          >
            ☰
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span style={{
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              fontSize: 14,
              color: '#e6edf3',
              letterSpacing: '-0.01em',
            }}>
              Filters
            </span>
            {files.length > 0 && (
              <span style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                color: '#6e7681',
                background: '#21262d',
                padding: '2px 7px',
                borderRadius: 10,
                fontWeight: 600,
              }}>
                {selectedIds.length}/{files.length}
              </span>
            )}
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.18s',
          visibility: isOpen ? 'visible' : 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* Upload zone */}
          <div style={{ padding: '14px 12px 10px' }}>
            <div
              className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver = {e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave= {() => setDragOver(false)}
              onDrop     = {handleDrop}
              onClick    = {() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#8b949e' }}>
                  <div className="spinner" />
                  <span style={{ fontSize: 13, fontFamily: 'Inter, sans-serif' }}>Parsing file…</span>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>⬆</div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, color: '#c9d1d9', marginBottom: 3 }}>
                    Drop log files here
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#6e7681' }}>
                    or click to browse · .log .txt .out · max 200 MB
                  </div>
                </>
              )}
            </div>
            <input
              ref      = {fileInputRef}
              type     = "file"
              multiple
              accept   = ".log,.txt,.out"
              onChange = {handleFileInput}
              style    = {{ display: 'none' }}
            />
          </div>

          {/* Section divider */}
          <div style={{ padding: '4px 12px 8px' }}>
            <div className="section-divider">Filters</div>
          </div>

          {/* Filter controls */}
          <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>

            {/* Text search */}
            <div>
              <div className="inp-label">
                <span>🔍</span> Text Search
              </div>
              <input
                className   = "inp"
                placeholder = "Search in raw log line…"
                value       = {pending.text}
                onChange    = {e => onPendingChange('text', e.target.value)}
                onKeyDown   = {e => e.key === 'Enter' && onApply()}
              />
            </div>

            {/* Dynamic dropdown fields */}
            {dropdownFields.map(fd => {
              const options = distinct_values[fd.name] || []
              if (!options.length) return null
              return (
                <div key={fd.name}>
                  <div className="inp-label" style={{ justifyContent: 'space-between' }}>
                    <span>{fd.name.replace(/_/g, ' ')}</span>
                    {fd.type === 'level' && (
                      <span className="chip" style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10 }}>level</span>
                    )}
                  </div>
                  <MultiSelect
                    label    = {fd.name}
                    options  = {options}
                    selected = {getFieldFilter(fd.name)}
                    onChange = {vals => setFieldFilter(fd.name, vals)}
                  />
                </div>
              )
            })}

            {/* Source file filter */}
            {selectedIds.length > 1 && (
              <div>
                <div className="inp-label"><span>📄</span> Source File</div>
                <input
                  className   = "inp"
                  placeholder = "Filter by filename…"
                  value       = {pending.file_filter}
                  onChange    = {e => onPendingChange('file_filter', e.target.value)}
                  onKeyDown   = {e => e.key === 'Enter' && onApply()}
                />
              </div>
            )}

            {/* Time range */}
            {hasTimestamp && (
              <div>
                <div className="inp-label"><span>🕐</span> Time Range</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className   = "inp"
                    placeholder = "From  08:35"
                    value       = {pending.time_start}
                    onChange    = {e => onPendingChange('time_start', e.target.value)}
                  />
                  <input
                    className   = "inp"
                    placeholder = "To    09:00"
                    value       = {pending.time_end}
                    onChange    = {e => onPendingChange('time_end', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Line range */}
            <div>
              <div className="inp-label"><span>#</span> Line Range</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className   = "inp"
                  placeholder = "From"
                  type        = "number"
                  value       = {pending.line_start}
                  onChange    = {e => onPendingChange('line_start', e.target.value)}
                />
                <input
                  className   = "inp"
                  placeholder = "To"
                  type        = "number"
                  value       = {pending.line_end}
                  onChange    = {e => onPendingChange('line_end', e.target.value)}
                />
              </div>
            </div>

          </div>

          {/* Spacer */}
          <div style={{ flex: 1, minHeight: 16 }} />
        </div>

        {/* ── Sticky Apply / Clear buttons ── */}
        <div style={{
          padding: '12px',
          borderTop: '1px solid #21262d',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: '#161b22',
          flexShrink: 0,
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.18s',
          visibility: isOpen ? 'visible' : 'hidden',
        }}>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '9px 14px' }} onClick={onApply}>
            ⚡ Apply Filters
          </button>
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center', opacity: hasActiveFilters ? 1 : 0.45 }}
            onClick={onClear}
            disabled={!hasActiveFilters}
          >
            ✕ Clear All Filters
          </button>
        </div>

      </div>
    </div>
  )
}
