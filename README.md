# LogSearch

**A fast, private, local-first log analysis platform** specially
designed for **railway systems** and other structured, high-volume log
environments.

Upload multiple log files → Automatically parse them → Index instantly →
Apply powerful filters → Ask questions in natural language using a
**local AI** --- all running **100% offline** on your machine with
complete data privacy.

## ✨ Key Features

-   Support for uploading **multiple log files** of different formats at
    once
-   Smart auto-parsing using regex with configurable log formats
-   Fast filtering by time range, log level, component, thread,
    filename, and keywords
-   Full-text search across raw log lines
-   Cross-file unified search and analysis
-   **AI Assistant** powered by local LLM (Ollama)
-   Summary statistics, level distribution, and timeline view
-   Export filtered results and unparsed lines as CSV
-   Session persistence using SQLite
-   Completely private and offline

## 🛠 Tech Stack

-   Backend: Python, FastAPI, Uvicorn, SQLite
-   Frontend: React, Vite, Tailwind CSS
-   AI: Ollama (local LLM)

## 🚀 Quick Start

### Clone Repo

``` bash
git clone https://github.com/Meet-tadvi/LogSearch.git
cd LogSearch
```

### Backend

``` bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend

``` bash
cd ../frontend
npm install
npm run dev
```

Open: http://localhost:5173

## ⚙️ LLM Setup

``` bash
ollama pull llama3.1:8b
```

## 📊 Limitations

-   Works best under 200MB per file
-   Needs good RAM for huge logs

## 🛣️ Future Plans

-   DuckDB/PostgreSQL support
-   Semantic search
-   Docker setup

------------------------------------------------------------------------

⭐ Star the repo if useful!