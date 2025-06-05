const DEBUG = false; // Sätt till false för att tysta loggarna

function dlog(...args) {
  if (DEBUG) console.log("[bildvisare]", ...args);
}

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const statusFilePath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "bildvisare",
  "status.json",
);

let bildFil = process.argv[2] || null;
let appStartedAt = new Date().toLocaleString("sv-SE");
let appIsRunning = true;
let currentFileInfo = null;
let mainWindow;
let hasOpenedWindow = false;
let pendingOpenFile = null;
let isAppReady = false;

dlog("App startar. CLI-argument:", process.argv);

function writeStatus(data = {}) {
  const dir = path.dirname(statusFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    statusFilePath,
    JSON.stringify(
      {
        app_status: appIsRunning ? "running" : "exited",
        app_started: appStartedAt,
        ...currentFileInfo,
        ...data,
      },
      null,
      2,
    ),
  );
}

app.on("open-file", (event, filePath) => {
  dlog("open-file-event:", filePath);
  event.preventDefault();
  bildFil = filePath;
  updateFileStatus(bildFil);

  if (!isAppReady) {
    dlog("open-file: app not ready, queueing for later");
    pendingOpenFile = filePath;
    return;
  }

  if (!hasOpenedWindow) {
    dlog("open-file: Skapar nytt fönster");
    createWindow();
  } else if (mainWindow) {
    dlog("open-file: laddar om fönster med bild:", bildFil);
    mainWindow.loadFile("index.html", { query: { bild: bildFil } });
  }
});
writeStatus();

app.on("will-quit", () => {
  appIsRunning = false;
  dlog("Appen stängs (will-quit)");
  writeStatus();
});

function updateFileStatus(filePath) {
  dlog("updateFileStatus:", filePath);
  currentFileInfo = {
    file_opened: new Date().toLocaleString("sv-SE"),
    file_path: path.resolve(filePath),
    file_updated: new Date().toLocaleString("sv-SE"),
  };
  writeStatus();
}

function updateFileViewed() {
  if (!currentFileInfo) return;
  dlog("updateFileViewed");
  currentFileInfo.file_updated = new Date().toLocaleString("sv-SE");
  writeStatus();
}

// ----- IPC från renderer
ipcMain.on("bild-visad", () => {
  dlog("IPC: bild-visad från renderer");
  updateFileViewed();
});

// ----- Fönster
function createWindow() {
  dlog("createWindow:", bildFil ? bildFil : "(ingen bild)");
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.setMenu(null);
  hasOpenedWindow = true;
  if (bildFil) {
    updateFileStatus(bildFil);
    dlog("Fönster laddas med bild:", bildFil);
    mainWindow.loadFile("index.html", { query: { bild: bildFil } });
  } else {
    dlog("Fönster laddas utan bild");
    mainWindow.loadFile("index.html");
  }
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      mainWindow.close();
    }
  });
}

// I app.whenReady:
app.whenReady().then(() => {
  isAppReady = true;
  dlog("app.whenReady triggered");
  if (pendingOpenFile) {
    bildFil = pendingOpenFile;
    dlog("Kör createWindow() med pendingOpenFile:", bildFil);
    createWindow();
    pendingOpenFile = null;
  } else {
    createWindow();
  }
});
