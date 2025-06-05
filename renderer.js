const DEBUG = false;
function dlog(...args) {
  if (DEBUG) console.log("[bildvisare:renderer]", ...args);
}

const { ipcRenderer } = require("electron");
const fs = require("fs");

function getBildPath() {
  const params = new URLSearchParams(window.location.search);
  return params.get("bild");
}

const bildPath = getBildPath();
let lastMtime = 0;

dlog("Startar renderer. bildPath:", bildPath);

if (!bildPath) {
  dlog("Ingen bild – visar fallback-meddelande");
  document.body.innerHTML =
    "<div style='text-align:center; color: #888; font-size:22px; margin-top:30vh;'>Ingen bild vald.<br>Dra en bild hit eller öppna med Bildvisare.</div>";
} else {
  dlog("Laddar bild:", bildPath);

  let zoomMode = "auto";
  let zoomFactor = 1;
  let naturalWidth = 0;
  let naturalHeight = 0;
  const img = document.getElementById("bild");

  function getFitZoomFactor() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (naturalWidth === 0 || naturalHeight === 0) return 1;
    return Math.min(winW / naturalWidth, winH / naturalHeight);
  }

  function updateImageDisplay() {
    if (zoomMode === "auto") {
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
    } else {
      img.style.width = `${naturalWidth * zoomFactor}px`;
      img.style.height = `${naturalHeight * zoomFactor}px`;
      img.style.objectFit = "unset";
    }
  }

  img.onload = function () {
    dlog("img.onload fired, storlek:", img.naturalWidth, img.naturalHeight);
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
    updateImageDisplay();
    if (ipcRenderer) ipcRenderer.send("bild-visad");
  };

  window.addEventListener("resize", () => {
    if (zoomMode === "auto") updateImageDisplay();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "+") {
      if (zoomMode === "auto") {
        zoomFactor = getFitZoomFactor();
        zoomMode = "manual";
      }
      zoomFactor = Math.min(zoomFactor * 1.1, 10);
      updateImageDisplay();
    } else if (event.key === "-") {
      if (zoomMode === "auto") {
        zoomFactor = getFitZoomFactor();
        zoomMode = "manual";
      }
      zoomFactor = Math.max(zoomFactor / 1.1, 0.1);
      updateImageDisplay();
    } else if (event.key === "=") {
      zoomMode = "manual";
      zoomFactor = 1;
      updateImageDisplay();
    } else if (event.key.toLowerCase() === "a") {
      zoomMode = "auto";
      updateImageDisplay();
    }
  });

  function reloadIfChanged() {
    fs.stat(bildPath, (err, stats) => {
      if (!err && stats.mtimeMs !== lastMtime) {
        dlog("Bildfil uppdaterad, laddar om.");
        lastMtime = stats.mtimeMs;
        const prevMode = zoomMode;
        const prevFactor = zoomFactor;
        img.onload = function () {
          dlog(
            "img.onload efter reload, storlek:",
            img.naturalWidth,
            img.naturalHeight,
          );
          naturalWidth = img.naturalWidth;
          naturalHeight = img.naturalHeight;
          if (prevMode === "manual") {
            zoomMode = "manual";
            zoomFactor = prevFactor;
          } else {
            zoomMode = "auto";
          }
          updateImageDisplay();
          if (ipcRenderer) ipcRenderer.send("bild-visad");
        };
        img.src = bildPath + "?t=" + Date.now();
      }
    });
    setTimeout(reloadIfChanged, 1000);
  }
  reloadIfChanged();

  zoomMode = "auto";
  zoomFactor = 1;
  updateImageDisplay();
}
