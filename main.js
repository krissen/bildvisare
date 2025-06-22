// main.js

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

function convertNEFtoJPG(nefPath, outJpg, cb) {
  // Kolla om JPG redan finns och är nyare än NEF
  if (fs.existsSync(outJpg)) {
    const nefTime = fs.statSync(nefPath).mtimeMs;
    const jpgTime = fs.statSync(outJpg).mtimeMs;
    if (jpgTime > nefTime) {
      return cb(null, outJpg); // Already exists, return file path!
    }
  }
  // Starta konvertering
  const pythonPath = "/Users/krisniem/miniforge3/envs/faceid/bin/python3";
  const scriptPath = "/Users/krisniem/dev/hitta_ansikten/nef2jpg.py";

  const child = spawn(pythonPath, [scriptPath, nefPath, outJpg], {
    stdio: "ignore",
  });

  child.on("exit", (code) => {
    if (code === 0) {
      cb(null, outJpg); // Success: return output file!
    } else {
      cb(new Error("Konverteringen misslyckades"), null);
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
    dlog("Ingen source_nef i status.json!");
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
  dlog("Konverterar NEF till JPG:", nef, "→", jpg);
  convertNEFtoJPG(nef, jpg, (err, outJpg) => {
    if (err || !outJpg) {
      hideWaitOverlay();
      dlog("Kunde inte konvertera NEF:", err);
      if (mainWindow)
        mainWindow.webContents.send("show-wait-overlay", "Fel vid export!");
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
          dlog("JPG-fil blev aldrig klar att öppnas.");
          if (mainWindow)
            mainWindow.webContents.send(
              "show-wait-overlay",
              "Fel: kunde inte öppna exporten!",
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

// Synkronisera vyer mellan master och slav
ipcMain.on("sync-view", (event, data) => {
  // Skicka vidare till andra fönstret
  if (event.sender === mainWindow?.webContents && slaveWindow) {
    slaveWindow.webContents.send("apply-view", data);
  } else if (event.sender === slaveWindow?.webContents && mainWindow) {
    mainWindow.webContents.send("apply-view", data);
  }
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

// Nyckelkommandon: O = öppna slav/sekundär, ESC = stäng slav och eget fönster
function addSlaveKeybinds(win, isSlave) {
  win.webContents.on("before-input-event", (event, input) => {
    // O = öppna slav original (med NEF->JPG-konvertering vid behov)
    if (input.type === "keyDown" && input.key.toLowerCase() === "o") {
      const status = readSlaveStatusFile();
      if (status && status.source_nef) {
        ensureJPGAndLaunchSlave(status);
      } else if (
        status &&
        status.exported_jpg &&
        fs.existsSync(status.exported_jpg)
      ) {
        // fallback för legacy status
        launchSlaveViewer(status.exported_jpg);
      }
    }

    // ESC = stäng slavinstanser och stäng nuvarande fönster (både huvud och slav)
    if (input.type === "keyDown" && input.key === "Escape") {
      dlog("Keybind ESC: försöker stänga slavinstanser via pkill");
      spawn("pkill", ["-f", "--", "Bildvisare.*--slave"], {
        detached: true,
        stdio: "ignore",
      });
      win.close(); // Stäng även nuvarande fönster (huvud eller slav)
    }
    // q = stänger fönster (finns redan)
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      win.close();
    }
  });
}

// ----- Fönster -----
function createMasterWindow() {
  dlog("createMasterWindow:", bildFil ? bildFil : "(ingen bild)");
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
    dlog("Fönster laddas med bild:", resolvedBildFil);
    mainWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(resolvedBildFil), slave: "0" },
    });
  } else {
    dlog("Fönster laddas utan bild");
    mainWindow.loadFile("index.html", { query: { bild: "", slave: "0" } });
  }
  addSlaveKeybinds(mainWindow, false);
}

function createSlaveWindow(slaveBildPath) {
  dlog("createSlaveWindow:", slaveBildPath ? slaveBildPath : "(ingen bild)");
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
    dlog("Slavfönster laddas med bild:", resolvedBildFil);
    slaveWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(resolvedBildFil), slave: "1" },
    });
  } else {
    dlog("Slavfönster laddas utan bild");
    slaveWindow.loadFile("index.html", { query: { bild: "", slave: "1" } });
  }
  addSlaveKeybinds(slaveWindow, true);

  slaveWindow.on("closed", () => {
    slaveWindow = null;
  });
}

// Anpassa så slavfönster skapas direkt om IS_SLAVE
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
