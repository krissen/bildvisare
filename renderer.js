const fs = require("fs");

function getBildPath() {
  const params = new URLSearchParams(window.location.search);
  return params.get("bild");
}

const bildPath = getBildPath();
let lastMtime = 0;

let zoomMode = "auto"; // "auto" eller "manual"
let zoomFactor = 1; // Gäller bara om manual
let naturalWidth = 0;
let naturalHeight = 0;

// Skapa bild och event handlers
const img = document.getElementById("bild");

// Anpassa bildstorlek efter fönster eller zoom
function updateImageDisplay() {
  if (zoomMode === "auto") {
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
  } else {
    img.style.width = naturalWidth * zoomFactor + "px";
    img.style.height = naturalHeight * zoomFactor + "px";
    img.style.objectFit = "unset";
  }
}

// När bilden laddas, spara naturlig storlek
img.onload = function () {
  naturalWidth = img.naturalWidth;
  naturalHeight = img.naturalHeight;
  updateImageDisplay();
};

// Lyssna på fönsterstorleksändring
window.addEventListener("resize", () => {
  if (zoomMode === "auto") updateImageDisplay();
});

// Tangentbordsgenvägar
window.addEventListener("keydown", (event) => {
  if (event.key === "+") {
    zoomMode = "manual";
    zoomFactor *= 1.1;
    updateImageDisplay();
  } else if (event.key === "-") {
    zoomMode = "manual";
    zoomFactor /= 1.1;
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

// Bildomladdning (och auto-uppdatering)
function reloadIfChanged() {
  fs.stat(bildPath, (err, stats) => {
    if (!err && stats.mtimeMs !== lastMtime) {
      lastMtime = stats.mtimeMs;
      const prevMode = zoomMode;
      const prevFactor = zoomFactor;
      img.onload = function () {
        naturalWidth = img.naturalWidth;
        naturalHeight = img.naturalHeight;
        // Behåll zoomläge, men autozoom måste aktiveras igen av användaren
        if (prevMode === "manual") {
          zoomMode = "manual";
          zoomFactor = prevFactor;
        } else {
          // För autozoom: återgå till auto bara om användaren trycker 'a'
        }
        updateImageDisplay();
      };
      img.src = bildPath + "?t=" + Date.now();
    }
  });
  setTimeout(reloadIfChanged, 1000);
}
reloadIfChanged();

// Start med autozoom
zoomMode = "auto";
updateImageDisplay();
