// main.js

const DEBUG = false; // Set to true for debug output

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

function convertNEFtoJPG(nefPath, outJpg, cb) {
  // Check if JPG already exists and is newer than NEF
  if (fs.existsSync(outJpg)) {
    const nefTime = fs.statSync(nefPath).mtimeMs;
    const jpgTime = fs.statSync(outJpg).mtimeMs;
    if (jpgTime > nefTime) {
      return cb(null, outJpg); // Already exists, return file path!
    }
  }
  // Start conversion
  const pythonPath = "/Users/krisniem/.local/share/miniforge3/envs/hitta_ansikten/bin/python3";
  const scriptPath = path.join(__dirname, "nef2jpg.py");

  const child = spawn(pythonPath, [scriptPath, nefPath, outJpg], {
    stdio: "ignore",
  });

  child.on("exit", (code) => {
    if (code === 0) {
      cb(null, outJpg); // Success: return output file!
    } else {
      cb(new Error("Conversion failed"), null);
    }
  });
}

function showWaitOverlay() {
  if (mainWindow) mainWindow.webContents.send("show-wait-overlay");
}
function hideWaitOverlay() {
  if (mainWindow) mainWindow.webContents.send("hide-wait-overlay");
}

function ensureJPGAndLaunchSlave(status) {
  let nef = status.source_nef;
  let jpg = status.exported_jpg;
  if (!nef) {
    dlog("No source_nef in status.json!");
    return;
  }
  if (!jpg) {
    const nefBase = path.basename(nef, path.extname(nef));
    jpg = `/tmp/${nefBase}_converted.jpg`;
  }
  if (
    fs.existsSync(jpg) &&
    fs.statSync(jpg).mtimeMs > fs.statSync(nef).mtimeMs
  ) {
    launchSlaveViewer(jpg);
    return;
  }
  showWaitOverlay();
  dlog("Converting NEF to JPG:", nef, "→", jpg);
  convertNEFtoJPG(nef, jpg, (err, outJpg) => {
    if (err || !outJpg) {
      hideWaitOverlay();
      dlog("Could not convert NEF:", err);
      if (mainWindow)
        mainWindow.webContents.send("show-wait-overlay", "Error during export!");
      return;
    }
    function waitForJPGReady(retries = 0) {
      fs.stat(outJpg, (err, stats) => {
        if (!err && stats.size > 50 * 1024) {
          hideWaitOverlay();
          launchSlaveViewer(outJpg);
        } else if (retries < 20) {
          setTimeout(() => waitForJPGReady(retries + 1), 100);
        } else {
          hideWaitOverlay();
          dlog("JPG file never became ready to open.");
          if (mainWindow)
            mainWindow.webContents.send(
              "show-wait-overlay",
              "Error: could not open export!",
            );
        }
      });
    }
    waitForJPGReady();
  });
}

dlog("DEBUG: process.argv =", process.argv);
let bildFil = process.argv[2] || null;
dlog("DEBUG: bildFil =", bildFil);

let appStartedAt = new Date().toLocaleString("sv-SE");
let appIsRunning = true;
let currentFileInfo = null;
let mainWindow = null;
let slaveWindow = null;
let hasOpenedWindow = false;
let pendingOpenFile = null;
let isAppReady = false;

// For slave/secondary instance: passed with --slave or env variable
const IS_SLAVE =
  process.argv.includes("--slave") || !!process.env.BILDVISARE_SLAVE;
let lastSlaveImagePath = null; // To avoid restarting the same slave multiple times
let slaveProc = null; // Handle secondary instance process

dlog("App starting. CLI arguments:", process.argv, "IS_SLAVE:", IS_SLAVE);

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
    createMasterWindow();
  } else if (mainWindow) {
    dlog("open-file: laddar om fönster med bild:", bildFil);
    mainWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(path.resolve(bildFil)), slave: "0" },
    });
  }
});
writeStatus();

app.on("will-quit", () => {
  appIsRunning = false;
  dlog("App closing (will-quit)");
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

// ----- IPC from renderer
ipcMain.on("bild-visad", () => {
  dlog("IPC: bild-visad from renderer");
  updateFileViewed();
});

// Synchronize views between master and slave
ipcMain.on("sync-view", (event, data) => {
  // Forward to other window
  if (event.sender === mainWindow?.webContents && slaveWindow) {
    slaveWindow.webContents.send("apply-view", data);
  } else if (event.sender === slaveWindow?.webContents && mainWindow) {
    mainWindow.webContents.send("apply-view", data);
  }
});

// ------ Slave instance handling and original_status.json monitoring ------

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
    dlog("Error reading slave status file:", e);
    return null;
  }
}

function launchSlaveViewer(imagePath) {
  dlog("Attempting to start slave viewer for", imagePath);
  if (!imagePath || !fs.existsSync(imagePath)) {
    dlog("File does not exist:", imagePath);
    return;
  }
  // If already the same, do nothing
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
    dlog("Slave viewer for this image is already running:", imagePath);
    return;
  }
  lastSlaveImagePath = imagePath;

  // Start via open -a Bildvisare "image"
  dlog("Running: open -a Bildvisare", imagePath);
  // We pass --slave to distinguish
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

// Monitor status file for changes, auto-start slave if requested
let mainStartedAt = Date.now();
function watchSlaveStatusFile() {
  let lastKnownMtime = 0;
  let lastKnownExported = null;
  function check() {
    const status = readSlaveStatusFile();
    if (!status) return setTimeout(check, 1500);

    // NEW: check that status file is NEWER than main instance
    if (
      status.fileMTime > mainStartedAt &&
      (status.fileMTime !== lastKnownMtime ||
        status.exported_jpg !== lastKnownExported)
    ) {
      lastKnownMtime = status.fileMTime;
      lastKnownExported = status.exported_jpg;
      dlog("Detected new/changed slave status file:", status.exported_jpg);
      if (status.exported_jpg && fs.existsSync(status.exported_jpg)) {
        launchSlaveViewer(status.exported_jpg);
      }
    }
    setTimeout(check, 1500);
  }
  setTimeout(check, 2000);
}

// Key commands: O = open slave/secondary, ESC = close slave and own window
function addSlaveKeybinds(win, isSlave) {
  win.webContents.on("before-input-event", (event, input) => {
    // O = open slave original (with NEF->JPG conversion if needed)
    if (input.type === "keyDown" && input.key.toLowerCase() === "o") {
      const status = readSlaveStatusFile();
      if (status && status.source_nef) {
        ensureJPGAndLaunchSlave(status);
      } else if (
        status &&
        status.exported_jpg &&
        fs.existsSync(status.exported_jpg)
      ) {
        // fallback for legacy status
        launchSlaveViewer(status.exported_jpg);
      }
    }

    // ESC = close slave instances and close current window (both main and slave)
    if (input.type === "keyDown" && input.key === "Escape") {
      dlog("Keybind ESC: attempting to close slave instances via pkill");
      spawn("pkill", ["-f", "--", "Bildvisare.*--slave"], {
        detached: true,
        stdio: "ignore",
      });
      win.close(); // Also close current window (main or slave)
    }
    // q = closes window (already exists)
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      win.close();
    }
  });
}

// ----- Windows -----
function createMasterWindow() {
  dlog("createMasterWindow:", bildFil ? bildFil : "(no image)");
  if (mainWindow) {
    try {
      mainWindow.destroy();
    } catch {}
    mainWindow = null;
  }
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "Bildvisare",
  });
  mainWindow.setMenu(null);

  hasOpenedWindow = true;
  const resolvedBildFil = bildFil ? path.resolve(bildFil) : null;
  if (resolvedBildFil) {
    updateFileStatus(resolvedBildFil);
    dlog("Window loading with image:", resolvedBildFil);
    mainWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(resolvedBildFil), slave: "0" },
    });
  } else {
    dlog("Window loading without image:");
    mainWindow.loadFile("index.html", { query: { bild: "", slave: "0" } });
  }
  addSlaveKeybinds(mainWindow, false);
}

function createSlaveWindow(slaveBildPath) {
  dlog("createSlaveWindow:", slaveBildPath ? slaveBildPath : "(no image)");
  if (slaveWindow) {
    try {
      slaveWindow.destroy();
    } catch {}
    slaveWindow = null;
  }
  slaveWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "Bildvisare (original)",
  });
  slaveWindow.setMenu(null);

  const resolvedBildFil = slaveBildPath ? path.resolve(slaveBildPath) : null;
  if (resolvedBildFil) {
    dlog("Slave window loading with image:", resolvedBildFil);
    slaveWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(resolvedBildFil), slave: "1" },
    });
  } else {
    dlog("Slave window loading without image:");
    slaveWindow.loadFile("index.html", { query: { bild: "", slave: "1" } });
  }
  addSlaveKeybinds(slaveWindow, true);

  slaveWindow.on("closed", () => {
    slaveWindow = null;
  });
}

// Adapt so slave window is created directly if IS_SLAVE
function createWindow() {
  if (IS_SLAVE) {
    createSlaveWindow(bildFil);
  } else {
    createMasterWindow();
  }
}

app.whenReady().then(() => {
  isAppReady = true;
  dlog("app.whenReady triggered, IS_SLAVE:", IS_SLAVE);
  if (!IS_SLAVE) {
    // Only main instance monitors status file for slave viewing
    watchSlaveStatusFile();
  }
  if (pendingOpenFile) {
    bildFil = pendingOpenFile;
    dlog("Running createWindow() with pendingOpenFile:", bildFil);
    createWindow();
    pendingOpenFile = null;
  } else {
    createWindow();
  }
});
