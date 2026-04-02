/**
 * App.jsx - root component
 * Fix 3: upload response includes time_range + refresh GET /api/files after upload
 * Fix 5: llmHistory lifted here so LLMPanel state survives tab switches
 */

import { useState, useEffect, useCallback } from 'react'
import Sidebar     from './components/Sidebar.jsx'
import FilesTab    from './components/FilesTab.jsx'
import ResultsTab  from './components/ResultsTab.jsx'
import SummaryTab  from './components/SummaryTab.jsx'
import TimelineTab from './components/TimelineTab.jsx'
import LLMPanel    from './components/LLMPanel.jsx'
import * as api    from './api.js'

const EMPTY_FILTERS = {
  text: '', levels: [], components: [], threads: [],
  file_filter: '', time_start: '', time_end: '', line_start: '', line_end: '',
}
const PAGE_SIZE = 500

export default function App() {
  const [files,       setFiles]       = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [uploading,   setUploading]   = useState(false)
  const [pending,     setPending]     = useState(EMPTY_FILTERS)
  const [applied,     setApplied]     = useState(EMPTY_FILTERS)
  const [page,        setPage]        = useState(0)
  const [metadata,    setMetadata]    = useState({ levels: [], components: [], thread_ids: [], available_fields: [] })
  const [results,     setResults]     = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [summary,     setSummary]     = useState(null)
  const [activeTab,   setActiveTab]   = useState('files')
  const [error,       setError]       = useState(null)
  // Fix 5: LLM history lives in App so it survives tab switches
  const [llmHistory,  setLlmHistory]  = useState([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const selectedFiles   = files.filter(f => selectedIds.includes(f.file_id))
  const isMultiFile     = selectedFiles.length > 1
  const hasMixedFmt     = new Set(selectedFiles.map(f => f.format)).size > 1
  const availableFields = [...new Set(selectedFiles.flatMap(f => f.available_fields || []))]
  const totalEntries    = selectedFiles.reduce((s, f) => s + (f.entry_count || 0), 0)

  const buildSearchReq = useCallback((pageNum = 0) => ({
    file_ids:    selectedIds.length ? selectedIds : null,
    text:        applied.text        || null,
    levels:      applied.levels.length     ? applied.levels     : null,
    components:  applied.components.length ? applied.components : null,
    threads:     applied.threads.length    ? applied.threads    : null,
    file_filter: applied.file_filter || null,
    time_start:  applied.time_start  || null,
    time_end:    applied.time_end    || null,
    line_start:  applied.line_start  ? parseInt(applied.line_start) : null,
    line_end:    applied.line_end    ? parseInt(applied.line_end)   : null,
    page:        pageNum,
    page_size:   PAGE_SIZE,
  }), [selectedIds, applied])

  // Load files on mount
  useEffect(() => {
    api.listFiles().then(data => {
      const f = data.files || []
      setFiles(f)
      setSelectedIds(f.map(x => x.file_id))
    }).catch(() => {})
  }, [])

  // Fetch metadata when selection changes
  useEffect(() => {
    if (!selectedIds.length) {
      setMetadata({ levels: [], components: [], thread_ids: [], available_fields: [] })
      return
    }
    api.getMetadata(selectedIds).then(setMetadata).catch(() => {})
  }, [selectedIds])

  // Run search when filters or selection change
  useEffect(() => {
    if (!selectedIds.length) { setResults(null); return }
    setPage(0)
    runSearch(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, selectedIds])

  // Re-run search when page changes
  useEffect(() => {
    if (!selectedIds.length || !results) return
    runSearch(page)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Fetch summary when Summary tab is opened
  useEffect(() => {
    if (activeTab !== 'summary' || !selectedIds.length) return
    api.getSummary(selectedIds).then(setSummary).catch(() => {})
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

      if (errFiles.length) setError(errFiles.map(f => `${f.filename}: ${f.error}`).join('\n'))

      if (newFiles.length) {
        // Fix 3: upload response includes time_range — set directly
        setFiles(prev => {
          const existing = prev.filter(p => !newFiles.find(n => n.file_id === p.file_id))
          return [...existing, ...newFiles]
        })
        setSelectedIds(prev => [
          ...prev,
          ...newFiles.map(f => f.file_id).filter(id => !prev.includes(id)),
        ])
        // Refresh from GET /api/files to guarantee all fields are present
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
  function handleApply()  { setApplied({ ...pending }); setPage(0) }
  function handleClear()  { setPending(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setPage(0) }
  function handleExportCsv()      { api.exportCsv(buildSearchReq(0)).catch(e => setError(e.message)) }
  function handleExportUnparsed() { api.exportUnparsed(selectedIds.length ? selectedIds : null).catch(e => setError(e.message)) }

  const activeFilterTags = [
    applied.text        && `text="${applied.text}"`,
    applied.levels.length      && `level=[${applied.levels.join(',')}]`,
    applied.components.length  && `component=[${applied.components.join(',')}]`,
    applied.threads.length     && `thread=[${applied.threads.join(',')}]`,
    applied.file_filter && `file="${applied.file_filter}"`,
    applied.time_start  && `from=${applied.time_start}`,
    applied.time_end    && `to=${applied.time_end}`,
    applied.line_start  && `line>=${applied.line_start}`,
    applied.line_end    && `line<=${applied.line_end}`,
  ].filter(Boolean)

  return (
    <div className="flex h-screen overflow-hidden bg-bg">

      <Sidebar
        isOpen          = {isSidebarOpen}
        onToggle        = {() => setIsSidebarOpen(o => !o)}
        files           = {files}
        selectedIds     = {selectedIds}
        metadata        = {metadata}
        pending         = {pending}
        uploading       = {uploading}
        onUpload        = {handleUpload}
        onPendingChange = {(key, val) => setPending(p => ({ ...p, [key]: val }))}
        onApply         = {handleApply}
        onClear         = {handleClear}
      />

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header bar */}
        <div className="card card-accent rounded-none border-x-0 border-t-0 px-5 py-3 flex items-center gap-4 flex-wrap">
          <span className="font-mono font-bold text-accent text-base"> Log Vision </span>
          <span className="text-muted text-xs">
            {selectedFiles.length > 0 ? (
              <>
                <span className="text-text font-semibold">{selectedFiles.length}</span>
                {' '}file{selectedFiles.length !== 1 ? 's' : ''} selected{' · '}
                <span className="text-text font-semibold">{totalEntries.toLocaleString()}</span> entries{' · '}
                {[...new Set(selectedFiles.map(f => f.format))].filter(Boolean).join(', ')}
              </>
            ) : 'No files selected — upload a log file to begin'}
          </span>

          {activeFilterTags.length > 0 && (
            <div className="flex flex-wrap gap-1 ml-2">
              {activeFilterTags.map(tag => <span key={tag} className="chip">{tag}</span>)}
            </div>
          )}

          {error && (
            <div className="ml-auto text-xs text-err bg-err/10 border border-err/30 rounded px-2 py-1 max-w-xs">
              {error}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="tab-bar px-4">
          {[
            { id: 'files',    label: '📁 Files'    },
            { id: 'results',  label: '📊 Results'  },
            { id: 'summary',  label: '📋 Summary'  },
            { id: 'timeline', label: '📈 Timeline' },
            { id: 'llm',      label: '🤖 LLM'      },
          ].map(t => (
            <button
              key       = {t.id}
              className = {`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick   = {() => setActiveTab(t.id)}
            >
              {t.label}
              {t.id === 'files' && files.length > 0 && (
                <span className="ml-1 text-muted" style={{ fontSize: 10 }}>({files.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-4">
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
              availableFields  = {availableFields}
              isMultiFile      = {isMultiFile}
              hasMixedFmt      = {hasMixedFmt}
              page             = {page}
              pageSize         = {PAGE_SIZE}
              onPageChange     = {setPage}
              onExportCsv      = {handleExportCsv}
              onExportUnparsed = {handleExportUnparsed}
              hasUnparsed      = {selectedFiles.some(f => f.unparsed_count > 0)}
            />
          )}

          {activeTab === 'summary' && (
            <SummaryTab summary={summary} loading={!summary && selectedIds.length > 0} />
          )}

          {activeTab === 'timeline' && (
            <TimelineTab files={files} selectedIds={selectedIds} />
          )}

          {/* Fix 5: always mounted, hidden with CSS — preserves history state */}
          <div style={{ display: activeTab === 'llm' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <LLMPanel
              selectedIds     = {selectedIds}
              appliedFilters  = {applied}
              availableFields = {availableFields}
              totalEntries    = {results?.total ?? totalEntries}
              history         = {llmHistory}
              onHistoryChange = {setLlmHistory}
            />
          </div>
        </div>
      </div>
    </div>
  )
}