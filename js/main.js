/* =========================
   CONFIG
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

const VIEW_TRANSFORM = "c_limit,w_1800,q_auto:eco";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

/* =========================
   DOM
========================= */
const $gallery = document.getElementById("gallery");
const $fileInput = document.getElementById("fileInput");

const $bulkBar = document.getElementById("bulkBar");
const $selectedCount = document.getElementById("selectedCount");
const $clearSelection = document.getElementById("clearSelection");
const $bulkSave = document.getElementById("bulkSave");

const $overlay = document.getElementById("uploadOverlay");
const $overlaySub = document.getElementById("uploadOverlaySub");
const $overlayProgress = document.getElementById("uploadOverlayProgress");

const $viewer = document.getElementById("viewer");
const $viewerClose = document.getElementById("viewerClose");
const $viewerBackdrop = document.querySelector(".viewer-backdrop");
const $viewerImg = document.getElementById("viewerImg");
const $viewerLoading = document.getElementById("viewerLoading");
const $viewerOpen = document.getElementById("viewerOpen");
const $viewerCopy = document.getElementById("viewerCopy");

/* =========================
   STATE
========================= */
let allPhotos = [];
let selected = new Set();
let likes = new Map();
let viewerLoadToken = 0;
let userGesture = false;

/* =========================
   SAFETY (自動起動絶対禁止)
========================= */
function forceViewerClosed() {
  if (!$viewer) return;
  $viewer.hidden = true;
  $viewerImg?.removeAttribute("src");
  if ($viewerLoading) $viewerLoading.hidden = true;
}

window.addEventListener("pageshow", forceViewerClosed);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    forceViewerClosed();
  }
});

// ユーザー操作があるまで viewer を開けない
window.addEventListener("pointerdown", () => { userGesture = true; }, { once: true });
window.addEventListener("keydown", () => { userGesture = true; }, { once: true });

/* =========================
   Utils
========================= */
function jsonUrl() {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${LIST_NAME}.json`;
}

function cldUrl(meta, transform = "") {
  const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;
  const tr = transform ? transform + "/" : "";
  const v = meta.version ? "v" + meta.version + "/" : "";
  const ext = meta.format ? "." + meta.format : "";
  return `${base}${tr}${v}${meta.public_id}${ext}`;
}

function showOverlay(text = "", progress = "") {
  if (!$overlay) return;
  $overlay.hidden = false;
  if ($overlaySub) $overlaySub.textContent = text;
  if ($overlayProgress) $overlayProgress.textContent = progress;
  document.documentElement.style.overflow = "hidden";
}

function hideOverlay() {
  if (!$overlay) return;
  $overlay.hidden = true;
  document.documentElement.style.overflow = "";
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* =========================
   Viewer
========================= */
function closeViewer() {
  forceViewerClosed();
}

async function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => reject();
    img.src = url;
  });
}

async function openViewer(photo) {
  if (!userGesture) return; // 自動起動完全防止
  if (!photo) return;

  viewerLoadToken++;
  const token = viewerLoadToken;

  $viewer.hidden = false;
  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  try {
    await preloadImage(photo.view);
    if (token !== viewerLoadToken) return;
    $viewerImg.src = photo.view;
  } catch {
    if (token !== viewerLoadToken) return;
    $viewerImg.src = photo.thumb;
  } finally {
    if (token === viewerLoadToken) {
      $viewerLoading.hidden = true;
    }
  }
}

/* =========================
   Likes
========================= */
async function fetchLikesBatch(ids) {
  if (!ids.length) return;
  try {
    const res = await fetch(`${LIKE_API}/likes/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) return;
    const data = await res.json();
    const obj = data.likes || data;
    ids.forEach(id => {
      if (typeof obj[id] === "number") likes.set(id, obj[id]);
    });
  } catch {}
}

async function postLike(id) {
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  try {
    await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
  } catch {}
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = count;
}

/* =========================
   Render
========================= */
function buildCard(photo) {
  const card = document.createElement("div");
  card.className = "card";

  const imgBtn = document.createElement("button");
  imgBtn.className = "tile-hit";
  imgBtn.addEventListener("click", () => openViewer(photo));

  const img = document.createElement("img");
  img.className = "tile-img";
  img.src = photo.thumb;

  const tile = document.createElement("div");
  tile.className = "tile";
  tile.appendChild(img);
  tile.appendChild(imgBtn);

  const meta = document.createElement("div");
  meta.className = "meta";

  const likeBtn = document.createElement("button");
  likeBtn.className = "like-btn";
  likeBtn.textContent = "❤";
  likeBtn.addEventListener("click", () => postLike(photo.id));

  const likeCount = document.createElement("span");
  likeCount.className = "like-count";
  likeCount.dataset.likeCount = photo.id;
  likeCount.textContent = likes.get(photo.id) || 0;

  meta.appendChild(likeBtn);
  meta.appendChild(likeCount);

  card.appendChild(tile);
  card.appendChild(meta);

  return card;
}

function render() {
  $gallery.innerHTML = "";
  allPhotos.forEach(photo => {
    $gallery.appendChild(buildCard(photo));
  });
}

/* =========================
   Load
========================= */
async function loadList() {
  showOverlay("読み込み中…");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  const data = await res.json();
  const resources = data.resources || [];

  allPhotos = resources
    .sort((a, b) => (b.version || 0) - (a.version || 0))
    .map(r => ({
      id: r.public_id,
      public_id: r.public_id,
      version: r.version,
      format: r.format,
      thumb: cldUrl(r, THUMB_TRANSFORM),
      view: cldUrl(r, VIEW_TRANSFORM),
      original: cldUrl(r, "")
    }));

  await fetchLikesBatch(allPhotos.map(p => p.id));
  render();
  hideOverlay();
}

/* =========================
   Upload
========================= */
async function uploadFiles(files) {
  showOverlay("アップロード中…");

  for (let i = 0; i < files.length; i++) {
    const fd = new FormData();
    fd.append("file", files[i]);
    fd.append("upload_preset", UPLOAD_PRESET);

    await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: fd
    });
  }

  hideOverlay();
  await loadList();
}

/* =========================
   Events
========================= */
$fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;
  await uploadFiles(files);
});

$viewerClose.addEventListener("click", closeViewer);
$viewerBackdrop?.addEventListener("click", closeViewer);

$viewerCopy.addEventListener("click", async () => {
  const url = $viewerCopy.dataset.url;
  if (!url) return;
  await navigator.clipboard.writeText(url);
});

/* =========================
   Boot
========================= */
(async function init() {
  forceViewerClosed(); // 絶対閉じる
  await loadList();
})();
