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

/* sentinel（HTMLに無くても作る：無限スクロール用） */
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
   SAFETY (自動起動禁止 & iOS復元対策)
========================= */
function forceViewerClosed() {
  if (!$viewer) return;
  $viewer.hidden = true;
  if ($viewerLoading) $viewerLoading.hidden = true;
  $viewerImg?.removeAttribute("src");
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
  if ($overlaySub) $overlaySub.textContent = sub;
  if ($overlayProgress) $overlayProgress.textContent = progress;
  document.body.classList.add("is-busy");
}
function updateOverlay(progress = "") {
  if ($overlayProgress) $overlayProgress.textContent = progress;
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

/* =========================
   Viewer
========================= */
function closeViewer() {
  forceViewerClosed();
}

async function preloadImage(url, timeoutMs = 30000) {
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
  if (!userGesture) return; // 自動起動完全禁止
  if (!photo) return;

  const token = ++viewerLoadToken;

  $viewer.hidden = false;
  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  try {
    await preloadImage(photo.view, 30000);
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
   Likes (堅牢版)
========================= */
async function fetchLikesBatch(ids) {
  if (!ids.length) return;

  // POST /likes/batch を優先
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

  // fallback GET
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
  // まずローカル即反映（何回押してもOK）
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  // サーバ反映（仕様差を吸収）
  // 1) POST /likes {id}
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

  // 2) POST /likes/:id
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
   Render (CSSに合わせる)
========================= */
function buildCard(photo) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.photoId = photo.id;

  // tile
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

  // meta
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
  likeCount.dataset.likeCount = photo.id;           // data-like-count
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
  for (let i = renderIndex; i < end; i++) {
    frag.appendChild(buildCard(allPhotos[i]));
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
  }, { rootMargin: "800px 0px" });

  io.observe($sentinel);
}

/* =========================
   Load
========================= */
async function loadList() {
  showOverlay("写真一覧を取得しています…", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
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

  // Like 先読み（最初の120件だけ）
  const firstIds = allPhotos.slice(0, Math.min(120, allPhotos.length)).map(p => p.id);
  await fetchLikesBatch(firstIds);

  // 描画
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Upload
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  showOverlay("アップロード中…", `0 / ${files.length}`);

  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    updateOverlay(`${i + 1} / ${files.length}`);

    const fd = new FormData();
    fd.append("file", files[i]);
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

  // iOS制限で完全自動DLは難しいので「原寸を順に開く」方式
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
      alert("アップロードに失敗しました。電波が弱い場合は枚数を減らして試してください。");
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
