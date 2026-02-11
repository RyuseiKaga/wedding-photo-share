/* =========================
   CONFIG
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

// Cloudinary transforms
const VIEW_TRANSFORM = "c_limit,w_1800,q_auto:eco";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

// Timeouts（ここで“エラーまでの時間”を伸ばす）
const VIEW_PRELOAD_TIMEOUT_MS = 60000;     // 60秒（高画質表示）
const UPLOAD_TIMEOUT_MS = 120000;          // 120秒（アップロード）
const LIST_TIMEOUT_MS = 30000;             // 30秒（一覧JSON取得）

// 端末側の軽量化（アップロード高速化）
// 劣化が分からない程度：最大長辺2000px / JPEG品質0.82
const ENABLE_CLIENT_COMPRESS = true;
const COMPRESS_MAX_EDGE = 2000;
const COMPRESS_JPEG_QUALITY = 0.82;

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

/* sentinel（HTMLに無くても作る） */
let $sentinel = document.getElementById("sentinel");
if (!$sentinel) {
  $sentinel = document.createElement("div");
  $sentinel.id = "sentinel";
  $sentinel.style.height = "1px";
  $gallery.after($sentinel);
}

/* =========================
   STATE
========================= */
let allPhotos = [];
let renderIndex = 0;
const RENDER_CHUNK = 18;

const selected = new Set(); // photo.id
const likes = new Map();    // photo.id -> number

let io = null;
let viewerLoadToken = 0;
let userGesture = false;

/* =========================
   SAFETY (viewer自動起動禁止 & iOS復元対策)
========================= */
function forceViewerClosed() {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
}
window.addEventListener("pageshow", () => {
  forceViewerClosed();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") forceViewerClosed();
});
window.addEventListener("pointerdown", () => { userGesture = true; }, { once: true });
window.addEventListener("keydown", () => { userGesture = true; }, { once: true });

/* =========================
   Utils
========================= */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showOverlay(sub = "しばらくお待ちください", progress = "") {
  $overlay.hidden = false;
  $overlaySub.textContent = sub;
  $overlayProgress.textContent = progress;
  document.body.classList.add("is-busy");
}
function updateOverlay(progress = "") {
  $overlayProgress.textContent = progress;
}
function hideOverlay() {
  $overlay.hidden = true;
  document.body.classList.remove("is-busy");
}

function jsonUrl() {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(LIST_NAME)}.json`;
}

function cldUrl(meta, transform = "") {
  const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;
  const tr = transform ? `${transform}/` : "";
  const v = meta.version ? `v${meta.version}/` : "";
  const ext = meta.format ? `.${meta.format}` : "";
  return `${base}${tr}${v}${meta.public_id}${ext}`;
}

function setBulkBar() {
  const n = selected.size;
  $selectedCount.textContent = String(n);
  $bulkBar.hidden = (n === 0);
}

function isLikelyTouchDevice() {
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/* =========================
   Viewer
========================= */
function closeViewer() {
  forceViewerClosed();
}

async function preloadImage(url, timeoutMs) {
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
  if (!userGesture) return; // 自動起動禁止
  if (!photo) return;

  const token = ++viewerLoadToken;

  $viewer.hidden = false;
  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  try {
    await preloadImage(photo.view, VIEW_PRELOAD_TIMEOUT_MS);
    if (token !== viewerLoadToken) return;

    $viewerImg.src = photo.view;
    if ($viewerImg.decode) {
      try { await $viewerImg.decode(); } catch {}
    }
  } catch (e) {
    console.warn("viewer preload failed:", e);
    if (token !== viewerLoadToken) return;
    $viewerImg.src = photo.thumb; // fallback
  } finally {
    if (token !== viewerLoadToken) return;
    $viewerLoading.hidden = true;
  }
}

/* =========================
   Likes（堅牢版）
========================= */
async function fetchLikesBatch(ids) {
  if (!ids.length) return;

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
  } catch (e) {
    console.warn("POST /likes/batch failed:", e);
  }

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
  } catch (e) {
    console.warn("GET /likes/batch failed:", e);
  }
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

async function postLike(id) {
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  try {
    const res = await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const serverCount =
        (typeof data?.likes === "number" && data.likes) ||
        (typeof data?.count === "number" && data.count) ||
        (typeof data?.value === "number" && data.value) ||
        (typeof data === "number" && data);
      if (typeof serverCount === "number") {
        likes.set(id, serverCount);
        updateLikeUI(id, serverCount);
      }
      return;
    }
  } catch (e) {
    console.warn("POST /likes failed:", e);
  }

  try {
    const res = await fetch(`${LIKE_API}/likes/${encodeURIComponent(id)}`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    const serverCount =
      (typeof data?.likes === "number" && data.likes) ||
      (typeof data?.count === "number" && data.count) ||
      (typeof data === "number" && data);
    if (typeof serverCount === "number") {
      likes.set(id, serverCount);
      updateLikeUI(id, serverCount);
    }
  } catch (e) {
    console.warn("POST /likes/:id failed:", e);
  }
}

/* =========================
   Render（UI戻し版）
========================= */
function buildCard(photo) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.photoId = photo.id;

  const tile = document.createElement("div");
  tile.className = "tile";

  const img = document.createElement("img");
  img.className = "tile-img";
  img.src = photo.thumb;
  img.alt = "photo";
  img.loading = "lazy";
  img.decoding = "async";

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

  const checkText = document.createElement("span");
  checkText.textContent = "選択";

  checkLabel.appendChild(cb);
  checkLabel.appendChild(checkText);

  tile.appendChild(img);
  tile.appendChild(hit);
  tile.appendChild(checkLabel);

  const meta = document.createElement("div");
  meta.className = "meta";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "like-btn";
  likeBtn.addEventListener("click", () => postLike(photo.id));

  const heart = document.createElement("span");
  heart.textContent = "❤";

  const likeCount = document.createElement("span");
  likeCount.className = "like-count";
  likeCount.setAttribute("data-like-count", photo.id);
  likeCount.textContent = String(likes.get(photo.id) || 0);

  likeBtn.appendChild(heart);
  likeBtn.appendChild(likeCount);
  meta.appendChild(likeBtn);

  card.appendChild(tile);
  card.appendChild(meta);

  return card;
}

function renderNextChunk() {
  const end = Math.min(renderIndex + RENDER_CHUNK, allPhotos.length);
  if (renderIndex >= end) return false;

  const frag = document.createDocumentFragment();
  for (let i = renderIndex; i < end; i++) frag.appendChild(buildCard(allPhotos[i]));
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
  }, { rootMargin: "800px 0px" });

  io.observe($sentinel);
}

/* =========================
   Load list
========================= */
async function loadList() {
  showOverlay("写真一覧を取得しています…", "");

  const res = await fetchWithTimeout(jsonUrl(), { cache: "no-store" }, LIST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);
  const data = await res.json();

  const resources = Array.isArray(data?.resources) ? data.resources : [];
  resources.sort((a, b) => (b.version || 0) - (a.version || 0));

  allPhotos = resources.map(r => {
    const meta = { public_id: r.public_id, version: r.version, format: r.format || "jpg" };
    return {
      id: r.public_id,
      public_id: r.public_id,
      version: r.version,
      format: r.format || "jpg",
      thumb: cldUrl(meta, THUMB_TRANSFORM),
      view: cldUrl(meta, VIEW_TRANSFORM),
      original: cldUrl(meta, ""),
    };
  });

  const firstIds = allPhotos.slice(0, Math.min(120, allPhotos.length)).map(p => p.id);
  await fetchLikesBatch(firstIds);

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Upload（タイムアウト長め + 軽量化オプション）
========================= */
async function fileToCompressedBlob(file) {
  // 軽量化しない設定ならそのまま返す
  if (!ENABLE_CLIENT_COMPRESS) return file;

  // 画像以外はそのまま
  if (!file.type.startsWith("image/")) return file;

  const imgBitmap = await createImageBitmap(file).catch(() => null);
  if (!imgBitmap) return file;

  const w = imgBitmap.width;
  const h = imgBitmap.height;
  const maxEdge = Math.max(w, h);
  const scale = maxEdge > COMPRESS_MAX_EDGE ? (COMPRESS_MAX_EDGE / maxEdge) : 1;

  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgBitmap, 0, 0, tw, th);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b || file),
      "image/jpeg",
      COMPRESS_JPEG_QUALITY
    );
  });

  return blob;
}

async function uploadOne(file, index, total) {
  const blob = await fileToCompressedBlob(file);

  const fd = new FormData();
  fd.append("file", blob, file.name.replace(/\.\w+$/, "") + ".jpg");
  fd.append("upload_preset", UPLOAD_PRESET);
  if (UPLOAD_FOLDER) fd.append("folder", UPLOAD_FOLDER);

  updateOverlay(`${index + 1} / ${total}`);

  const res = await fetchWithTimeout(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: fd },
    UPLOAD_TIMEOUT_MS
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${t}`);
  }

  return res.json();
}

async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  showOverlay(
    ENABLE_CLIENT_COMPRESS ? "アップロード中（軽量化して送信）…" : "アップロード中…",
    `0 / ${files.length}`
  );

  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    const data = await uploadOne(files[i], i, files.length);
    uploaded.push({
      public_id: data.public_id,
      version: data.version,
      format: data.format || "jpg",
    });
  }

  // 今回分は即表示（list反映待ちでも見える）
  const newPhotos = uploaded.map(m => {
    const meta = { public_id: m.public_id, version: m.version, format: m.format };
    return {
      id: m.public_id,
      public_id: m.public_id,
      version: m.version,
      format: m.format,
      thumb: cldUrl(meta, THUMB_TRANSFORM),
      view: cldUrl(meta, VIEW_TRANSFORM),
      original: cldUrl(meta, ""),
    };
  });

  for (const p of newPhotos) likes.set(p.id, likes.get(p.id) || 0);
  allPhotos = [...newPhotos, ...allPhotos];

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Bulk Save
========================= */
async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  showOverlay("一括保存の準備中…", `${ids.length} 枚`);
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
    alert("原寸画像をタブで開きました。各画像を長押しして「写真に追加/画像を保存」してください。");
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
      alert(
        "アップロードに失敗しました。\n" +
        "・回線が弱い場合は枚数を減らす\n" +
        "・それでもダメなら、写真を少し軽くする（今は“劣化が分かりにくい軽量化”を入れています）\n"
      );
    }
  });

  $clearSelection.addEventListener("click", () => {
    selected.clear();
    document.querySelectorAll('.tile-check input[type="checkbox"]').forEach(cb => cb.checked = false);
    setBulkBar();
  });

  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      alert("一括保存の準備に失敗しました。");
    }
  });

  $viewerClose.addEventListener("click", closeViewer);
  $viewerBackdrop?.addEventListener("click", closeViewer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$viewer.hidden) closeViewer();
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
  forceViewerClosed();
  bindEvents();
  setBulkBar();

  try {
    await loadList();
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("写真一覧の読み込みに失敗しました。Cloudinary list JSON を確認してください。");
  }
}

boot();
