/**
 * SummaryTab.jsx — v4 (UI Redesign)
 * Large stat cards, colored severity, improved distribution tables.
 */

function StatCard({ label, value, color = '#f0a500', icon, subtext }) {
  return (
    <div className="stat-card" style={{ '--stat-color': color }}>
      <div className="stat-card-label">
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {label}
      </div>
      <div className="stat-card-value">{value}</div>
      {subtext && (
        <div style={{ fontSize: 11, color: '#6e7681', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
          {subtext}
        </div>
      )}
    </div>
  )
}

function DistTable({ title, data }) {
  if (!data || Object.keys(data).length === 0) return null
  const entries = Object.entries(data).sort(([,a],[,b]) => b - a)
  const total   = entries.reduce((s, [, v]) => s + v, 0)

  return (
    <div className="card">
      <div style={{
        fontFamily: 'Inter, sans-serif',
        fontWeight: 700,
        fontSize: 12,
        color: '#f0a500',
        marginBottom: 14,
        textTransform: 'uppercase',
        letterSpacing: '.06em',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span>▸</span>
        {title.replace(/_/g, ' ')}
        <span style={{ fontWeight: 400, color: '#6e7681', fontSize: 11, marginLeft: 4, textTransform: 'none', letterSpacing: 0 }}>
          ({entries.length} values)
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(([key, cnt]) => {
          const pct = cnt / total * 100
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                color: '#c9d1d9',
                width: 100,
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }} title={key}>
                {key}
              </div>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                color: '#8b949e',
                width: 52,
                flexShrink: 0,
                textAlign: 'right',
              }}>
                {cnt.toLocaleString()}
              </div>
              <div className="dist-bar-track">
                <div
                  className="dist-bar-fill"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
              <div style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fontWeight: 600,
                color: '#8b949e',
                width: 38,
                flexShrink: 0,
                textAlign: 'right',
              }}>
                {pct.toFixed(1)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryLayout({ summary }) {
  const {
    total_entries   = 0,
    time_range      = {},
    distributions   = {},
    top_messages    = {},
    error_samples   = [],
    field_definitions = [],
  } = summary

  const levelFieldName = field_definitions.find(f => f.type === 'level')?.name
  const levelDist      = levelFieldName ? (distributions[levelFieldName] || {}) : {}

  const errorCount = Object.entries(levelDist)
    .filter(([k]) => ['ERROR','ERR','FATAL','CRIT','CRITICAL'].includes(k.toUpperCase()))
    .reduce((s, [, v]) => s + v, 0)
  const warnCount  = Object.entries(levelDist)
    .filter(([k]) => ['WARNING','WARN','WRN'].includes(k.toUpperCase()))
    .reduce((s, [, v]) => s + v, 0)
  const infoCount  = Object.entries(levelDist)
    .filter(([k]) => ['INFO','INF','I'].includes(k.toUpperCase()))
    .reduce((s, [, v]) => s + v, 0)

  const errorPct = total_entries > 0 ? ((errorCount / total_entries) * 100).toFixed(1) : '0'
  const warnPct  = total_entries > 0 ? ((warnCount  / total_entries) * 100).toFixed(1) : '0'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <StatCard
          label="Total Entries"
          value={total_entries.toLocaleString()}
          color="#f0a500"
          icon="📊"
        />
        {levelFieldName && (
          <>
            <StatCard
              label="Errors"
              value={errorCount.toLocaleString()}
              color="#f85149"
              icon="🔴"
              subtext={`${errorPct}% of total`}
            />
            <StatCard
              label="Warnings"
              value={warnCount.toLocaleString()}
              color="#d29922"
              icon="⚠️"
              subtext={`${warnPct}% of total`}
            />
            <StatCard
              label="Info"
              value={infoCount.toLocaleString()}
              color="#58a6ff"
              icon="ℹ️"
            />
          </>
        )}
      </div>

      {/* ── Time range ── */}
      {time_range.start && (
        <div className="card card-accent" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="inp-label">Time Range</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#39d3bb', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{time_range.start}</span>
            <span style={{ color: '#f0a500', fontWeight: 700 }}>→</span>
            <span>{time_range.end}</span>
          </div>
        </div>
      )}

      {/* ── Dynamic distributions ── */}
      {Object.keys(distributions).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {Object.entries(distributions).map(([fname, dist]) => (
            <DistTable key={fname} title={fname} data={dist} />
          ))}
        </div>
      )}

      {/* ── Top repeated messages ── */}
      {Object.keys(top_messages).length > 0 && (
        <div className="card">
          <div style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            fontSize: 12,
            color: '#f0a500',
            marginBottom: 14,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
          }}>
            ▸ Top Repeated Messages
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(top_messages).map(([msg, cnt]) => (
              <div key={msg} style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                paddingBottom: 8,
                borderBottom: '1px solid #21262d',
              }}>
                <span className="chip" style={{ flexShrink: 0, fontWeight: 700 }}>
                  ×{cnt.toLocaleString()}
                </span>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12,
                  color: '#8b949e',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Sample errors ── */}
      {error_samples.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid #f85149' }}>
          <div style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            fontSize: 12,
            color: '#f85149',
            marginBottom: 14,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
          }}>
            ▸ Sample Errors
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {error_samples.map((e, i) => {
              const tsField  = field_definitions.find(f => f.type === 'timestamp')?.name
              const msgField = field_definitions.find(f => f.type === 'message')?.name
              const ts  = tsField  ? (e.fields?.[tsField]  || '') : ''
              const msg = msgField ? (e.fields?.[msgField] || '') : e.raw_line
              return (
                <div key={i} style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12,
                  color: '#ff7b72',
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(248,81,73,0.1)',
                  opacity: 0.85,
                }}>
                  <span style={{ color: '#d2a8ff' }}>L{e.actual_line_number}</span>
                  {ts && <span style={{ color: '#39d3bb', marginLeft: 8 }}>[{ts}]</span>}
                  <span style={{ color: '#6e7681', margin: '0 6px' }}>—</span>
                  <span>{msg}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}

import { useState } from 'react'

export default function SummaryTab({ summary, perFileSummaries, loading }) {
  const [mode, setMode] = useState('combined')

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12, color: '#8b949e' }}>
        <div className="spinner" />
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14 }}>Loading statistics…</span>
      </div>
    )
  }

  if (!summary) {
    return (
      <div style={{ color: '#6e7681', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
        Select files to view statistics.
      </div>
    )
  }

  const showModeToggle = perFileSummaries && perFileSummaries.length > 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%', paddingBottom: 40 }}>
      {showModeToggle && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button
            className={`tab ${mode === 'combined' ? 'active' : ''}`}
            onClick={() => setMode('combined')}
            style={{ padding: '6px 12px', minWidth: 100 }}
          >
            Combined Analysis
          </button>
          <button
            className={`tab ${mode === 'per_file' ? 'active' : ''}`}
            onClick={() => setMode('per_file')}
            style={{ padding: '6px 12px', minWidth: 100 }}
          >
            Per File ({perFileSummaries.length})
          </button>
        </div>
      )}

      {(!showModeToggle || mode === 'combined') && (
        <SummaryLayout summary={summary} />
      )}

      {showModeToggle && mode === 'per_file' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {perFileSummaries.map((fs) => (
            <div key={fs.file_id} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 16px',
                background: '#161b22',
                borderRadius: '8px',
                border: '1px solid #30363d'
              }}>
                <span style={{ fontSize: '18px' }}>📄</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, color: '#e6edf3', fontSize: 15 }}>
                  {fs.filename}
                </span>
              </div>
              <div style={{ paddingLeft: 12, borderLeft: '2px solid #30363d' }}>
                <SummaryLayout summary={fs.summary} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

