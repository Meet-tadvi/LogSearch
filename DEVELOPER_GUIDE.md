# Log Vision - Developer Guide

Welcome to the Log Vision development team! This document outlines everything you need to know to set up the project on your machine, test your code, and build the final distributable Windows `.exe` application.

---

## 1. Prerequisites

Before you begin, ensure your computer has the following software installed:
1. **[Node.js](https://nodejs.org/en/)**: Required for the React frontend and Electron.
2. **[Python 3](https://www.python.org/downloads/)**: Required for the FastAPI backend (version 3.10+ recommended).
3. **[Ollama](https://ollama.com/)**: Required for local AI processing and log generation.

---

## 2. Initial Project Setup

When you first receive the source code, you need to install the dependencies for both the frontend and the backend.

### A. Frontend Setup
Open your terminal, navigate into the `frontend` folder, and install the Node modules:

```powershell
cd frontend
npm install
```

### B. Backend Setup
Navigate into the `backend` folder. You must create and activate a Python Virtual Environment before installing dependencies to keep your system clean.

```powershell
cd backend

# Create the virtual environment (only do this once)
py -3.12 -m venv venv

# Activate the virtual environment
.\venv\Scripts\activate

# Install all required Python libraries
pip install -r requirements.txt
```

---

## 3. Development Workflow

There are two ways to run the app during development depending on what you are testing.

### Method 1: Web Browser Development (Fastest)
Use this method when you are designing the React UI or writing backend logic. It allows for instant "Hot-Reloading" whenever you save a file.

**Terminal 1 (Backend):**
```powershell
cd backend
.\venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 (Frontend):**
```powershell
cd frontend
npm run dev
```
*Now open your browser and navigate to `http://localhost:5173` to view the app!*

### Method 2: Electron Desktop Testing
Use this method when you need to test desktop-specific features (like window sizing, right-click context menus, or the production shutdown logic).

```powershell
cd frontend
npm run build
npm start
```
*This will spawn the Python backend automatically in the background and open the Electron desktop window.*

---

## 4. Building the Production Software (.exe)

When you are ready to release a new version of the app to users, you must bundle the entire application into a single Windows installer using our Nuitka pipeline (which prevents Antivirus "false-positives" error).

### Step 1: Compile the Python Backend into C++
This converts the backend into a standalone executable.

```powershell
cd backend
.\venv\Scripts\activate
python -m nuitka --standalone --windows-console-mode=disable --include-data-file="log_formats.json=log_formats.json" main.py
```

### Step 2: Transfer the Compiled Backend
Nuitka will place its compiled files in a folder called `main.dist`. We need to copy these into the frontend directory so Electron can pack them.

```powershell
cd ../frontend
mkdir dist-python\backend -Force
Copy-Item -Recurse -Force "..\backend\main.dist\*" "dist-python\backend\"
```

### Step 3: Build the Installer
Compile the React code one last time and trigger Electron-Builder.

```powershell
# Inside the frontend directory
npm run build
npx electron-builder --win --x64
```

**Success!** The final application installer will be generated at:
`frontend/dist-electron/Log Vision Setup X.X.X.exe`
*(You can send this exact `.exe` file to users!)*

---

## 5. Debugging & Logs

If the packaged production `.exe` crashes or behaves strangely, you can use the following tools to find the bug:

1. **Backend Logs:** All FastAPI terminal output is automatically saved to a text file on the user's computer. You can view it by opening File Explorer and going to:
   `%APPDATA%\log-Vision-frontend\backend.log`
2. **Frontend Console:** While the Electron desktop app is open, you can press `Ctrl + Shift + I` at any time to open the hidden Developer Tools panel to inspect Network requests and UI errors.
