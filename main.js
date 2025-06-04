const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const bildFil = process.argv[2];
  if (!bildFil) {
    console.error("Ange en bildfil som argument!");
    app.quit();
    return;
  }
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: true, // <-- Alltid överst!
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.setMenu(null); // <-- Ingen meny!
  win.loadFile("index.html", { query: { bild: bildFil } });

  // Q stänger fönstret
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      win.close();
    }
  });
}

app.whenReady().then(createWindow);
