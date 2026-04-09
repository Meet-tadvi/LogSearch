/**
 * App.jsx — root component — v4 (UI Redesign)
 */

import { useState, useEffect, useCallback } from 'react'
import Sidebar     from './components/Sidebar.jsx'
import FilesTab    from './components/FilesTab.jsx'
import ResultsTab  from './components/ResultsTab.jsx'
import SummaryTab  from './components/SummaryTab.jsx'
import TimelineTab from './components/TimelineTab.jsx'
import LLMPanel    from './components/LLMPanel.jsx'
import FormatsTab  from './components/FormatsTab.jsx'
import * as api    from './api.js'

const EMPTY_FILTERS = {
  text:        '',
  filters:     {},
  file_filter: '',
  time_start:  '',
  time_end:    '',
  line_start:  '',
  line_end:    '',
}

const PAGE_SIZE = 500

const TABS = [
  { id: 'files',    label: 'Files',    icon: '📁' },
  { id: 'results',  label: 'Results',  icon: '📊' },
  { id: 'summary',  label: 'Summary',  icon: '📋' },
  { id: 'timeline', label: 'Timeline', icon: '📈' },
  { id: 'llm',      label: 'LLM',      icon: '🤖' },
  { id: 'formats',  label: 'Formats',  icon: '⚙' },
]

export default function App() {
  const [files,          setFiles]          = useState([])
  const [selectedIds,    setSelectedIds]    = useState([])
  const [uploading,      setUploading]      = useState(false)
  const [pending,        setPending]        = useState(EMPTY_FILTERS)
  const [applied,        setApplied]        = useState(EMPTY_FILTERS)
  const [page,           setPage]           = useState(0)
  const [metadata,       setMetadata]       = useState({ field_definitions: [], distinct_values: {} })
  const [results,        setResults]        = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [summary,        setSummary]        = useState(null)
  const [perFileSummaries, setPerFileSummaries] = useState(null)
  const [activeTab,      setActiveTab]      = useState('files')
  const [error,          setError]          = useState(null)
  const [llmHistory,     setLlmHistory]     = useState([])
  const [isSidebarOpen,  setIsSidebarOpen]  = useState(true)

  const selectedFiles = files.filter(f => selectedIds.includes(f.file_id))
  const isMultiFile   = selectedFiles.length > 1
  const totalEntries  = selectedFiles.reduce((s, f) => s + (f.entry_count || 0), 0)

  const fieldDefinitions = (() => {
    const seen = {}
    selectedFiles.forEach(f => {
      (f.field_definitions || []).forEach(fd => {
        if (!seen[fd.name]) seen[fd.name] = fd
      })
    })
    return Object.values(seen)
  })()

  const buildSearchReq = useCallback((pageNum = 0) => ({
    file_ids:    selectedIds.length ? selectedIds : null,
    text:        applied.text        || null,
    filters:     Object.keys(applied.filters || {}).length ? applied.filters : null,
    file_filter: applied.file_filter || null,
    time_start:  applied.time_start  || null,
    time_end:    applied.time_end    || null,
    line_start:  applied.line_start  ? parseInt(applied.line_start) : null,
    line_end:    applied.line_end    ? parseInt(applied.line_end)   : null,
    page:        pageNum,
    page_size:   PAGE_SIZE,
  }), [selectedIds, applied])

  useEffect(() => {
    api.listFiles().then(data => {
      const f = data.files || []
      setFiles(f)
      setSelectedIds(f.map(x => x.file_id))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedIds.length) {
      setMetadata({ field_definitions: [], distinct_values: {} })
      return
    }
    api.getMetadata(selectedIds).then(setMetadata).catch(() => {})
  }, [selectedIds])

  useEffect(() => {
    if (!selectedIds.length) { setResults(null); return }
    setPage(0)
    runSearch(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, selectedIds])

  useEffect(() => {
    if (!selectedIds.length || !results) return
    runSearch(page)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    if (activeTab !== 'summary' || !selectedIds.length) return
    api.getSummary(selectedIds).then(setSummary).catch(() => {})
    
    if (selectedIds.length > 1) {
      api.getPerFileSummaries(selectedIds).then(d => setPerFileSummaries(d.files)).catch(() => {})
    } else {
      setPerFileSummaries(null)
    }
  }, [activeTab, selectedIds])

  async function runSearch(pageNum) {
    setLoading(true)
    setError(null)
    try {
      setResults(await api.search(buildSearchReq(pageNum)))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(fileList) {
    if (!fileList.length) return
    setUploading(true)
    setError(null)
    try {
      const data     = await api.uploadFiles(fileList)
      const uploaded = data.uploaded || []
      const newFiles = uploaded.filter(u => u.status === 'ready')
      const errFiles = uploaded.filter(u => u.status === 'error')

      if (errFiles.length)
        setError(errFiles.map(f => `${f.filename}: ${f.error}`).join('\n'))

      if (newFiles.length) {
        setFiles(prev => {
          const existing = prev.filter(p => !newFiles.find(n => n.file_id === p.file_id))
          return [...existing, ...newFiles]
        })
        setSelectedIds(prev => [
          ...prev,
          ...newFiles.map(f => f.file_id).filter(id => !prev.includes(id)),
        ])
        api.listFiles().then(d => { if (d.files) setFiles(d.files) }).catch(() => {})
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteFile(fileId) {
    try {
      await api.deleteFile(fileId)
      setFiles(prev => prev.filter(f => f.file_id !== fileId))
      setSelectedIds(prev => prev.filter(id => id !== fileId))
    } catch (e) {
      setError(e.message)
    }
  }

  function handleToggleFile(fileId) {
    setSelectedIds(prev =>
      prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]
    )
  }

  function handleSelectAll()   { setSelectedIds(files.map(f => f.file_id)) }
  function handleDeselectAll() { setSelectedIds([]) }

  function handleApply() { setApplied({ ...pending }); setPage(0) }
  function handleClear() { setPending(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setPage(0) }

  function handleExportCsv()      { api.exportCsv(buildSearchReq(0)).catch(e => setError(e.message)) }
  function handleExportUnparsed() { api.exportUnparsed(selectedIds.length ? selectedIds : null).catch(e => setError(e.message)) }

  const activeFilterTags = [
    applied.text                                     && `text="${applied.text}"`,
    applied.file_filter                              && `file="${applied.file_filter}"`,
    applied.time_start                               && `from=${applied.time_start}`,
    applied.time_end                                 && `to=${applied.time_end}`,
    applied.line_start                               && `line≥${applied.line_start}`,
    applied.line_end                                 && `line≤${applied.line_end}`,
    ...Object.entries(applied.filters || {})
      .filter(([, vals]) => vals.length)
      .map(([k, vals]) => `${k}=[${vals.join(',')}]`),
  ].filter(Boolean)

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0d1117' }}>

      <Sidebar
        isOpen           = {isSidebarOpen}
        onToggle         = {() => setIsSidebarOpen(o => !o)}
        files            = {files}
        selectedIds      = {selectedIds}
        metadata         = {metadata}
        pending          = {pending}
        uploading        = {uploading}
        onUpload         = {handleUpload}
        onPendingChange  = {(key, val) => setPending(p => ({ ...p, [key]: val }))}
        onApply          = {handleApply}
        onClear          = {handleClear}
      />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ── Header bar ── */}
        <div className="app-header">
          {/* Logo */}
          <div className="app-logo">
            <div className="app-logo-icon">🔍</div>
            <span className="app-logo-text">LOG VISION</span>
          </div>

          <div className="app-header-divider" />

          {/* Stats */}
          <div style={{ fontSize: 13, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 6 }}>
            {selectedFiles.length > 0 ? (
              <>
                <span style={{ color: '#e6edf3', fontWeight: 600 }}>{selectedFiles.length}</span>
                {' '}file{selectedFiles.length !== 1 ? 's' : ''} selected
                <span style={{ color: '#30363d' }}>·</span>
                <span style={{ color: '#e6edf3', fontWeight: 600 }}>{totalEntries.toLocaleString()}</span>
                {' '}entries
              </>
            ) : (
              <span style={{ color: '#6e7681' }}>No files selected — upload a log file to begin</span>
            )}
          </div>

          {/* Active filter chips */}
          {activeFilterTags.length > 0 && (
            <div className="flex flex-wrap gap-1 ml-2">
              {activeFilterTags.map(tag => (
                <span key={tag} className="chip" style={{ fontSize: 11 }}>{tag}</span>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="error-banner ml-auto">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button
              key       = {t.id}
              id        = {`tab-${t.id}`}
              className = {`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick   = {() => setActiveTab(t.id)}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === 'files' && files.length > 0 && (
                <span className="tab-badge">{files.length}</span>
              )}
              {t.id === 'results' && results?.total > 0 && (
                <span className="tab-badge">{results.total > 999 ? '999+' : results.total}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-auto p-5" style={{ background: '#0d1117' }}>

          {activeTab === 'files' && (
            <FilesTab
              files         = {files}
              selectedIds   = {selectedIds}
              onToggleFile  = {handleToggleFile}
              onSelectAll   = {handleSelectAll}
              onDeselectAll = {handleDeselectAll}
              onDeleteFile  = {handleDeleteFile}
            />
          )}

          {activeTab === 'results' && (
            <ResultsTab
              results          = {results}
              loading          = {loading}
              fieldDefinitions = {fieldDefinitions}
              isMultiFile      = {isMultiFile}
              page             = {page}
              pageSize         = {PAGE_SIZE}
              onPageChange     = {setPage}
              onExportCsv      = {handleExportCsv}
              onExportUnparsed = {handleExportUnparsed}
              hasUnparsed      = {selectedFiles.some(f => f.unparsed_count > 0)}
            />
          )}

          {activeTab === 'summary' && (
            <SummaryTab
              summary = {summary}
              perFileSummaries = {perFileSummaries}
              loading = {!summary && selectedIds.length > 0}
            />
          )}

          {activeTab === 'timeline' && (
            <TimelineTab files={files} selectedIds={selectedIds} />
          )}

          {/* LLM panel always mounted — display:none preserves history state */}
          <div style={{
            display:       activeTab === 'llm' ? 'flex' : 'none',
            flexDirection: 'column',
            height:        '100%',
          }}>
            <LLMPanel
              selectedIds      = {selectedIds}
              appliedFilters   = {applied}
              fieldDefinitions = {fieldDefinitions}
              totalEntries     = {results?.total ?? totalEntries}
              history          = {llmHistory}
              onHistoryChange  = {setLlmHistory}
            />
          </div>

          {activeTab === 'formats' && (
            <FormatsTab />
          )}

        </div>
      </div>
    </div>
  )
}
