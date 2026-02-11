/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // ✅ .json無し
const UPLOAD_PRESET = "wedding_unsigned";  // Cloudinary unsigned preset
const UPLOAD_FOLDER = "";                  // 使ってなければ空でOK

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev"; // Workers URL

// Cloudinary 変換
const VIEW_TRANSFORM  = "c_limit,w_1800,q_auto:eco";                 // ビューア高画質
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";     // サムネ

// ✅ 一括保存だけ軽量（速い / Shareが出ない事故を減らす）
const BULK_SAVE_TRANSFORM = "c_limit,w_1600,q_auto:eco,f_jpg,fl_progressive";

// 制限（安定優先）
const UPLOAD_MAX_FILES_PER_BATCH = 8;
const BULK_SAVE_MAX = 9999;                // ✅ 実質なし（端末が落ちたら運用で減らす）
const HIRES_TIMEOUT_MS = 45000;

// ✅ 一括保存準備（事前DL）の並列数
const BULK_FETCH_CONCURRENCY = 3;

// ✅ likes batch を大きく
const LIKES_BATCH_SIZE = 120;

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
let allPhotos = [];           // [{id, version, format, thumb, view, original}]
let renderIndex = 0;
const RENDER_CHUNK = 18;

const selected = new Set();  // photo.id
const likes = new Map();     // photo.id -> number

let io = null;
let viewerOpenPhoto = null;
let viewerLoadToken = 0;

// ✅ Like 連打防止（サーバ反映までロック）
const likePending = new Set();

// ✅ 一括保存：事前準備（選択中にDL→File化）
let preparedShareFiles = null;   // File[]
let preparedForKey = "";         // 選択状態の署名
let preparePromise = null;       // Promise<File[]|null>
let prepareAbort = null;         // AbortController
let prepareTimer = null;         // debounce

/* =========================
   Utils
========================= */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

function selectionKey(ids) {
  return ids.slice().sort().join("|");
}

function setBulkSaveButtonState(state, extraText = "") {
  if (state === "preparing") {
    $bulkSave.disabled = true;
    $bulkSave.textContent = extraText ? `準備中…（${extraText}）` : "準備中…";
    $bulkSave.style.opacity = "0.7";
  } else {
    $bulkSave.disabled = false;
    $bulkSave.textContent = "一括保存（カメラロール）";
    $bulkSave.style.opacity = "1";
  }
}

function setLikePendingUI(id, pending) {
  const btn = document.querySelector(`[data-like-btn="${CSS.escape(id)}"]`);
  if (!btn) return;
  btn.disabled = pending;
}

/* =========================
   Viewer（✅ 起動時に絶対開かない）
========================= */
function forceViewerClosedOnLoad() {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  viewerOpenPhoto = null;

  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function closeViewer() {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  viewerOpenPhoto = null;
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
  viewerOpenPhoto = photo;

  $viewer.hidden = false;
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
   Likes API（反映漏れが嫌 → 連打不可）
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
        else if (!likes.has(id)) likes.set(id, 0);
      }
      return;
    }
  } catch (e) {}

  try {
    const qs = encodeURIComponent(ids.join(","));
    const res = await fetch(`${LIKE_API}/likes/batch?ids=${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    const obj = data?.likes || data || {};
    for (const id of ids) {
      const v = obj[id];
      if (typeof v === "number") likes.set(id, v);
      else if (!likes.has(id)) likes.set(id, 0);
    }
  } catch (e) {}
}

async function postLike(id) {
  if (likePending.has(id)) return;

  likePending.add(id);
  setLikePendingUI(id, true);

  // 即時反映（体感）
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  // 永久ロック防止
  const unlockTimer = setTimeout(() => {
    likePending.delete(id);
    setLikePendingUI(id, false);
  }, 8000);

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

      // ✅ “戻る”対策：サーバが古くても下げない
      if (typeof serverCount === "number") {
        const cur = likes.get(id) || 0;
        const merged = Math.max(cur, serverCount);
        likes.set(id, merged);
        updateLikeUI(id, merged);
      }

      scheduleResort();
    } else {
      console.warn("like api not ok:", res.status);
    }
  } catch (e) {
    console.warn("like api failed:", e);
  } finally {
    clearTimeout(unlockTimer);
    likePending.delete(id);
    setLikePendingUI(id, false);
  }
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

/* =========================
   Render（CSSの .card/.tile に合わせる）
========================= */
function buildPhotoCard(photo, isTop = false) {
  const card = document.createElement("div");
  card.className = isTop ? "card card--top" : "card";
  card.dataset.photoId = photo.id;

  // tile
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
    schedulePrepareBulk();
  });

  const cbText = document.createElement("span");
  cbText.textContent = "選択";

  checkLabel.appendChild(cb);
  checkLabel.appendChild(cbText);

  tile.appendChild(img);
  tile.appendChild(hit);
  tile.appendChild(checkLabel);

  // meta
  const meta = document.createElement("div");
  meta.className = "meta";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "like-btn";
  likeBtn.dataset.likeBtn = photo.id; // ✅ ロックUI用
  likeBtn.disabled = likePending.has(photo.id);
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

/* =========================
   Sort: いいね多い順（TOP豪華）
========================= */
let resortTimer = null;
function scheduleResort() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerender();
  }, 800);
}

function resortByLikesAndRerender() {
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  schedulePrepareBulk();
}

/* =========================
   Load Cloudinary list
========================= */
async function loadList() {
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const url = jsonUrl();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);

  const data = await res.json();
  const resources = Array.isArray(data?.resources) ? data.resources : [];

  resources.sort((a, b) => (b.version || 0) - (a.version || 0));

  allPhotos = resources.map(r => {
    const id = r.public_id;
    const version = r.version;
    const format = r.format || "jpg";
    const meta = { public_id: id, version, format };
    return {
      id,
      version,
      format,
      thumb: cldUrl(meta, THUMB_TRANSFORM),
      view: cldUrl(meta, VIEW_TRANSFORM),
      original: cldUrl(meta, ""),
    };
  });

  // likes をまとめて取得
  const ids = allPhotos.map(p => p.id);
  const batches = chunk(ids, LIKES_BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    updateOverlay(`いいね取得中… ${i + 1} / ${batches.length}`);
    await fetchLikesBatch(batches[i]);
  }

  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

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

  const list = files.slice(0, UPLOAD_MAX_FILES_PER_BATCH);

  showOverlay(
    "アップロード中…",
    `※ 数枚ずつアップロードが安定します（最大 ${UPLOAD_MAX_FILES_PER_BATCH} 枚）`,
    `0 / ${list.length}`
  );

  const uploaded = [];
  for (let i = 0; i < list.length; i++) {
    updateOverlay(`${i + 1} / ${list.length}`);

    const file = list[i];
    const fd = new FormData();
    fd.append("file", file);
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
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Bulk Save: 事前準備（選択中にDL→File化）
========================= */
async function fetchImageAsFileWithSignal(url, filenameBase, signal) {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

  const blob = await res.blob();
  const ext = (blob.type && blob.type.includes("png")) ? "png"
            : (blob.type && (blob.type.includes("jpeg") || blob.type.includes("jpg"))) ? "jpg"
            : "jpg";

  return new File([blob], `${filenameBase}.${ext}`, { type: blob.type || "image/jpeg" });
}

function cancelPrepare() {
  preparedShareFiles = null;
  preparedForKey = "";
  preparePromise = null;

  if (prepareAbort) {
    try { prepareAbort.abort(); } catch {}
    prepareAbort = null;
  }
  if (prepareTimer) {
    clearTimeout(prepareTimer);
    prepareTimer = null;
  }
}

function schedulePrepareBulk() {
  const ids = Array.from(selected);

  if (ids.length === 0) {
    cancelPrepare();
    setBulkSaveButtonState("idle");
    return;
  }

  // 実質なし（BULK_SAVE_MAXが巨大）
  if (ids.length > BULK_SAVE_MAX) {
    cancelPrepare();
    setBulkSaveButtonState("idle");
    return;
  }

  if (prepareTimer) clearTimeout(prepareTimer);
  prepareTimer = setTimeout(() => {
    prepareTimer = null;
    prepareBulkFiles(ids).catch(() => {});
  }, 300);
}

async function prepareBulkFiles(ids) {
  const key = selectionKey(ids);

  if (preparedShareFiles && preparedForKey === key) {
    setBulkSaveButtonState("ready");
    return preparedShareFiles;
  }

  if (preparePromise && preparedForKey === key) {
    setBulkSaveButtonState("preparing", `${ids.length}枚`);
    return preparePromise;
  }

  cancelPrepare();
  preparedForKey = key;

  const canShareFiles = !!navigator.share && typeof navigator.canShare === "function";
  if (!canShareFiles) {
    setBulkSaveButtonState("ready");
    return null;
  }

  setBulkSaveButtonState("preparing", `${ids.length}枚`);

  prepareAbort = new AbortController();
  const signal = prepareAbort.signal;

  const files = new Array(ids.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < ids.length) {
      const i = cursor++;
      const photo = allPhotos.find(p => p.id === ids[i]);
      if (!photo) continue;

      const url = cldUrl(
        { public_id: photo.id, version: photo.version, format: "jpg" },
        BULK_SAVE_TRANSFORM
      );

      files[i] = await fetchImageAsFileWithSignal(url, `photo_${i + 1}`, signal);
    }
  };

  preparePromise = (async () => {
    const workers = Array.from(
      { length: Math.min(BULK_FETCH_CONCURRENCY, ids.length) },
      () => worker()
    );
    await Promise.all(workers);

    if (preparedForKey !== key) return null;

    const shareFiles = files.filter(Boolean);
    preparedShareFiles = shareFiles;
    setBulkSaveButtonState("ready");
    return shareFiles;
  })();

  return preparePromise;
}

async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  const key = selectionKey(ids);
  const canShareFiles = !!navigator.share && typeof navigator.canShare === "function";

  if (
    canShareFiles &&
    preparedShareFiles &&
    preparedForKey === key &&
    preparedShareFiles.length &&
    navigator.canShare &&
    navigator.canShare({ files: preparedShareFiles })
  ) {
    try {
      await navigator.share({
        files: preparedShareFiles,
        title: "写真を保存",
        text: "「画像を保存」または「“ファイル”に保存」を選んでください",
      });
      return;
    } catch (e) {
      console.warn("share canceled/failed:", e);
      return;
    }
  }

  showOverlay("準備中…", "一括保存のため画像を準備しています", `${ids.length} 枚`);
  try {
    await prepareBulkFiles(ids);
  } catch (e) {
    console.warn(e);
  } finally {
    hideOverlay();
  }

  alert("準備できました！もう一度『一括保存』を押してください。");
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

    cancelPrepare();
    setBulkSaveButtonState("idle");
  });

  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      alert("一括保存に失敗しました。枚数を減らして試してください。");
    }
  });

  $viewerClose.addEventListener("click", closeViewer);
  $viewerBackdrop.addEventListener("click", closeViewer);

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
  forceViewerClosedOnLoad();
  bindEvents();

  try {
    await loadList();
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("写真一覧の読み込みに失敗しました。\nlist url = " + jsonUrl());
  }

  setBulkBar();
  setBulkSaveButtonState("idle");
}

boot();
