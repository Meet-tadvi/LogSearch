/**
 * SummaryTab.jsx — full statistics for selected files
 */

function StatCard({ label, value, sub, color = '#f0a500' }) {
  return (
    <div className="card text-center">
      <div className="inp-label">{label}</div>
      <div className="font-mono font-bold text-sm mt-1" style={{ color }}>{value}</div>
      {sub && <div className="text-muted text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function DistTable({ title, data }) {
  if (!data || Object.keys(data).length === 0) return null
  const entries = Object.entries(data)
  const total   = entries.reduce((s, [, v]) => s + v, 0)
  return (
    <div className="mt-4">
      <div className="inp-label mb-2">{title}</div>
      <table className="w-full text-xs">
        <tbody>
          {entries.map(([key, cnt]) => (
            <tr key={key} className="border-b border-border/50">
              <td className="py-1.5 pr-3 font-mono text-text">{key}</td>
              <td className="py-1.5 pr-3 text-muted">{cnt.toLocaleString()}</td>
              <td className="py-1.5 w-32">
                <div className="flex items-center gap-2">
                  <div
                    className = "h-1.5 rounded-full bg-accent/60"
                    style     = {{ width: `${Math.round(cnt / total * 100)}%`, minWidth: 2 }}
                  />
                  <span className="text-muted">{(cnt / total * 100).toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SummaryTab({ summary, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-3 text-muted text-sm">
        <div className="spinner" /> Loading statistics…
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="text-muted text-sm">
        Select files to view statistics.
      </div>
    )
  }

  const { total_entries = 0, time_range = {},
          levels = {}, components = {}, threads = {},
          files = {}, top_messages = {}, error_samples = [] } = summary
  const lvl = levels.distribution || levels

  return (
    <div className="flex flex-col gap-5 w-full">

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="TOTAL ENTRIES"  value={total_entries.toLocaleString()} />
        <StatCard label="ERRORS"   value={(lvl.ERROR   || 0).toLocaleString()} color="#f85149" />
        <StatCard label="WARNINGS" value={(lvl.WARNING || 0).toLocaleString()} color="#d29922" />
        <StatCard label="INFO"     value={(lvl.INFO    || 0).toLocaleString()} color="#58a6ff" />
      </div>

      {/* ── Time range ── */}
      {time_range.start && (
        <div className="card card-accent">
          <div className="inp-label mb-1">Time Range</div>
          <div className="font-mono text-xs text-teal-300">
            {time_range.start} → {time_range.end}
          </div>
        </div>
      )}

      {/* ── Distributions (two columns) ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Level distribution */}
        {Object.keys(lvl).length > 0 && (
          <div className="card">
            <div className="font-mono font-bold text-xs text-accent mb-2">Log Levels</div>
            <DistTable data={lvl} />
          </div>
        )}

        {/* Component distribution */}
        {components.distribution && Object.keys(components.distribution).length > 0 && (
          <div className="card">
            <div className="font-mono font-bold text-xs text-accent mb-2">
              Components ({components.total})
            </div>
            <DistTable data={components.distribution} />
          </div>
        )}

        {/* Thread distribution */}
        {threads.distribution && Object.keys(threads.distribution).length > 0 && (
          <div className="card">
            <div className="font-mono font-bold text-xs text-accent mb-2">
              Threads ({threads.total})
            </div>
            <DistTable data={threads.distribution} />
          </div>
        )}

        {/* Top source files */}
        {files.top && Object.keys(files.top).length > 0 && (
          <div className="card">
            <div className="font-mono font-bold text-xs text-accent mb-2">Top Source Files</div>
            <DistTable data={files.top} />
          </div>
        )}

      </div>

      {/* ── Top repeated messages ── */}
      {Object.keys(top_messages).length > 0 && (
        <div className="card">
          <div className="font-mono font-bold text-xs text-accent mb-3">Top Repeated Messages</div>
          {Object.entries(top_messages).map(([msg, cnt]) => (
            <div key={msg} className="flex gap-3 py-1.5 border-b border-border/50 last:border-0">
              <span className="chip flex-shrink-0">{cnt.toLocaleString()}×</span>
              <span className="font-mono text-xs text-muted truncate">{msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Sample errors ── */}
      {error_samples.length > 0 && (
        <div className="card">
          <div className="font-mono font-bold text-xs text-err mb-3">Sample Errors</div>
          {error_samples.map((e, i) => (
            <div key={i} className="font-mono text-xs text-err/80 py-1 border-b border-border/50 last:border-0">
              L{e.actual_line_number} [{e.timestamp}] — {e.message}
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
