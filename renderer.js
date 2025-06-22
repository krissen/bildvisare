// renderer.js

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

const params = new URLSearchParams(window.location.search);
const IS_SLAVE = params.get("slave") === "1";
let detached = false; // Slavens frikopplingsläge

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
let suppressSync = false; // För att undvika loopar vid synkning

function getBildPath() {
  const val = params.get("bild");
  return val ? decodeURIComponent(val) : null;
}
const bildPath = getBildPath();
let lastMtime = 0;

// Skapa overlay-element i DOM
const waitOverlay = document.createElement("div");
waitOverlay.style.position = "fixed";
waitOverlay.style.left = "0";
waitOverlay.style.top = "0";
waitOverlay.style.width = "100vw";
waitOverlay.style.height = "100vh";
waitOverlay.style.background = "rgba(10,10,10,0.72)";
waitOverlay.style.display = "flex";
waitOverlay.style.flexDirection = "column";
waitOverlay.style.alignItems = "center";
waitOverlay.style.justifyContent = "center";
waitOverlay.style.zIndex = 10000;
waitOverlay.style.fontSize = "2.2em";
waitOverlay.style.color = "#fff";
waitOverlay.style.backdropFilter = "blur(2px)";
waitOverlay.innerHTML = "<div>Väntar på konvertering av original…</div>";
waitOverlay.style.display = "none";
document.body.appendChild(waitOverlay);

require("electron").ipcRenderer.on("show-wait-overlay", (_e, msg) => {
  waitOverlay.innerHTML = `<div>${msg || "Väntar på konvertering av original…"}</div>`;
  waitOverlay.style.display = "flex";
});
require("electron").ipcRenderer.on("hide-wait-overlay", () => {
  waitOverlay.style.display = "none";
});

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

  function getImageCenter() {
    return {
      x: img.naturalWidth ? img.naturalWidth / 2 : 0,
      y: img.naturalHeight ? img.naturalHeight / 2 : 0,
    };
  }

  function isZoomInKey(event) {
    return event.key === "+";
  }
  function isZoomOutKey(event) {
    return event.key === "-";
  }

  function updateImageDisplay(
    center = null,
    keepPointInView = false,
    skipSync = false,
  ) {
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
    // Skicka sync till andra fönstret
    if (!skipSync) syncViewToOther();
  }

  function syncViewToOther() {
    if (IS_SLAVE && detached) return; // Slav frikopplad: ingen sync ut
    if (suppressSync) return; // undvik loopar
    // Proportionell scroll (scrollLeft/total, scrollTop/total)
    ipcRenderer.send("sync-view", {
      zoom: zoomFactor,
      x: (container.scrollLeft || 0) / Math.max(1, naturalWidth * zoomFactor),
      y: (container.scrollTop || 0) / Math.max(1, naturalHeight * zoomFactor),
      slave: IS_SLAVE ? 1 : 0,
    });
  }

  ipcRenderer.on("apply-view", (event, { zoom, x, y }) => {
    if (IS_SLAVE && detached) return; // ignorera sync om frikopplad slav
    suppressSync = true;
    zoomMode = "manual";
    zoomFactor = zoom;
    updateImageDisplay(null, false, true); // skipSync: true (undvik loop)
    // Justera scroll proportionerligt
    requestAnimationFrame(() => {
      container.scrollLeft = x * (naturalWidth * zoomFactor);
      container.scrollTop = y * (naturalHeight * zoomFactor);
      suppressSync = false;
    });
  });

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

  let lastMouseClientX = 0,
    lastMouseClientY = 0;

  img.addEventListener("mousemove", (e) => {
    const rect = img.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      lastCursorInImg = true;
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

  container.addEventListener("scroll", () => {
    syncViewToOther();
  });

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
    } else if (event.key.toLowerCase() === "x" && IS_SLAVE) {
      // Aktivera/avaktivera frikoppling för slav
      detached = !detached;
      dlog("Slav frikoppling:", detached);
      // Enkel overlay om du vill:
      let overlay = document.getElementById("detach-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "detach-overlay";
        overlay.style.position = "fixed";
        overlay.style.top = "10px";
        overlay.style.right = "10px";
        overlay.style.zIndex = 1000;
        overlay.style.background = "rgba(255,0,0,0.75)";
        overlay.style.color = "#fff";
        overlay.style.padding = "6px 16px";
        overlay.style.fontSize = "18px";
        overlay.style.borderRadius = "8px";
        document.body.appendChild(overlay);
      }
      overlay.textContent = detached
        ? "Frikopplad från master"
        : "Synkroniserad med master";
      overlay.style.display = "block";
      setTimeout(() => {
        if (overlay) overlay.style.display = "none";
      }, 2000);
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
