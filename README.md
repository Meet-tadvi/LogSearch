# Log Search

A **local, private log analysis platform** for railway embedded systems.  
Upload log files, parse and index them instantly, filter and search across millions of entries, and ask an AI assistant questions about the data — all running on your own machine with **no internet required**.

---

## Table of Contents

- [Features](#features)
- [Supported Log Formats](#supported-log-formats)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [How to Use](#how-to-use)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Adding a New Log Format](#adding-a-new-log-format)
- [LLM Setup](#llm-setup)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Detail |
|---|---|
| **Multi-file loading** | Upload up to 99+ log files simultaneously, same or different formats |
| **Auto format detection** | Stratified sampling — identifies `pis_railway`, `wdog_system`, `streaming_server`, `ccuc_video_playback`, and any custom format |
| **Fast filtering** | Filter by level, component, thread, time range, line range, and text search — all applied in a single pass |
| **Cross-file search** | Search and sort across all selected files by normalised timestamp |
| **Source File column** | Automatically appears when multiple files are selected |
| **AI analysis** | Ask natural language questions — local LLM sees the **full** filtered dataset, not a sample |
| **Stop-able streaming** | Cancel an LLM response mid-stream with the Stop button |
| **CSV export** | Download all filtered results with no row limit |
| **Unparsed export** | Download lines that could not be matched for debugging |
| **Session persistence** | Parsed data survives server restarts — no need to re-upload |
| **100% private** | No cloud, no internet required, data never leaves your machine |

---

## Supported Log Formats

| Format | Description | Example line |
|---|---|---|
| `pis_railway` | Railway PIS system logs | 
| `wdog_system` | WDOG watchdog system logs (day-first timestamps) | 
| `streaming_server` | Streaming server logs | 
| `ccuc_video_playback` | CCUC video playback logs | 
| **Custom** | Any regex-defined format | [See below](#adding-a-new-log-format) |

---

## System Requirements

### Backend
- Python **3.10** or higher
- pip

### Frontend
- Node.js **18** or higher (npm included)

### LLM *(optional — needed only for AI chat)*
- [Ollama](https://ollama.com) — download and install from the official site
- Recommended models:

| Model | RAM needed | Speed | Quality |
|---|---|---|---|
| `llama3.1:8b` | ~5 GB | Fast | Good |
| `qwen2.5:14b` | ~9 GB | Medium | Better |
| `deepseek-r1:14b` | ~9 GB | Medium | Best reasoning |
| `mistral:7b` | ~4 GB | Fast | Good |

⚠️ Do **not** use models larger than your available RAM (e.g. 671B models require 300+ GB).

Or you can use ollama cloud models like  `deepseek-v3.1:671b-cloud`

### Hardware
- **RAM**: 8 GB minimum, 16 GB recommended for large log files
- **Disk**: ~2× the size of your log files (for session JSON storage)
- **GPU**: Optional — Ollama uses it automatically if available (NVIDIA CUDA or AMD ROCm)

---

## Installation

### 1 — Clone the repository

```bash
git clone https://github.com/Meet-tadvi/LogSearch.git
cd LogSearch
```

### 2 — Backend setup

```bash
# Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install dependencies
cd backend
pip install -r requirements.txt
```

### 3 — Frontend setup

```bash
# In a separate terminal — no venv needed
cd frontend
npm install
```

### 4 — LLM setup *(optional)*

```bash
# Install Ollama from https://ollama.com, then pull a model
ollama pull llama3.1:8b
```

---

## Running the App

You need **two terminals** running simultaneously.

### Terminal 1 — Backend

```bash
# From the project root
venv\Scripts\activate       # Windows
# source venv/bin/activate  # macOS / Linux

cd backend
uvicorn main:app --reload --port 8000
```

Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

### Terminal 2 — Frontend

```bash
cd frontend
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** in your browser.

---

## How to Use

### Uploading files

1. Drag and drop `.log`, `.txt`, or `.out` files onto the upload zone in the left sidebar
2. Or click the zone to browse for files
3. Files are parsed automatically — each file card shows format, entry count, parse rate, detection confidence, and time range
4. Multiple files can be uploaded at once and are parsed in parallel

> Maximum file size: **200 MB** per file

### Filtering

Set any combination of filters in the sidebar and click **⚡ Apply Filters**:

| Filter | Description |
|---|---|
| **Text Search** | Substring search across the full raw log line (case-insensitive) |
| **Level** | Multiselect — INFO, ERROR, WARNING, DEBUG |
| **Component** | Multiselect — system component names |
| **Thread ID** | Multiselect — thread identifiers (hex or decimal) |
| **Source File** | Substring filter on the uploaded filename |
| **Time Range** | From / To — accepts `08:35` (time only) or `2025-04-17T08:35` (full datetime) |
| **Line Range** | From / To — filters by line number in the original file |

Press **Enter** in the text field or click **Apply Filters** to run the search.  
Click **🗑 Clear All Filters** to reset.

### Tabs

| Tab | What it shows |
|---|---|
| **📁 Files** | File cards with metadata — format, entry count, parse rate, confidence, time range |
| **📊 Results** | Paginated log table (500 rows/page) with match summary chips |
| **📋 Summary** | Aggregate stats — level distribution, component breakdown, thread distribution, top repeated messages, sample errors |
| **📈 Timeline** | Visual time-range bars for each file on a shared axis — shows overlapping files |
| **🤖 LLM** | Conversational AI chat — asks questions about the complete filtered dataset |

### LLM tab tips

1. Apply filters to narrow the dataset first (fewer entries = faster response)
2. Check the **token estimate** — amber means large context, red means it exceeds the model limit
3. Click **🔍 Preview data** to see the first 50 rows of CSV being sent
4. Type a question and press **Send ↵** or **Enter**
5. Click **⏹ Stop** to cancel a response mid-stream

> The AI sees **every filtered row** — not a sample. All answers are based on the complete filtered dataset.

---

## Project Structure

```
LogSearch/
├── backend/
│   ├── main.py                  # FastAPI app — all REST + SSE endpoints
│   ├── log_parser.py            # Format detection, LogEntry parsing
│   ├── search_operations.py     # Multi-index in-memory search and filtering
│   ├── session_store.py         # Hot RAM layer + cold JSON-on-disk persistence
│   ├── llm.py                   # CSV builder, Ollama streaming, SSE events
│   ├── log_formats.json         # Externally editable format definitions
│   ├── requirements.txt
│   └── data/
│       └── sessions/            # Auto-created — one directory per session
│           └── <session-uuid>/
│               ├── session.json
│               ├── <file_id>_entries.json
│               └── <file_id>_unparsed.json
│
└── frontend/
    ├── src/
    │   ├── App.jsx              # Root component — all shared state
    │   ├── api.js               # Centralised HTTP + SSE fetch layer
    │   ├── index.css            # Global design tokens + component styles
    │   ├── main.jsx             # React entry point
    │   └── components/
    │       ├── Sidebar.jsx      # Upload zone + all filter controls
    │       ├── FilesTab.jsx     # File cards grid
    │       ├── ResultsTab.jsx   # Paginated log table
    │       ├── SummaryTab.jsx   # Statistics distributions
    │       ├── TimelineTab.jsx  # Time-range visualisation
    │       └── LLMPanel.jsx     # AI chat interface
    ├── package.json
    └── vite.config.js
```

---

## Architecture Overview

```
Browser (React SPA — localhost:5173)
│
│  HTTP REST / Server-Sent Events
│  X-Session-ID header (UUID from localStorage)
│
FastAPI Backend (localhost:8000)
│
├── log_parser.py        ← Format detection (stratified sampling, ≥30% match)
│                           Async batch parsing (1000 entries/batch)
│                           LogEntry dataclass with extra_fields for custom data
│
├── search_operations.py ← 8 in-memory indices (line, timestamp, component,
│                           level, thread, file_path, source_line, extra_fields)
│                           Single-pass AND filter — find_combined()
│
├── session_store.py     ← Hot layer: SearchOperations in RAM
│                           Cold layer: JSON files on disk
│                           Startup restore, 24-hour TTL, multi-file merge
│                           Cross-file sort by ISO-normalised timestamp_dt
│
├── llm.py               ← Builds CSV from all filtered matches
│                           Sends to Ollama with full dataset in system prompt
│                           Multi-turn history; CSV re-sent every call (stateless)
│                           Streams SSE tokens; polls is_disconnected() for Stop
│
└── log_formats.json     ← Hot-reloadable format definitions (no restart needed)
```

**Session isolation**: Every browser tab generates a UUID stored in `localStorage` and sends it as `X-Session-ID` on every request. Sessions are fully isolated — one session cannot access another's files.

---

## LLM Setup

### Change the model

Edit `backend/llm.py`, line 1:

```python
OLLAMA_MODEL = 'llama3.1:8b'   # change this to your preferred model
```

Then pull the model:

```bash
ollama pull llama3.1:8b
```

### Token limits

The LLM has a context window. A rough guide based on ~80 chars/row average:

| Filtered entries | Estimated tokens | Status |
|---|---|---|
| < 3,000 | < 60,000 | ✅ Safe |
| 3,000 – 5,000 | 60,000 – 100,000 | ⚠️ Large — model may slow down |
| > 5,000 | > 100,000 | ❌ Exceeds limit — narrow your filters |

The LLM tab shows a live colour-coded estimate before you send a question.

---

## API Reference

The full interactive API documentation (Swagger UI) is available at:

```
http://localhost:8000/docs
```

### Quick endpoint reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/files/upload` | Upload and parse one or more log files |
| `GET` | `/api/files` | List files in the current session |
| `DELETE` | `/api/files/{file_id}` | Remove a file from the session |
| `GET` | `/api/metadata` | Fetch filter dropdown options (levels, components, threads) |
| `POST` | `/api/search` | Paginated multi-dimensional search |
| `GET` | `/api/summary` | Aggregate statistics for selected files |
| `POST` | `/api/export/csv` | Download filtered results as CSV |
| `POST` | `/api/export/unparsed` | Download unparsed lines as CSV |
| `POST` | `/api/llm/chat` | Stream LLM response as Server-Sent Events |
| `GET` | `/api/llm/context-info` | Token estimate for current filter |
| `POST` | `/api/llm/csv-preview` | Preview first 50 rows of CSV sent to LLM |
| `GET` | `/api/formats` | List all log format definitions |
| `POST` | `/api/formats` | Add a new log format (validates regex) |
| `DELETE` | `/api/formats/{name}` | Remove a log format |
| `DELETE` | `/api/session` | Wipe the entire session |
| `GET` | `/api/health` | Health check |

---

## Troubleshooting

### Backend won't start — `uvicorn` not found

```bash
# Make sure venv is activated
venv\Scripts\activate          # Windows
source venv/bin/activate       # macOS / Linux

# Try with python -m
python -m uvicorn main:app --reload --port 8000
```

### Frontend won't start — `npm` not found

Download and install [Node.js LTS](https://nodejs.org) — npm is included automatically.

### File uploads silently fail

- Check the file extension is `.log`, `.txt`, or `.out`
- Check the file is under **200 MB**
- Check the backend terminal for error messages

### Format not detected

The format detector requires **≥ 30%** of sampled lines to match.

- Test your regex at [regex101.com](https://regex101.com) with Python flavour selected
- Make sure the `pattern` uses named groups: `(?P<name>...)`
- Make sure the file actually contains the expected format

### Timeline shows nothing

`timestamp_dt` could not be computed. Check that `timestamp_format` in `log_formats.json` matches the actual timestamp in the file — especially day-first vs month-first ordering.

### Ollama memory error

```
Ollama error: model requires more system memory than is available
```

Switch to a smaller model in `backend/llm.py`:

```python
OLLAMA_MODEL = 'llama3.1:8b'   # ~5 GB RAM
```

Then pull it: `ollama pull llama3.1:8b`

### LLM returns no results / empty context error

Ensure that:
1. At least one file is selected (checkbox in the Files tab)
2. Your filters are not too restrictive — try **🗑 Clear All Filters** and re-apply
3. Ollama is running: `ollama serve`

### Session data lost after server restart

Sessions are restored automatically from `backend/data/sessions/` on startup. If the `data/` directory was deleted, sessions cannot be restored — re-upload your log files to start a new session.

---

## License

This project is for internal use. All log data processed by this system remains on the local machine and is never transmitted externally.

The local LLM integration uses [Ollama](https://ollama.com) which is MIT licensed. Please verify the license of any model you pull before use in a production environment.