/**
 * FilesTab.jsx — v4 (UI Redesign)
 * Better file cards with parse rate bars, stronger selected state, cleaner stats grid.
 */

export default function FilesTab({
  files, selectedIds,
  onToggleFile, onSelectAll, onDeselectAll, onDeleteFile,
}) {
  if (files.length === 0) {
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
        <div style={{ fontSize: 36, opacity: 0.4 }}>📁</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14 }}>No files uploaded yet</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#484f58' }}>
          Drag & drop a log file into the sidebar to get started
        </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 16, color: '#e6edf3', letterSpacing: '-0.01em' }}>
            Uploaded Files
          </span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#6e7681', marginTop: 1 }}>
            {selectedIds.length} of {files.length} selected for analysis
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button
            className="btn"
            style={{ fontSize: 12 }}
            onClick={onSelectAll}
            disabled={allSelected}
          >
            Select All
          </button>
          <button
            className="btn"
            style={{ fontSize: 12 }}
            onClick={onDeselectAll}
            disabled={noneSelected}
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* ── File cards grid ── */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {files.map(f => {
          const selected    = selectedIds.includes(f.file_id)
          const parseRate   = f.parse_rate ?? 0
          const confidence  = f.confidence ?? f.detection_confidence ?? 0
          const hasUnparsed = (f.unparsed_count || 0) > 0

          const rateColor = parseRate  < 80 ? '#f85149' : parseRate  < 95 ? '#d29922' : '#3fb950'
          const confColor = confidence < 60 ? '#d29922' : '#3fb950'

          return (
            <div
              key       = {f.file_id}
              className = "card card-hover"
              style     = {{
                borderLeft:  `3px solid ${selected ? '#f0a500' : '#21262d'}`,
                background:  selected ? 'rgba(240,165,0,0.04)' : '#161b22',
                cursor:      'pointer',
                transition:  'border-color .18s, background .18s, box-shadow .18s',
              }}
              onClick={() => onToggleFile(f.file_id)}
            >
              {/* ── Card header ── */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                <input
                  type     = "checkbox"
                  checked  = {selected}
                  onChange = {() => onToggleFile(f.file_id)}
                  onClick  = {e => e.stopPropagation()}
                  style    = {{ accentColor: '#f0a500', marginTop: 3, flexShrink: 0, width: 15, height: 15 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontWeight: 600,
                      fontSize: 13,
                      color: selected ? '#f0a500' : '#e6edf3',
                      wordBreak: 'break-all',
                      lineHeight: 1.4,
                    }}
                    title={f.filename}
                  >
                    {f.filename}
                  </div>
                  {f.format && (
                    <span className="chip" style={{
                      marginTop: 6,
                      display: 'inline-flex',
                      color: '#79c0ff',
                      borderColor: 'rgba(88,166,255,0.3)',
                      background: 'rgba(88,166,255,0.1)',
                      fontSize: 10,
                    }}>
                      {f.format}
                    </span>
                  )}
                </div>
                <button
                  className = "btn btn-danger"
                  style     = {{ flexShrink: 0, fontSize: 11, padding: '4px 9px' }}
                  onClick   = {e => { e.stopPropagation(); onDeleteFile(f.file_id) }}
                  title     = "Remove file"
                >
                  ✕ Remove
                </button>
              </div>

              {/* ── Stats grid ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>

                <div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6e7681', marginBottom: 4 }}>
                    Entries
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, color: '#e6edf3' }}>
                    {(f.entry_count || 0).toLocaleString()}
                  </div>
                </div>

                <div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6e7681', marginBottom: 4 }}>
                    Parse Rate
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, color: rateColor }}>
                    {parseRate.toFixed(1)}%
                  </div>
                  <div style={{ marginTop: 4, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${parseRate}%`, background: rateColor, borderRadius: 2, transition: 'width .4s ease' }} />
                  </div>
                </div>

                <div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6e7681', marginBottom: 4 }}>
                    Confidence
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, color: confColor }}>
                    {confidence.toFixed(1)}%
                  </div>
                  <div style={{ marginTop: 4, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${confidence}%`, background: confColor, borderRadius: 2, transition: 'width .4s ease' }} />
                  </div>
                </div>

                <div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6e7681', marginBottom: 4 }}>
                    Unparsed
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 14, color: hasUnparsed ? '#d29922' : '#3fb950' }}>
                    {hasUnparsed ? `⚠ ${(f.unparsed_count).toLocaleString()}` : '✓ 0'}
                  </div>
                </div>

              </div>

              {/* ── Time range ── */}
              {f.time_range?.start && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #21262d' }}>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6e7681', marginBottom: 4 }}>
                    Time Range
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ color: '#39d3bb' }}>{fmtTs(f.time_range.start)}</span>
                    <span style={{ color: '#f0a500' }}>→</span>
                    <span style={{ color: '#39d3bb' }}>{fmtTs(f.time_range.end)}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}