/**
 * ResultsTab.jsx — v4 (UI Redesign)
 * Better pagination controls, pill-shaped level chips, improved summary bar.
 */

const LEVEL_COLORS = {
  INFO:     '#58a6ff',
  INFO_:    '#58a6ff',
  INF:      '#58a6ff',
  Inf:      '#58a6ff',
  ERROR:    '#f85149',
  ERR:      '#f85149',
  Err:      '#f85149',
  FATAL:    '#f85149',
  CRITICAL: '#f85149',
  CRIT:     '#f85149',
  WARNING:  '#d29922',
  WARN:     '#d29922',
  WRN:      '#d29922',
  Wrn:      '#d29922',
  DEBUG:    '#3fb950',
  DBG:      '#3fb950',
  Dbg:      '#3fb950',
  TRACE:    '#8b949e',
  VERBOSE:  '#8b949e',   
}

function getLevelColor(val) {
  if (!val) return null
  return LEVEL_COLORS[val] || LEVEL_COLORS[val.toUpperCase()] || null
}

export default function ResultsTab({
  results, loading,
  searchQuery,
  fieldDefinitions,
  isMultiFile,
  page, pageSize,
  onPageChange, onExportCsv, onExportUnparsed, hasUnparsed,
}) {
  if (!results && !loading) {
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
        <div style={{ fontSize: 36, opacity: 0.4 }}>📊</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14 }}>No results yet</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#484f58' }}>
          Select files and click ⚡ Apply Filters to see results
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12, color: '#8b949e' }}>
        <div className="spinner" />
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14 }}>Searching through log entries…</span>
      </div>
    )
  }

  const { matches = [], total = 0, total_pages = 1, summary = {} } = results

  const cols = [
    { key: 'line',   label: 'Line',   cls: 'col-line', special: 'line' },
    isMultiFile && { key: 'source_file', label: 'Source File', cls: 'col-src', special: 'source' },
    ...fieldDefinitions.map(fd => ({
      key:     fd.name,
      label:   fd.name.replace(/_/g, ' '),
      cls:     fd.type === 'timestamp' ? 'col-ts'
             : fd.type === 'message'   ? 'col-msg'
             : '',
      special: fd.type,
      type:    fd.type,
    })),
  ].filter(Boolean)

  const { distributions = {}, time_range = {}, line_range = {} } = summary

  function highlightText(text, query) {
    if (!query || !text) return text
    
    // Split query by commas, trim, and filter out empties to match backend logic
    const terms = query.split(',').map(t => t.trim()).filter(Boolean)
    if (terms.length === 0) return text

    const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi')
    const parts = text.split(regex)

    const isMatch = (part) => {
      const lowerPart = part.toLowerCase()
      return terms.some(t => t.toLowerCase() === lowerPart)
    }

    return (
      <>
        {parts.map((part, i) =>
          isMatch(part) ? (
            <mark key={i} style={{ backgroundColor: 'rgba(220, 163, 41, 0.4)', color: '#fff', borderRadius: '2px', padding: '0 2px' }}>
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    )
  }

  function renderCell(col, m) {
    if (col.special === 'line')   return m.actual_line_number
    if (col.special === 'source') return m.source_file || ''

    const val = (m.fields || {})[col.key] ?? ''

    if (col.type === 'level') {
      const color = getLevelColor(String(val))
      if (color) {
        return (
          <span
            className="chip"
            style={{
              color,
              background:  color + '1a',
              borderColor: color + '44',
              fontSize: 10,
              padding: '2px 8px',
            }}
          >
            {highlightText(String(val), searchQuery)}
          </span>
        )
      }
    }

    return highlightText(String(val), searchQuery)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>

      {/* ── Summary chips bar ── */}
      {total > 0 && (
        <div className="card" style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className="chip" style={{ fontWeight: 700 }}>
            🔢 <strong>{total.toLocaleString()}</strong> matches
          </span>
          {line_range.first != null && (
            <span className="chip chip-line">
              📍 Lines {line_range.first.toLocaleString()} → {line_range.last.toLocaleString()}
            </span>
          )}
          {time_range.first && (
            <span className="chip chip-time">
              🕐 {(time_range.first || '').slice(0, 19)} → {(time_range.last || '').slice(0, 19)}
            </span>
          )}
          {Object.entries(distributions).slice(0, 1).map(([fname, dist]) =>
            fname.toLowerCase().includes('level') &&
            Object.entries(dist).map(([val, cnt]) => {
              const color = getLevelColor(val) || '#8b949e'
              return (
                <span
                  key={`${fname}-${val}`}
                  className="chip"
                  style={{ color, background: color + '1a', borderColor: color + '44' }}
                >
                  {val}: <strong>{cnt.toLocaleString()}</strong>
                </span>
              )
            })
          )}
        </div>
      )}

      {total === 0 && (
        <div className="card" style={{ color: '#8b949e', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
          No results match the current filters.
        </div>
      )}

      {/* ── Pagination + export ── */}
      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            ◀ Prev
          </button>

          <div style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            color: '#8b949e',
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: 7,
            padding: '5px 12px',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}>
            Rows <strong style={{ color: '#c9d1d9' }}>
              {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, total).toLocaleString()}
            </strong>
            &nbsp;of&nbsp;
            <strong style={{ color: '#c9d1d9' }}>{total.toLocaleString()}</strong>
            <span style={{ color: '#30363d', margin: '0 4px' }}>·</span>
            Page <strong style={{ color: '#c9d1d9' }}>{page + 1}</strong> of {total_pages}
          </div>

          <button
            className="btn"
            style={{ fontSize: 13 }}
            disabled={page >= total_pages - 1}
            onClick={() => onPageChange(page + 1)}
          >
            Next ▶
          </button>

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="btn" style={{ fontSize: 12 }} onClick={onExportCsv}>
              📥 CSV ({total.toLocaleString()} rows)
            </button>
            {hasUnparsed && (
              <button className="btn" style={{ fontSize: 12, color: '#d29922', borderColor: 'rgba(210,153,34,0.35)' }} onClick={onExportUnparsed}>
                ⚠ Unparsed CSV
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Results table ── */}
      {matches.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto', borderRadius: 10, border: '1px solid #21262d', background: '#161b22' }}>
          <table className="log-table">
            <thead>
              <tr>
                {cols.map(col => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => (
                <tr key={`${m.actual_line_number}-${i}`}>
                  {cols.map(col => (
                    <td
                      key       = {`${m.actual_line_number}-${col.key}`}
                      className = {col.cls}
                    >
                      {renderCell(col, m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
