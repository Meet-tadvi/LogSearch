/**
 * ResultsTab.jsx
 * Fix 6: added line_number (source code line) column and extra_fields column
 */

export default function ResultsTab({
  results, loading,
  availableFields, isMultiFile, hasMixedFmt,
  page, pageSize,
  onPageChange, onExportCsv, onExportUnparsed, hasUnparsed,
}) {
  if (!results && !loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        Select files and click ⚡ Apply Filters to see results.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-muted text-sm">
        <div className="spinner" /> Searching…
      </div>
    )
  }

  const { matches = [], total = 0, total_pages = 1, summary = {} } = results
  const avail = new Set(availableFields)
  const { levels = {}, components = {}, time_range = {}, line_range = {} } = summary

  // Build columns dynamically based on available fields
  const cols = [
    { key: 'actual_line_number', label: 'Line',       cls: 'col-line' },
    { key: 'timestamp',          label: 'Timestamp',  cls: 'col-ts'   },
    isMultiFile  && { key: 'source_file', label: 'Source File', cls: 'col-src' },
    hasMixedFmt  && { key: 'format_name', label: 'Format',      cls: ''        },
    avail.has('component')   && { key: 'component',   label: 'Component', cls: ''        },
    avail.has('level')       && { key: 'level',        label: 'Level',     cls: ''        },
    avail.has('thread_id')   && { key: 'thread_id',    label: 'Thread',    cls: ''        },
    avail.has('file_path')   && { key: 'file_path',    label: 'Src File',  cls: ''        },
    // Fix 6a: source code line number column
    avail.has('line_number') && { key: 'line_number',  label: 'Src Line',  cls: 'col-line'},
    { key: 'message',            label: 'Message',    cls: 'col-msg'  },
    // Fix 6b: extra_fields column — shows format-specific fields (e.g. wdog priority)
    { key: 'extra_fields',       label: 'Extra',      cls: 'text-muted' },
  ].filter(Boolean)

  function renderCell(col, m) {
    if (col.key === 'extra_fields') {
      const ef = m.extra_fields || {}
      const entries = Object.entries(ef)
      if (!entries.length) return ''
      return entries.map(([k, v]) => `${k}=${v}`).join(' | ')
    }
    if (col.key === 'level') {
      return <span className={`chip chip-${m.level} text-xs`}>{m.level || ''}</span>
    }
    return String(m[col.key] ?? '')
  }

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* Match summary chips */}
      {total > 0 && (
        <div className="card flex flex-wrap gap-2 items-center py-2">
          <span className="chip">🔢 {total.toLocaleString()} matches</span>
          {line_range.first != null && (
            <span className="chip chip-line">
              📍 Lines {line_range.first} → {line_range.last}
            </span>
          )}
          {time_range.first && (
            <span className="chip chip-time">
              🕐 {(time_range.first || '').slice(0, 19)} → {(time_range.last || '').slice(0, 19)}
            </span>
          )}
          {Object.entries(levels).map(([lvl, cnt]) => (
            <span key={lvl} className={`chip chip-${lvl}`}>
              {lvl}: {cnt.toLocaleString()}
            </span>
          ))}
          {Object.entries(components).slice(0, 5).map(([c, cnt]) => (
            <span key={c} className="chip">{c}: {cnt.toLocaleString()}</span>
          ))}
        </div>
      )}

      {total === 0 && (
        <div className="card text-muted text-sm">No results match the current filters.</div>
      )}

      {/* Pagination controls + download buttons */}
      {total > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
            ◀ Prev
          </button>

          <span className="text-muted text-xs">
            Rows {(page * pageSize + 1).toLocaleString()}–
            {Math.min((page + 1) * pageSize, total).toLocaleString()}
            &nbsp;of&nbsp;{total.toLocaleString()}
            &nbsp;·&nbsp;Page {page + 1} of {total_pages}
          </span>

          <button className="btn" disabled={page >= total_pages - 1} onClick={() => onPageChange(page + 1)}>
            Next ▶
          </button>

          <div className="ml-auto flex gap-2">
            <button className="btn" onClick={onExportCsv}>
              📥 CSV ({total.toLocaleString()} rows)
            </button>
            {hasUnparsed && (
              <button className="btn" onClick={onExportUnparsed}>
                ⚠ Unparsed CSV
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results table */}
      {matches.length > 0 && (
        <div className="flex-1 overflow-auto card p-0">
          <table className="log-table">
            <thead>
              <tr>
                {cols.map(col => <th key={col.key}>{col.label}</th>)}
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