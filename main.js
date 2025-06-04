const { app, BrowserWindow } = require("electron");
const path = require("path");

let bildFil = process.argv[2]; // fallback för CLI-start
let mainWindow;

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  bildFil = filePath;
  if (mainWindow) {
    // Om fönstret redan är öppet, ladda om med nya bilden
    mainWindow.loadFile("index.html", { query: { bild: bildFil } });
  } else {
    // Annars öppnas bilden i createWindow
  }
});

function createWindow() {
  if (!bildFil) {
    console.error("Ange en bildfil som argument eller dra en bild till appen!");
    app.quit();
    return;
  }
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
  mainWindow.loadFile("index.html", { query: { bild: bildFil } });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      mainWindow.close();
    }
  });
}

app.whenReady().then(createWindow);
