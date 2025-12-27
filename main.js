// main.js

const DEBUG = false; // Set to true for debug output

function dlog(...args) {
  if (DEBUG) console.log("[bildvisare]", ...args);
}

// Configuration constants
const MIN_JPG_SIZE = 50 * 1024; // 50KB minimum for converted JPG
const JPG_READY_CHECK_INTERVAL_MS = 100; // Check every 100ms if JPG is ready
const JPG_READY_MAX_RETRIES = 20; // Max 20 retries (2 seconds total)
const STATUS_FILE_POLL_INTERVAL_MS = 1500; // Poll status file every 1.5s
const STATUS_FILE_INITIAL_DELAY_MS = 2000; // Initial delay before polling

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, exec } = require("child_process");

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

// Input validation: ensure file paths are safe
function isValidImagePath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;

  try {
    const resolved = path.resolve(filePath);
    const home = os.homedir();

    // Only allow paths under user's home directory or /tmp
    const isUnderHome = resolved.startsWith(home);
    const isUnderTmp = resolved.startsWith("/tmp") || resolved.startsWith("/private/tmp");

    if (!isUnderHome && !isUnderTmp) {
      dlog("SECURITY: Rejected path outside allowed directories:", resolved);
      return false;
    }

    // Check file extension - only allow image formats
    const ext = path.extname(resolved).toLowerCase();
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".nef", ".cr2", ".arw"];
    if (!allowedExtensions.includes(ext)) {
      dlog("SECURITY: Rejected invalid file extension:", ext);
      return false;
    }

    return true;
  } catch (e) {
    dlog("SECURITY: Path validation error:", e);
    return false;
  }
}

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
  const scriptPath = path.join(__dirname, "scripts", "nef2jpg.py");

  // ERROR HANDLING: Check if conversion script exists
  if (!fs.existsSync(scriptPath)) {
    dlog("ERROR: Conversion script not found:", scriptPath);
    return cb(new Error("Conversion script not found: " + scriptPath), null);
  }

  // ERROR HANDLING: Check if Python interpreter exists
  if (!fs.existsSync(pythonPath)) {
    dlog("ERROR: Python interpreter not found:", pythonPath);
    return cb(new Error("Python interpreter not found: " + pythonPath), null);
  }

  const child = spawn(pythonPath, [scriptPath, nefPath, outJpg], {
    stdio: "ignore",
  });

  // ERROR HANDLING: Handle spawn errors
  child.on("error", (err) => {
    dlog("ERROR: Failed to spawn conversion process:", err);
    cb(new Error("Failed to start conversion: " + err.message), null);
  });

  child.on("exit", (code) => {
    if (code === 0) {
      cb(null, outJpg); // Success: return output file!
    } else {
      dlog("ERROR: Conversion failed with exit code:", code);
      cb(new Error("Conversion failed with exit code " + code), null);
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
        if (!err && stats.size > MIN_JPG_SIZE) {
          hideWaitOverlay();
          launchSlaveViewer(outJpg);
        } else if (retries < JPG_READY_MAX_RETRIES) {
          setTimeout(() => waitForJPGReady(retries + 1), JPG_READY_CHECK_INTERVAL_MS);
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
// SECURITY: Validate initial bildFil path
if (bildFil && !isValidImagePath(bildFil)) {
  dlog("SECURITY: Invalid initial bildFil path, ignoring:", bildFil);
  bildFil = null;
}
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
  try {
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
  } catch (err) {
    // Don't crash app if status file can't be written
    dlog("WARNING: Failed to write status file:", err.message);
  }
}

app.on("open-file", (event, filePath) => {
  dlog("open-file-event:", filePath);
  event.preventDefault();

  // SECURITY: Validate file path from open-file event
  if (!isValidImagePath(filePath)) {
    dlog("SECURITY: Invalid file path from open-file event:", filePath);
    return;
  }

  bildFil = filePath;
  updateFileStatus(bildFil);

  if (!isAppReady) {
    dlog("open-file: app not ready, queueing for later");
    pendingOpenFile = filePath;
    return;
  }

  if (!hasOpenedWindow) {
    dlog("open-file: Creating new window");
    createMasterWindow();
  } else if (mainWindow) {
    dlog("open-file: Reloading window with image:", bildFil);
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

// SECURITY: Safe file stat checking for renderer (no direct fs access)
ipcMain.handle("check-file-changed", async (event, filePath) => {
  // Validate file path first
  if (!isValidImagePath(filePath)) {
    dlog("SECURITY: Rejected file stat request for invalid path:", filePath);
    return { error: "Invalid file path", mtimeMs: 0 };
  }

  try {
    const stats = await fs.promises.stat(filePath);
    return { mtimeMs: stats.mtimeMs };
  } catch (err) {
    return { error: err.message, mtimeMs: 0 };
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
  // SECURITY FIX: Use safe process checking instead of shell command injection
  const isProcessAlive = () => {
    try {
      // Use ps to list all processes, parse output in JavaScript (no shell injection)
      const { execSync } = require("child_process");
      const psOutput = execSync("ps -eo args", { encoding: "utf8" });
      const lines = psOutput.split("\n");

      // Check if any process matches Bildvisare + --slave + this image path
      return lines.some((line) => {
        return (
          line.includes("Bildvisare") &&
          line.includes("--slave") &&
          line.includes(imagePath)
        );
      });
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

  // ERROR HANDLING: Spawn slave viewer with error handling
  const slaveProcess = spawn(appBundlePath, ["--slave", imagePath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BILDVISARE_SLAVE: "1" },
  });

  slaveProcess.on("error", (err) => {
    dlog("ERROR: Failed to spawn slave viewer:", err.message);
  });

  slaveProcess.unref();
}

// Monitor status file for changes, auto-start slave if requested
let mainStartedAt = Date.now();
function watchSlaveStatusFile() {
  let lastKnownMtime = 0;
  let lastKnownExported = null;
  function check() {
    const status = readSlaveStatusFile();
    if (!status) return setTimeout(check, STATUS_FILE_POLL_INTERVAL_MS);

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
    setTimeout(check, STATUS_FILE_POLL_INTERVAL_MS);
  }
  setTimeout(check, STATUS_FILE_INITIAL_DELAY_MS);
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
      // SECURITY FIX: Enable proper isolation
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
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
      // SECURITY FIX: Enable proper isolation
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
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
