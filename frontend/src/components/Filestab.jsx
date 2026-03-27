/**
 * FilesTab.jsx — dedicated tab for uploaded file cards
 * Shows all file metadata clearly: format, entries, parse rate,
 * time range, confidence, unparsed count. Each card has a
 * select toggle and delete button.
 */

export default function FilesTab({
  files, selectedIds,
  onToggleFile, onSelectAll, onDeselectAll, onDeleteFile,
}) {
  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        No files uploaded yet — drag &amp; drop a log file into the sidebar.
      </div>
    )
  }

  const allSelected  = files.every(f => selectedIds.includes(f.file_id))
  const noneSelected = files.every(f => !selectedIds.includes(f.file_id))

  function fmtTs(ts) {
    if (!ts) return '—'
    return ts.length > 19 ? ts.slice(0, 19) : ts
  }

  return (
    <div className="flex flex-col gap-4 max-w-5xl">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono font-bold text-accent text-xs">
          // files ({files.length})
        </span>
        <span className="text-muted text-xs">
          {selectedIds.length} of {files.length} selected
        </span>
        <div className="flex gap-2 ml-auto">
          <button
            className="btn text-xs px-3 py-1"
            onClick={onSelectAll}
            disabled={allSelected}
          >
            Select All
          </button>
          <button
            className="btn text-xs px-3 py-1"
            onClick={onDeselectAll}
            disabled={noneSelected}
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* ── File cards grid ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {files.map(f => {
          const selected   = selectedIds.includes(f.file_id)
          const rateColor  = f.parse_rate < 80 ? '#f85149' : f.parse_rate < 95 ? '#d29922' : '#3fb950'
          const confColor  = (f.confidence ?? f.detection_confidence ?? 0) < 60 ? '#d29922' : '#3fb950'
          const hasUnparsed = (f.unparsed_count || 0) > 0

          return (
            <div
              key       = {f.file_id}
              className = "card cursor-pointer"
              style     = {{
                borderLeft:  `3px solid ${selected ? '#f0a500' : '#30363d'}`,
                background:  selected ? 'rgba(240,165,0,.04)' : undefined,
                transition:  'border-color .15s, background .15s',
              }}
              onClick={() => onToggleFile(f.file_id)}
            >
              {/* ── Card header ── */}
              <div className="flex items-start gap-2 mb-3">
                <input
                  type     = "checkbox"
                  checked  = {selected}
                  onChange = {() => onToggleFile(f.file_id)}
                  onClick  = {e => e.stopPropagation()}
                  className= "mt-0.5 accent-accent flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="font-mono font-bold text-xs break-all"
                    style={{ color: selected ? '#f0a500' : '#e6edf3' }}
                    title={f.filename}
                  >
                    {f.filename}
                  </div>
                  {f.format && (
                    <span className="chip text-xs mt-1 inline-block" style={{ color: '#58a6ff', borderColor: '#58a6ff55' }}>
                      {f.format}
                    </span>
                  )}
                </div>
                <button
                  className = "btn btn-danger flex-shrink-0 text-xs px-2 py-0.5"
                  onClick   = {e => { e.stopPropagation(); onDeleteFile(f.file_id) }}
                  title     = "Remove file"
                >
                  ✕
                </button>
              </div>

              {/* ── Stats grid ── */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">

                <div>
                  <div className="inp-label" style={{ fontSize: 9 }}>ENTRIES</div>
                  <div className="font-mono font-semibold text-text">
                    {(f.entry_count || 0).toLocaleString()}
                  </div>
                </div>

                <div>
                  <div className="inp-label" style={{ fontSize: 9 }}>PARSE RATE</div>
                  <div className="font-mono font-semibold" style={{ color: rateColor }}>
                    {f.parse_rate?.toFixed(1)}%
                  </div>
                </div>

                <div>
                  <div className="inp-label" style={{ fontSize: 9 }}>CONFIDENCE</div>
                  <div className="font-mono font-semibold" style={{ color: confColor }}>
                    {((f.confidence ?? f.detection_confidence) || 0).toFixed(1)}%
                  </div>
                </div>

                <div>
                  <div className="inp-label" style={{ fontSize: 9 }}>UNPARSED</div>
                  <div className="font-mono font-semibold" style={{ color: hasUnparsed ? '#d29922' : '#3fb950' }}>
                    {hasUnparsed ? `⚠ ${(f.unparsed_count).toLocaleString()}` : '✓ 0'}
                  </div>
                </div>

                {f.time_range?.start && (
                  <div className="col-span-2">
                    <div className="inp-label" style={{ fontSize: 9 }}>TIME RANGE</div>
                    <div className="font-mono text-muted" style={{ fontSize: 10 }}>
                      {fmtTs(f.time_range.start)}
                      <span className="text-accent mx-1">→</span>
                      {fmtTs(f.time_range.end)}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )
        })}
      </div>

    </div>
  )
}