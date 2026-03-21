/**
 * TimelineTab.jsx — visualises each selected file's time range
 * as a horizontal bar on a shared time axis.
 *
 * Useful for:
 *   • Seeing which files overlap in time
 *   • Spotting gaps in coverage
 *   • Correlating events across files
 */

const COLORS = [
  '#f0a500', '#58a6ff', '#3fb950', '#bc8cff',
  '#39d3bb', '#f85149', '#d29922', '#ff7b72',
]

function parseTs(ts) {
  if (!ts) return null
  // Handle both ISO format and raw formats
  const d = new Date(ts.replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d.getTime()
}

export default function TimelineTab({ files, selectedIds }) {
  const selected = files.filter(f => selectedIds.includes(f.file_id))

  if (selected.length === 0) {
    return (
      <div className="text-muted text-sm">
        Select files to view their time ranges.
      </div>
    )
  }

  // Parse time ranges
  const ranges = selected
    .map((f, i) => ({
      ...f,
      startMs: parseTs(f.time_range?.start),
      endMs:   parseTs(f.time_range?.end),
      color:   COLORS[i % COLORS.length],
    }))
    .filter(f => f.startMs && f.endMs)

  if (ranges.length === 0) {
    return (
      <div className="text-muted text-sm">
        No time range data available. Files may use a timestamp format
        that could not be ISO-normalised.
      </div>
    )
  }

  // Compute global bounds
  const globalStart = Math.min(...ranges.map(r => r.startMs))
  const globalEnd   = Math.max(...ranges.map(r => r.endMs))
  const span        = globalEnd - globalStart || 1

  function toPercent(ms) {
    return ((ms - globalStart) / span) * 100
  }

  function fmtTs(ts) {
    if (!ts) return '?'
    return ts.length > 19 ? ts.slice(0, 19) : ts
  }

  function fmtDuration(ms) {
    const secs = Math.round(ms / 1000)
    if (secs < 60)   return `${secs}s`
    if (secs < 3600) return `${Math.round(secs / 60)}m`
    return `${(secs / 3600).toFixed(1)}h`
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">

      <div className="card card-accent">
        <div className="font-mono font-bold text-xs text-accent mb-1">Timeline</div>
        <div className="text-muted text-xs">
          Overlapping bars indicate files that were active at the same time.
          Correlate events by applying a time filter and selecting multiple files.
        </div>
      </div>

      {/* ── Axis labels ── */}
      <div className="flex justify-between text-muted text-xs font-mono px-1">
        <span>{fmtTs(ranges[0].time_range?.start)}</span>
        <span>{fmtTs(ranges[ranges.length - 1].time_range?.end)}</span>
      </div>

      {/* ── Bars ── */}
      <div className="flex flex-col gap-3">
        {ranges.map(r => {
          const left  = toPercent(r.startMs)
          const width = toPercent(r.endMs) - left
          const dur   = fmtDuration(r.endMs - r.startMs)

          return (
            <div key={r.file_id} className="flex items-center gap-3">
              {/* File label */}
              <div
                className = "font-mono text-xs truncate flex-shrink-0"
                style     = {{ width: 160, color: r.color }}
                title     = {r.filename}
              >
                {r.filename}
              </div>

              {/* Bar track */}
              <div className="flex-1 relative h-7 rounded bg-surface border border-border">
                <div
                  className = "absolute top-0 h-full rounded"
                  style     = {{
                    left:    `${left}%`,
                    width:   `${Math.max(width, 0.5)}%`,
                    background: r.color + '33',
                    border: `1px solid ${r.color}`,
                  }}
                />
                {/* Duration label inside bar */}
                <div
                  className = "absolute top-0 h-full flex items-center px-2 text-xs font-mono"
                  style     = {{
                    left:  `${left}%`,
                    color: r.color,
                    pointerEvents: 'none',
                  }}
                >
                  {width > 8 ? dur : ''}
                </div>
              </div>

              {/* Stats */}
              <div className="text-muted text-xs flex-shrink-0" style={{ width: 100 }}>
                <div>{(r.entry_count || 0).toLocaleString()} entries</div>
                <div style={{ color: r.color + 'cc' }}>{dur}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Overlap detection ── */}
      {ranges.length > 1 && (() => {
        const overlaps = []
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            const a = ranges[i], b = ranges[j]
            if (a.startMs < b.endMs && b.startMs < a.endMs) {
              const overlapStart = Math.max(a.startMs, b.startMs)
              const overlapEnd   = Math.min(a.endMs, b.endMs)
              overlaps.push({
                a: a.filename, b: b.filename,
                dur: fmtDuration(overlapEnd - overlapStart),
              })
            }
          }
        }
        if (!overlaps.length) return null
        return (
          <div className="card">
            <div className="font-mono font-bold text-xs text-ok mb-2">✓ Overlapping Files</div>
            {overlaps.map((o, i) => (
              <div key={i} className="text-xs text-muted py-1 border-b border-border/50 last:border-0">
                <span className="text-text">{o.a}</span>
                <span className="text-accent mx-2">↔</span>
                <span className="text-text">{o.b}</span>
                <span className="ml-2 chip">{o.dur} overlap</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── Per-file detail table ── */}
      <div className="card">
        <div className="font-mono font-bold text-xs text-accent mb-3">File Details</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 pr-3 text-muted font-semibold">File</th>
              <th className="text-left py-1.5 pr-3 text-muted font-semibold">Format</th>
              <th className="text-left py-1.5 pr-3 text-muted font-semibold">Entries</th>
              <th className="text-left py-1.5 pr-3 text-muted font-semibold">Start</th>
              <th className="text-left py-1.5 text-muted font-semibold">End</th>
            </tr>
          </thead>
          <tbody>
            {ranges.map(r => (
              <tr key={r.file_id} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-3 font-mono" style={{ color: r.color }}>
                  {r.filename}
                </td>
                <td className="py-1.5 pr-3 text-info">{r.format}</td>
                <td className="py-1.5 pr-3 text-text">
                  {(r.entry_count || 0).toLocaleString()}
                </td>
                <td className="py-1.5 pr-3 text-muted font-mono">
                  {fmtTs(r.time_range?.start)}
                </td>
                <td className="py-1.5 text-muted font-mono">
                  {fmtTs(r.time_range?.end)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
