# Log Search System

A local, private log analysis platform for railway systems.
Upload log files, parse and index them instantly, filter and search across
millions of entries, and ask an AI assistant questions about the data —
all running on your own machine with no internet required.

1. What It Does

| Feature | Detail |
| **Multi-file loading** | Upload up to 99+ log files simultaneously, same or different formats |
| **Auto format detection** | Automatically identifies `pis_railway`, `wdog_system`, and any custom format |
| **Fast filtering** | Filter by level, component, thread, time range, line range, text search |
| **Cross-file search** | Search and sort across all selected files by normalised timestamp |
| **Source File column** | Automatically appears when multiple files are selected |
| **AI analysis** | Ask natural language questions — local LLM sees the full filtered dataset |
| **CSV export** | Download all filtered results with no row limit |
| **Session persistence** | Parsed data survives server restarts via SQLite |
| **100% private** | No cloud, no internet required, data never leaves your machine |

2. System Requirements

### Backend
- Python 3.10 or higher
- pip

### Frontend
- Node.js 18 or higher (includes npm automatically)

### LLM (optional — needed only for AI chat)
- Ollama — download from [https://ollama.com](https://ollama.com)
- Recommended model: `llama3.1:8b` (~5 GB RAM) or `qwen2.5:14b` (~9 GB RAM)
- **Do not use** models larger than your available RAM (e.g. 671B models require 300+ GB)

### Hardware
- RAM: 8 GB minimum, 16 GB recommended for large log files
- Disk: ~2× the size of your log files (for SQLite database)
- GPU: Optional — Ollama uses it automatically if available (NVIDIA CUDA or AMD ROCm)

3. Installation

### Step 1 — Clone or copy the project

Place the project at `C:\Users\<you>\Desktop\ragold\` (or any path you prefer).

### Step 2 — Backend setup

Open a terminal and run:

```powershell
cd <your_path>
py -3.12 -m venv venv
venv\Scripts\activate

cd backend
pip install -r requirements.txt
```
### Step 3 — Frontend setup

Open a second terminal (no venv needed):

```powershell
cd <your_path>\frontend
npm install
```

This downloads React, Vite, and Tailwind into `node_modules/`. Takes about a minute on first run.

### Step 4 — LLM setup (optional)

Download and install Ollama from [https://ollama.com](https://ollama.com), then pull a model:

```powershell
ollama pull llama3.1:8b
```

4. Running the System

You need two terminals running simultaneously.

### Terminal 1 — Backend

```powershell
cd <your_path>
venv\Scripts\activate
cd backend
uvicorn main:app --reload --port 8000
```

Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

### Terminal 2 — Frontend

```powershell
cd <your_path>\frontend
npm run dev
```
Expected output:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

5. Open the app

Navigate to **http://localhost:5173** in your browser.

## How to Use

### Uploading Files

1. Drag and drop `.log`, `.txt`, or `.out` files onto the upload zone in the left sidebar
2. Or click the upload zone to browse for files
3. Files are parsed automatically — each file card shows format, entry count, and parse rate
4. Multiple files can be uploaded at once and are parsed in parallel

### Filtering

Set any combination of filters in the sidebar and click **⚡ Apply Filters**:

| Filter | Description ||
| Text Search | Substring search across the full raw log line |
| Level | Multiselect — INFO, ERROR, WARNING, DEBUG |
| Component | Multiselect — system component names |
| Thread ID | Multiselect — thread identifiers |
| Source File | Substring filter on the uploaded filename |
| Time Range | From/To — accepts `08:35` (time only) or `2025-04-17T08:35` (full datetime) |
| Line Range | From/To — filters by line number in the original file |

Press **Enter** in the text field or click **Apply Filters** to run the search.
Click **🗑 Clear All Filters** to reset.

### Results Table

- Columns adapt automatically to the detected format
- **Source File** column appears when multiple files are selected
- **Format** column appears when files of different formats are selected
- Click **📥 CSV** to download all filtered results (no row limit)
- Click **⚠ Unparsed CSV** to download lines that could not be parsed

### Summary Tab

Aggregate statistics across all selected files:
- Total entries, error count, warning count, info count
- Time range
- Level distribution with percentage bars
- Component distribution
- Thread distribution
- Top repeated messages
- Sample error lines

### Timeline Tab

Visual time range bars for each selected file on a shared axis.
Shows which files overlap in time — useful for correlating events
across files that were running simultaneously.

### LLM Tab

1. Apply filters to narrow the dataset (fewer entries = faster response)
2. Check the token estimate — amber/red means the context may be too large
3. Click **🔍 Preview data** to see the first 50 rows of CSV being sent
4. Type a question and press **Send ↵** or **Enter**

The AI sees every filtered row — not a sample. All answers are based on the complete filtered dataset.

6. Supported Log Formats

### pis_railway
Railway PIS system logs.

### wdog_system
WDOG watchdog system logs. Timestamp is `DD-MM` (day first).

## Adding a New Log Format

Open `backend/log_formats.json` and add a new entry:

```json
{
  "my_format": {
    "description": "My application logs",
    "pattern": "(?P<timestamp>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) (?P<level>\\w+) (?P<message>.+)",
    "fields": ["timestamp", "level", "message"],
    "level_map": {},
    "timestamp_format": "%Y-%m-%d %H:%M:%S",
    "example": "2025-04-17 08:35:19 ERROR Something went wrong"
  }
}
```

**Rules:**
- `pattern` must use Python named capture groups: `(?P<name>...)`
- `pattern` must include at minimum `(?P<timestamp>...)` and `(?P<message>...)`
- `fields` lists which groups are present in this format
- `level_map` maps abbreviated levels to full names (leave `{}` if already normalised)
- `timestamp_format` uses Python `strptime` codes — see table below
- Save the file. No server restart needed with `--reload`.

### Common timestamp format codes

| Code | Meaning | Example ||
| `%Y` | 4-digit year | `2025` |
| `%m` | Month 01-12 | `04` |
| `%d` | Day 01-31 | `17` |
| `%H` | Hour 00-23 | `08` |
| `%M` | Minute 00-59 | `35` |
| `%S` | Second 00-59 | `19` |
| `%f` | Microseconds (accepts ms too) | `981` |

> **Important:** Use `%d-%m` for day-first formats (e.g. `18-02`), not `%m-%d`.
> Month 18 does not exist — using the wrong order will silently produce `None` timestamps.

7. LLM Setup

### Change the model

Edit `backend/llm.py`, line 1:

```python
OLLAMA_MODEL = 'llama3.1:8b'   # change this
```

Then pull the model:

```powershell
ollama pull llama3.1:8b
```

### Recommended models

| Model | RAM needed | Speed | Quality ||
| `llama3.1:8b` | ~5 GB | Fast | Good |
| `qwen2.5:14b` | ~9 GB | Medium | Better |
| `deepseek-r1:14b` | ~9 GB | Medium | Best reasoning |
| `mistral:7b` | ~4 GB | Fast | Good |

### Token limits

The LLM has a context window limit. A rough guide:

| Filtered entries | Estimated tokens | Status ||
| < 3,000 | < 60,000 | ✅ Safe |
| 3,000 – 5,000 | 60,000 – 100,000 | ⚠ Large — model may slow down |
| > 5,000 | > 100,000 | ❌ Exceeds limit — narrow filters |

If the token estimate shows amber or red, apply tighter filters before asking questions.

8. Troubleshooting

### Backend won't start — `uvicorn` not found

```powershell
# Make sure venv is activated
venv\Scripts\activate
# Then try with python -m
python -m uvicorn main:app --reload --port 8000
```

### Frontend won't start — `npm` not found

Download and install Node.js from [https://nodejs.org](https://nodejs.org) (LTS version).
npm is included automatically.

### File uploads silently fail

- Check the file is `.log`, `.txt`, or `.out`
- Check the file is under 200 MB
- Check the backend terminal for error messages

### Format not detected

The format detector requires at least 30% of sampled lines to match.
Check that:
- The regex in `log_formats.json` is correct (test at [https://regex101.com](https://regex101.com))
- The `pattern` uses named groups: `(?P<name>...)`
- The file actually contains the expected format

### Timeline shows nothing

This means `timestamp_dt` could not be computed for the file's entries.
Check that `timestamp_format` in `log_formats.json` is correct for that format.

### Ollama memory error

```
Ollama error: model requires more system memory (X GiB) than is available
```

The model is too large for your machine. Switch to a smaller model:

```python
# backend/llm.py
OLLAMA_MODEL = 'llama3.1:8b'   # needs ~5 GB
```

```powershell
ollama pull llama3.1:8b
```

### Search returns no results despite data being loaded

Check the active filter chips in the header bar — a filter may be set that excludes
all entries. Click **🗑 Clear All Filters** and try again.

### Session data lost after server restart

Sessions are restored automatically on startup from `data/sessions/`.
If the `data/` directory was deleted, sessions cannot be restored.
Re-upload the log files to start a new session.

9. API Reference

The full interactive API documentation is available at:

```
http://localhost:8000/docs
```
This shows all endpoints with request/response schemas and a "Try it out" button
for live testing without the frontend.

10. Licence

This project is for internal use. All log data processed by this system
remains on the local machine and is never transmitted externally.

and the local llm contains MIT license. 
if you want to use other dependencies please check the license before using it.