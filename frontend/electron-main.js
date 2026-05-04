import { app, BrowserWindow, globalShortcut } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import http from 'http';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let pythonProcess;

// Default port, or pass via command line to Python
const PORT = 8000;

function startPythonBackend() {
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    // In production, the python .exe will be inside resources/backend
    const backendPath = path.join(process.resourcesPath, 'backend', 'main.exe');
    pythonProcess = spawn(backendPath, [PORT.toString()]);
  } else {
    // In development, run python directly using the venv
    const backendPath = path.join(__dirname, '..', 'backend', 'main.py');
    const isWin = process.platform === 'win32';
    const pythonExe = path.join(__dirname, '..', 'backend', 'venv', isWin ? 'Scripts' : 'bin', 'python');
    
    pythonProcess = spawn(pythonExe, [backendPath, PORT.toString()]);
  }

  const logPath = path.join(app.getPath('userData'), 'backend.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  
  logStream.write(`\n--- Application Started at ${new Date().toISOString()} ---\n`);

  pythonProcess.stdout.on('data', (data) => {
    const msg = data.toString();
    console.log(`Backend: ${msg}`);
    logStream.write(`[OUT] ${msg}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    console.error(`Backend Error: ${msg}`);
    logStream.write(`[ERR] ${msg}`);
  });
}

function waitForServer(callback) {
  const checkServer = () => {
    http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
      if (res.statusCode === 200) {
        callback();
      } else {
        setTimeout(checkServer, 500);
      }
    }).on('error', () => {
      setTimeout(checkServer, 500);
    });
  };
  checkServer();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: "Log Vision",
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Hide the default electron menu bar
  mainWindow.setMenuBarVisibility(false);

  // Wait for the FastAPI server to be fully ready before showing the page
  waitForServer(() => {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  // Enable Ctrl+Shift+I to open developer tools for debugging the React interface
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

app.on('ready', () => {
  startPythonBackend();
  createWindow();
});

// When all windows are closed, we must safely shut down the Python backend
app.on('window-all-closed', function () {
  console.log('Sending shutdown signal to backend...');
  
  const req = http.request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/shutdown',
    method: 'POST'
  }, (res) => {
    app.quit();
  });
  
  req.on('error', (e) => {
    console.error(`Failed to shutdown gracefully: ${e.message}`);
    // Force quit anyway
    app.quit();
  });
  
  req.end();
});

app.on('quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});
