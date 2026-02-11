/* =========================
   CONFIG
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // .json無し
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

const VIEW_TRANSFORM  = "c_limit,w_1800,q_auto:eco";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

const UPLOAD_MAX_FILES_PER_BATCH = 8;
const BULK_SAVE_MAX = 25;
const HIRES_TIMEOUT_MS = 45000;

/* =========================
   DOM
========================= */
const $gallery = document.getElementById("gallery");
const $fileInput = document.getElementById("fileInput");
const $sentinel = document.getElementById("sentinel");

const $bulkBar = document.getElementById("bulkBar");
const $selectedCount = document.getElementById("selectedCount");
const $clearSelection = document.getElementById("clearSelection");
const $bulkSave = document.getElementById("bulkSave");

const $overlay = document.getElementById("uploadOverlay");
const $overlayTitle = document.getElementById("uploadOverlayTitle");
const $overlaySub = document.getElementById("uploadOverlaySub");
const $overlayProgress = document.getElementById("uploadOverlayProgress");

const $viewer = document.getElementById("viewer");
const $viewerBackdrop = $viewer.querySelector(".viewer-backdrop");
const $viewerClose = document.getElementById("viewerClose");
const $viewerImg = document.getElementById("viewerImg");
const $viewerLoading = document.getElementById("viewerLoading");
const $viewerOpen = document.getElementById("viewerOpen");
const $viewerCopy = document.getElementById("viewerCopy");

/* =========================
   STATE
========================= */
let allPhotos = [];
let renderIndex = 0;
const RENDER_CHUNK = 18;

const selected = new Set();
const likes = new Map();

let io = null;
let viewerLoadToken = 0;

/* =========================
   Utils
========================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function showOverlay(title, sub, progressText = "") {
  $overlayTitle.textContent = title || "処理中…";
  $overlaySub.textContent = sub || "しばらくお待ちください";
  $overlayProgress.textContent = progressText || "";
  $overlay.hidden = false;
  document.body.classList.add("is-busy");
}
function updateOverlay(progressText) {
  $overlayProgress.textContent = progressText || "";
}
function hideOverlay() {
  $overlay.hidden = true;
  document.body.classList.remove("is-busy");
}

function jsonUrl() {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(LIST_NAME)}.json`;
}

function cldUrl({ public_id, version, format }, transform = "") {
  const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;
  const tr = transform ? `${transform}/` : "";
  const v = version ? `v${version}/` : "";
  const ext = format ? `.${format}` : "";
  return `${base}${tr}${v}${public_id}${ext}`;
}

function setBulkBar() {
  const n = selected.size;
  $selectedCount.textContent = String(n);
  $bulkBar.hidden = (n === 0);
}

function isLikelyTouchDevice() {
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   Viewer（class制御：初期は絶対 display:none）
========================= */
function closeViewer(hard = false) {
  $viewer.classList.remove("is-open");
  $viewer.setAttribute("aria-hidden", "true");

  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");

  if (hard) {
    // “起動直後に勝手に出る” を物理的に潰す保険
    viewerLoadToken++;
  }
}

function openViewerShell() {
  $viewer.classList.add("is-open");
  $viewer.setAttribute("aria-hidden", "false");
}

function preloadImage(url, timeoutMs = HIRES_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;

    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("preload timeout"));
    }, timeoutMs);

    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(true);
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(new Error("preload error"));
    };
    img.src = url;
  });
}

async function openViewer(photo) {
  if (!photo) return;

  openViewerShell();
  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  const token = ++viewerLoadToken;
  const hiUrl = photo.view;

  try {
    await preloadImage(hiUrl, HIRES_TIMEOUT_MS);
    if (token !== viewerLoadToken) return;

    $viewerImg.src = hiUrl;
    if ($viewerImg.decode) {
      try { await $viewerImg.decode(); } catch {}
    }
  } catch (e) {
    if (token !== viewerLoadToken) return;
    console.warn("viewer preload failed:", e);
    $viewerImg.src = photo.thumb;
  } finally {
    if (token !== viewerLoadToken) return;
    $viewerLoading.hidden = true;
  }
}

/* =========================
   Likes API
========================= */
async function fetchLikesBatch(ids) {
  if (!ids.length) return;

  // POST /likes/batch
  try {
    const res = await fetch(`${LIKE_API}/likes/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) {
      const data = await res.json();
      const obj = data?.likes || data || {};
      for (const id of ids) {
        const v = obj[id];
        if (typeof v === "number") likes.set(id, v);
      }
      return;
    }
  } catch {}

  // GET /likes/batch?ids=
  try {
    const qs = encodeURIComponent(ids.join(","));
    const res = await fetch(`${LIKE_API}/likes/batch?ids=${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    const obj = data?.likes || data || {};
    for (const id of ids) {
      const v = obj[id];
      if (typeof v === "number") likes.set(id, v);
    }
  } catch {}
}

let resortTimer = null;
function scheduleResort() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerender();
  }, 700);
}

async function postLike(id) {
  // UI即反映
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);
  scheduleResort();

  // サーバ反映
  try {
    const res = await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const data = await res.json();
      const serverCount =
        (typeof data?.likes === "number" && data.likes) ||
        (typeof data?.count === "number" && data.count) ||
        (typeof data?.value === "number" && data.value) ||
        (typeof data === "number" && data);

      if (typeof serverCount === "number") {
        likes.set(id, serverCount);
        updateLikeUI(id, serverCount);
        scheduleResort();
      }
    }
  } catch {}
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

/* =========================
   Render（CSS構造に合わせる）
========================= */
function buildPhotoCard(photo, isTop = false) {
  const card = document.createElement("div");
  card.className = isTop ? "card card--top" : "card";
  card.dataset.photoId = photo.id;

  const tile = document.createElement("div");
  tile.className = "tile";

  const img = document.createElement("img");
  img.className = "tile-img";
  img.loading = "lazy";
  img.alt = "photo";
  img.src = photo.thumb;

  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "tile-hit";
  hit.setAttribute("aria-label", "写真を開く");
  hit.addEventListener("click", () => openViewer(photo));

  const checkLabel = document.createElement("label");
  checkLabel.className = "tile-check";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selected.has(photo.id);
  cb.addEventListener("change", () => {
    if (cb.checked) selected.add(photo.id);
    else selected.delete(photo.id);
    setBulkBar();
  });

  const cbText = document.createElement("span");
  cbText.textContent = "選択";

  checkLabel.appendChild(cb);
  checkLabel.appendChild(cbText);

  tile.appendChild(img);
  tile.appendChild(hit);
  tile.appendChild(checkLabel);

  const meta = document.createElement("div");
  meta.className = "meta";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "like-btn";
  likeBtn.innerHTML = `❤ <span class="like-count" data-like-count="${photo.id}">${likes.get(photo.id) || 0}</span>`;
  likeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    postLike(photo.id);
  });

  meta.appendChild(likeBtn);

  card.appendChild(tile);
  card.appendChild(meta);

  return card;
}

function renderNextChunk() {
  const end = Math.min(renderIndex + RENDER_CHUNK, allPhotos.length);
  if (renderIndex >= end) return false;

  const frag = document.createDocumentFragment();
  for (let i = renderIndex; i < end; i++) {
    frag.appendChild(buildPhotoCard(allPhotos[i], i === 0));
  }
  $gallery.appendChild(frag);
  renderIndex = end;
  return (renderIndex < allPhotos.length);
}

function setupInfiniteScroll() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const hasMore = renderNextChunk();
      if (!hasMore) io.disconnect();
    }
  }, { rootMargin: "900px 0px" });

  io.observe($sentinel);
}

/* いいね順に並べてTOP豪華 */
function resortByLikesAndRerender() {
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
}

/* =========================
   Load list
========================= */
async function loadList() {
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);

  const data = await res.json();
  const resources = Array.isArray(data?.resources) ? data.resources : [];

  resources.sort((a, b) => (b.version || 0) - (a.version || 0));

  allPhotos = resources.map(r => {
    const meta = { public_id: r.public_id, version: r.version, format: r.format || "jpg" };
    return {
      id: r.public_id,
      version: r.version,
      format: r.format || "jpg",
      thumb: cldUrl(meta, THUMB_TRANSFORM),
      view: cldUrl(meta, VIEW_TRANSFORM),
      original: cldUrl(meta, ""),
    };
  });

  // likes取得（分割）
  const ids = allPhotos.map(p => p.id);
  for (const batch of chunk(ids, 100)) {
    await fetchLikesBatch(batch);
  }

  resortByLikesAndRerender();
  hideOverlay();
}

/* =========================
   Upload
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  const list = files.slice(0, UPLOAD_MAX_FILES_PER_BATCH);

  showOverlay(
    "アップロード中…",
    `※ 数枚ずつアップロードが安定します（最大 ${UPLOAD_MAX_FILES_PER_BATCH} 枚）`,
    `0 / ${list.length}`
  );

  const uploaded = [];
  for (let i = 0; i < list.length; i++) {
    updateOverlay(`${i + 1} / ${list.length}`);

    const fd = new FormData();
    fd.append("file", list[i]);
    fd.append("upload_preset", UPLOAD_PRESET);
    if (UPLOAD_FOLDER) fd.append("folder", UPLOAD_FOLDER);

    const up = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: fd,
    });

    if (!up.ok) {
      const t = await up.text().catch(() => "");
      throw new Error(`upload failed: ${up.status} ${t}`);
    }

    const data = await up.json();
    uploaded.push({ public_id: data.public_id, version: data.version, format: data.format || "jpg" });
  }

  const newPhotos = uploaded.map(meta => ({
    id: meta.public_id,
    version: meta.version,
    format: meta.format,
    thumb: cldUrl(meta, THUMB_TRANSFORM),
    view: cldUrl(meta, VIEW_TRANSFORM),
    original: cldUrl(meta, ""),
  }));

  for (const p of newPhotos) likes.set(p.id, likes.get(p.id) || 0);

  allPhotos = [...newPhotos, ...allPhotos];
  resortByLikesAndRerender();

  hideOverlay();
}

/* =========================
   Bulk Save（1ボタンで“開く”まで）
========================= */
async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  if (ids.length > BULK_SAVE_MAX) {
    alert(`一括保存は最大 ${BULK_SAVE_MAX} 枚までにしてください（端末制限対策）。`);
    return;
  }

  showOverlay("一括保存の準備中…", "端末によっては保存操作が必要です", `${ids.length} 枚`);
  hideOverlay();

  let opened = 0;
  for (const id of ids) {
    const photo = allPhotos.find(p => p.id === id);
    if (!photo) continue;
    window.open(photo.original, "_blank", "noopener");
    opened++;
    await sleep(450);
  }

  if (opened === 0) {
    alert("保存対象が見つかりませんでした。");
  } else if (isLikelyTouchDevice()) {
    alert("原寸画像を開きました。各タブで画像を長押しして「写真に追加/画像を保存」してください。");
  }
}

/* =========================
   Events
========================= */
function bindEvents() {
  $fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    try {
      await uploadFiles(files);
    } catch (err) {
      console.error(err);
      hideOverlay();
      alert("アップロードに失敗しました。電波が弱い場合は枚数を減らして試してください。");
    }
  });

  $clearSelection.addEventListener("click", () => {
    selected.clear();
    document.querySelectorAll('.tile-check input[type="checkbox"]').forEach(cb => (cb.checked = false));
    setBulkBar();
  });

  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      alert("一括保存の準備に失敗しました（端末制限の可能性）。");
    }
  });

  $viewerClose.addEventListener("click", () => closeViewer(true));
  $viewerBackdrop.addEventListener("click", () => closeViewer(true));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeViewer(true);
  });

  $viewerCopy.addEventListener("click", async () => {
    const url = $viewerCopy.dataset.url || "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      $viewerCopy.textContent = "コピーしました";
      await sleep(800);
      $viewerCopy.textContent = "URLコピー";
    } catch {
      prompt("コピーしてね", url);
    }
  });
}

/* =========================
   Boot
========================= */
async function boot() {
  // ✅ ここで“絶対閉じる”（DOM後にもう一回保険）
  closeViewer(true);
  document.addEventListener("DOMContentLoaded", () => closeViewer(true));

  bindEvents();

  try {
    await loadList();
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("写真一覧の読み込みに失敗しました。\nlist url = " + jsonUrl());
  }

  setBulkBar();
}

boot();
