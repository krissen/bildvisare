const DEBUG = true;
function dlog(...args) {
  if (DEBUG) console.log("[bildvisare:renderer]", ...args);
}
dlog("Renderer körs. window.location.search:", window.location.search);

const { ipcRenderer } = require("electron");
const fs = require("fs");
const container = document.getElementById("bild-container");
const img = document.getElementById("bild");
const fallback = document.getElementById("fallback-message");

let zoomMode = "auto";
let zoomFactor = 1;
let zoomingIn = false;
let zoomingOut = false;
let zoomTimer = null;
let naturalWidth = 0;
let naturalHeight = 0;
let lastCursorInImg = false;
let lastCursorPos = { x: 0, y: 0 };
let lastMouseClientX = 0;
let lastMouseClientY = 0;

function getBildPath() {
  const params = new URLSearchParams(window.location.search);
  const val = params.get("bild");
  // Avkoda om det är encoded
  return val ? decodeURIComponent(val) : null;
}

function getImageCenter() {
  return {
    x: img.naturalWidth ? img.naturalWidth / 2 : 0,
    y: img.naturalHeight ? img.naturalHeight / 2 : 0,
  };
}

function doZoom(dir) {
  let center =
    zoomMode !== "auto" && lastCursorInImg ? lastCursorPos : getImageCenter();

  if (zoomMode === "auto") {
    zoomFactor = getFitZoomFactor();
    zoomMode = "manual";
  }
  if (dir === "in") {
    zoomFactor = Math.min(zoomFactor * 1.07, 10);
  } else {
    zoomFactor = Math.max(zoomFactor / 1.07, 0.1);
  }
  updateImageDisplay(center, true);
}

function isZoomInKey(event) {
  return event.key === "+";
}

function isZoomOutKey(event) {
  return event.key === "-";
}

const bildPath = getBildPath();
let lastMtime = 0;

dlog("window.location.search:", window.location.search);
dlog("getBildPath():", getBildPath());
dlog("Startar renderer. bildPath:", bildPath);

if (!bildPath) {
  dlog("Ingen bild – visar fallback-meddelande");
  img.style.display = "none";
  fallback.style.display = "block";
} else {
  img.style.display = "block";
  fallback.style.display = "none";

  dlog("Laddar bild:", bildPath);

  img.src = bildPath;

  function getFitZoomFactor() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (naturalWidth === 0 || naturalHeight === 0) return 1;
    return Math.min(winW / naturalWidth, winH / naturalHeight);
  }

  function updateImageDisplay(center = null, keepPointInView = false) {
    if (zoomMode === "auto") {
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.style.transform = "";
      img.style.transformOrigin = "";
    } else {
      img.style.objectFit = "unset";
      img.style.transform = "";
      img.style.transformOrigin = "";
      img.style.width = naturalWidth * zoomFactor + "px";
      img.style.height = naturalHeight * zoomFactor + "px";
      if (!center) center = getImageCenter();
      if (keepPointInView) {
        const imgPoint = center;
        const containerRect = container.getBoundingClientRect();
        const screenPoint = lastCursorInImg
          ? {
              x: lastMouseClientX - containerRect.left,
              y: lastMouseClientY - containerRect.top,
            }
          : {
              x: container.clientWidth / 2,
              y: container.clientHeight / 2,
            };
        requestAnimationFrame(() => {
          container.scrollLeft = imgPoint.x * zoomFactor - screenPoint.x;
          container.scrollTop = imgPoint.y * zoomFactor - screenPoint.y;
        });
      }
    }
  }

  let lastMouseClientX = 0,
    lastMouseClientY = 0;

  img.addEventListener("mousemove", (e) => {
    const rect = img.getBoundingClientRect();
    // Bara om musen är inom bildytan
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      lastCursorInImg = true;
      // Bildkoordinater
      lastCursorPos = {
        x: ((e.clientX - rect.left) / rect.width) * img.naturalWidth,
        y: ((e.clientY - rect.top) / rect.height) * img.naturalHeight,
      };
    } else {
      lastCursorInImg = false;
    }
    lastMouseClientX = e.clientX;
    lastMouseClientY = e.clientY;
  });
  img.addEventListener("mouseleave", () => {
    lastCursorInImg = false;
  });
  img.addEventListener("mouseenter", () => {
    lastCursorInImg = true;
  });

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
    dlog(
      "KEY:",
      event.key,
      "shift?",
      event.shiftKey,
      "code:",
      event.code,
      "keyCode:",
      event.keyCode,
    );

    if (isZoomInKey(event)) {
      if (!zoomingIn) {
        zoomingIn = true;
        if (zoomTimer) clearInterval(zoomTimer);
        zoomTimer = setInterval(() => {
          doZoom("in");
        }, 120);
      }
      doZoom("in");
      event.preventDefault();
    } else if (isZoomOutKey(event)) {
      if (!zoomingOut) {
        zoomingOut = true;
        if (zoomTimer) clearInterval(zoomTimer);
        zoomTimer = setInterval(() => {
          doZoom("out");
        }, 120);
      }
      doZoom("out");
      event.preventDefault();
    } else if (event.key === "=") {
      zoomingIn = false;
      zoomingOut = false;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = null;
      zoomMode = "manual";
      zoomFactor = 1;
      updateImageDisplay(
        zoomMode !== "auto" && lastCursorInImg
          ? lastCursorPos
          : getImageCenter(),
        true,
      );
      event.preventDefault();
    } else if (event.key.toLowerCase() === "a") {
      zoomMode = "auto";
      updateImageDisplay();
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (isZoomInKey(event)) {
      zoomingIn = false;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = null;
    }
    if (isZoomOutKey(event)) {
      zoomingOut = false;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = null;
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
          zoomMode = "auto";
          zoomFactor = 1;
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
