/**
 * Sidebar.jsx — left panel
 *
 * Contains:
 *   • Drag-and-drop file upload zone
 *   • FileCard for each uploaded file (checkbox, stats, delete)
 *   • Select All / Deselect All
 *   • All filter inputs (text, level, component, thread, file, time, line)
 *   • Apply / Clear buttons
 */

import { useState, useRef } from 'react'

// ── Reusable MultiSelect ──────────────────────────────────────
function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref  = useRef(null)

  // Close when clicking outside
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
        <span className="truncate text-xs" style={{ color: selected.length ? '#e6edf3' : '#484f58' }}>
          {displayText}
        </span>
        <span className="text-muted ml-2">▾</span>
      </button>

      {open && options.length > 0 && (
        <div className="multi-select-dropdown">
          {options.map(opt => (
            <label key={opt} className="multi-select-option">
              <input
                type     = "checkbox"
                checked  = {selected.includes(opt)}
                onChange = {() => toggle(opt)}
                className= "accent-accent"
              />
              <span className={`chip chip-${opt} text-xs`}>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}


// ── Main Sidebar ──────────────────────────────────────────────
export default function Sidebar({
  files, selectedIds,
  uploading,
  onUpload, onPendingChange, onApply, onClear,
  pending, metadata,
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  // ── Drag & drop handlers ────────────────────────────────
  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) onUpload(dropped)
  }

  function handleFileInput(e) {
    const picked = Array.from(e.target.files)
    if (picked.length) onUpload(picked)
    e.target.value = ''   // reset so same file can be re-uploaded
  }

  const { levels = [], components = [], thread_ids = [], available_fields = [] } = metadata

  return (
    <div
      className = "flex flex-col border-r border-border overflow-y-auto"
      style     = {{ width: 240, minWidth: 240, background: '#0d1117' }}
    >
      {/* ── Title ── */}
      <div className="px-4 py-3 border-b border-border">
        <span className="font-mono font-bold text-accent text-sm">// log_search</span>
        {files.length > 0 && (
          <span className="text-muted text-xs ml-2">
            {selectedIds.length}/{files.length} files
          </span>
        )}
      </div>

      {/* ── Upload zone ── */}
      <div className="px-3 pt-3">
        <div
          className = {`drop-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver = {e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave= {() => setDragOver(false)}
          onDrop    = {handleDrop}
          onClick   = {() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-muted text-xs">
              <div className="spinner" /> Parsing…
            </div>
          ) : (
            <>
              <div className="text-accent text-lg mb-1">⬆</div>
              <div className="text-muted text-xs">
                Drop log files here or click to browse
              </div>
              <div className="text-muted/60 text-xs mt-1">.log .txt .out · max 200 MB</div>
            </>
          )}
        </div>
        <input
          ref      = {fileInputRef}
          type     = "file"
          multiple
          accept   = ".log,.txt,.out"
          onChange = {handleFileInput}
          className= "hidden"
        />
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-border mx-3 mt-3" />

      {/* ── Filters ── */}
      <div className="px-3 py-3 flex flex-col gap-3 flex-1">
        <div className="inp-label">FILTERS</div>

        {/* Text search */}
        <div>
          <div className="inp-label">Text Search</div>
          <input
            className   = "inp"
            placeholder = "Search in raw log line…"
            value       = {pending.text}
            onChange    = {e => onPendingChange('text', e.target.value)}
            onKeyDown   = {e => e.key === 'Enter' && onApply()}
          />
        </div>

        {/* Level */}
        {levels.length > 0 && (
          <div>
            <div className="inp-label">Level</div>
            <MultiSelect
              label    = "levels"
              options  = {levels}
              selected = {pending.levels}
              onChange = {v => onPendingChange('levels', v)}
            />
          </div>
        )}

        {/* Component */}
        {components.length > 0 && (
          <div>
            <div className="inp-label">Component</div>
            <MultiSelect
              label    = "components"
              options  = {components}
              selected = {pending.components}
              onChange = {v => onPendingChange('components', v)}
            />
          </div>
        )}

        {/* Thread */}
        {thread_ids.length > 0 && (
          <div>
            <div className="inp-label">Thread ID</div>
            <MultiSelect
              label    = "threads"
              options  = {thread_ids}
              selected = {pending.threads}
              onChange = {v => onPendingChange('threads', v)}
            />
          </div>
        )}

        {/* Source file (code file path) */}
        {available_fields.includes('file_path') && (
          <div>
            <div className="inp-label">Source File</div>
            <input
              className   = "inp"
              placeholder = "e.g. nvramserialiser"
              value       = {pending.file_filter}
              onChange    = {e => onPendingChange('file_filter', e.target.value)}
              onKeyDown   = {e => e.key === 'Enter' && onApply()}
            />
          </div>
        )}

        {/* Time range */}
        <div>
          <div className="inp-label">Time Range</div>
          <div className="flex gap-2">
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

        {/* Line range */}
        <div>
          <div className="inp-label">Line Range</div>
          <div className="flex gap-2">
            <input
              className   = "inp"
              placeholder = "From  1"
              type        = "number"
              value       = {pending.line_start}
              onChange    = {e => onPendingChange('line_start', e.target.value)}
            />
            <input
              className   = "inp"
              placeholder = "To    5000"
              type        = "number"
              value       = {pending.line_end}
              onChange    = {e => onPendingChange('line_end', e.target.value)}
            />
          </div>
        </div>

        {/* Apply / Clear */}
        <div className="flex flex-col gap-2 mt-1">
          <button className="btn btn-primary w-full" onClick={onApply}>
            ⚡ Apply Filters
          </button>
          <button className="btn w-full" onClick={onClear}>
            🗑 Clear All Filters
          </button>
        </div>
      </div>
    </div>
  )
}