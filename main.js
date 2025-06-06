const DEBUG = false; // Sätt till true för debugutskrifter

function dlog(...args) {
  if (DEBUG) console.log("[bildvisare]", ...args);
}

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const statusFilePath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "bildvisare",
  "status.json",
);

const originalStatusPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "bildvisare",
  "original_status.json",
);

dlog("DEBUG: process.argv =", process.argv);
let bildFil = process.argv[2] || null;
dlog("DEBUG: bildFil =", bildFil);

let appStartedAt = new Date().toLocaleString("sv-SE");
let appIsRunning = true;
let currentFileInfo = null;
let mainWindow;
let hasOpenedWindow = false;
let pendingOpenFile = null;
let isAppReady = false;

// För slav-/sekundärinstans: skickas med --slave eller env-variabel
const IS_SLAVE =
  process.argv.includes("--slave") || !!process.env.BILDVISARE_SLAVE;
let lastSlaveImagePath = null; // För att undvika att starta om samma slav flera gånger
let slaveProc = null; // Hantera sekundärinstansprocessen

dlog("App startar. CLI-argument:", process.argv, "IS_SLAVE:", IS_SLAVE);

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

// ------ Hantering av slavinstans och övervakning av original_status.json ------

function readSlaveStatusFile() {
  if (!fs.existsSync(originalStatusPath)) return null;
  try {
    const stat = fs.statSync(originalStatusPath);
    const content = fs.readFileSync(originalStatusPath, "utf8");
    const json = JSON.parse(content);
    return {
      ...json,
      fileMTime: stat.mtimeMs,
    };
  } catch (e) {
    dlog("Fel vid läsning av slavstatusfil:", e);
    return null;
  }
}

function launchSlaveViewer(imagePath) {
  dlog("Försöker starta slavvisning för", imagePath);
  if (!imagePath || !fs.existsSync(imagePath)) {
    dlog("Filen finns ej:", imagePath);
    return;
  }
  // Om redan samma, gör inget
  const isProcessAlive = () => {
    try {
      const out = require("child_process")
        .execSync(
          "pgrep -fl 'Bildvisare.*--slave.*" +
            imagePath.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1") +
            "'",
        )
        .toString();
      return out && out.includes(imagePath);
    } catch {
      return false;
    }
  };
  if (lastSlaveImagePath === imagePath && isProcessAlive()) {
    dlog("Slavvisning för denna bild är redan igång:", imagePath);
    return;
  }
  lastSlaveImagePath = imagePath;

  // Starta via open -a Bildvisare "bild"
  dlog("Kör: open -a Bildvisare", imagePath);
  // Vi skickar med --slave så man kan särskilja
  const appBundlePath = path
    .dirname(process.execPath)
    .includes(".app/Contents/MacOS")
    ? path.resolve(process.execPath)
    : "/Applications/Bildvisare.app/Contents/MacOS/Bildvisare";
  spawn(appBundlePath, ["--slave", imagePath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BILDVISARE_SLAVE: "1" },
  }).unref();
}

// Övervaka statusfil för ändring, auto-starta slav om begärt
let mainStartedAt = Date.now();
function watchSlaveStatusFile() {
  let lastKnownMtime = 0;
  let lastKnownExported = null;
  function check() {
    const status = readSlaveStatusFile();
    if (!status) return setTimeout(check, 1500);

    // NYTT: kontrollera att statusfilen är NYARE än huvudinstansen
    if (
      status.fileMTime > mainStartedAt &&
      (status.fileMTime !== lastKnownMtime ||
        status.exported_jpg !== lastKnownExported)
    ) {
      lastKnownMtime = status.fileMTime;
      lastKnownExported = status.exported_jpg;
      dlog("Upptäckt ny/ändrad slavstatusfil:", status.exported_jpg);
      if (status.exported_jpg && fs.existsSync(status.exported_jpg)) {
        launchSlaveViewer(status.exported_jpg);
      }
    }
    setTimeout(check, 1500);
  }
  setTimeout(check, 2000);
}

// Nyckelkommandon: O = öppna slav/sekundär, ESC = stäng slav
function addSlaveKeybinds(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key.toLowerCase() === "o") {
      // Öppna slav om status finns
      const status = readSlaveStatusFile();
      if (status && status.exported_jpg && fs.existsSync(status.exported_jpg)) {
        dlog("Keybind O: öppnar slav:", status.exported_jpg);
        launchSlaveViewer(status.exported_jpg);
      }
    }
    // ESC = stäng alla slavinstanser (från huvudapp, ej slav själv)
    if (!IS_SLAVE && input.type === "keyDown" && input.key === "Escape") {
      dlog("Keybind ESC: försöker stänga slavinstanser via pkill");
      spawn("pkill", ["-f", "--", "Bildvisare.*--slave"], {
        detached: true,
        stdio: "ignore",
      });
    }
    // q = stänger fönster (finns redan)
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      win.close();
    }
  });
}

// ----- Fönster
function createWindow() {
  dlog(
    "createWindow:",
    bildFil ? bildFil : "(ingen bild)",
    "IS_SLAVE:",
    IS_SLAVE,
  );
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: IS_SLAVE ? "Bildvisare (original)" : "Bildvisare",
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
  addSlaveKeybinds(mainWindow);
}

app.whenReady().then(() => {
  isAppReady = true;
  dlog("app.whenReady triggered, IS_SLAVE:", IS_SLAVE);
  if (!IS_SLAVE) {
    // Endast huvudinstans övervakar statusfil för slavvisning
    watchSlaveStatusFile();
  }
  if (pendingOpenFile) {
    bildFil = pendingOpenFile;
    dlog("Kör createWindow() med pendingOpenFile:", bildFil);
    createWindow();
    pendingOpenFile = null;
  } else {
    createWindow();
  }
});
