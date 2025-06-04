const fs = require("fs");

// Hämta filnamnet från URL-query
function getBildPath() {
  const params = new URLSearchParams(window.location.search);
  return params.get("bild");
}

const bildPath = getBildPath();
let lastMtime = 0;

function reloadIfChanged() {
  fs.stat(bildPath, (err, stats) => {
    if (!err && stats.mtimeMs !== lastMtime) {
      lastMtime = stats.mtimeMs;
      document.getElementById("bild").src = bildPath + "?t=" + Date.now();
    }
  });
  setTimeout(reloadIfChanged, 1000);
}
reloadIfChanged();
