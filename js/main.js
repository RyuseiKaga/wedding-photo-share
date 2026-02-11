/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // ✅ .json無し
const UPLOAD_PRESET = "wedding_unsigned";  // Cloudinary unsigned preset
const UPLOAD_FOLDER = "";                  // 使ってなければ空でOK

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev"; // Workers URL

// Cloudinary 変換
const VIEW_TRANSFORM  = "c_limit,w_1800,q_auto:eco";                 // 保存/閲覧用（軽め高画質）
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";     // サムネ

// 制限（安定優先）
const UPLOAD_MAX_FILES_PER_BATCH = 8;     // まとめてアップロード上限
const BULK_SAVE_MAX = 12;                 // ✅ ZIPなし一括保存の上限（iOS安定ライン）
const HIRES_TIMEOUT_MS = 45000;           // ビューアの高画質タイムアウト
const BULK_FETCH_TIMEOUT_MS = 25000;      // 一括保存の画像取得タイムアウト

// Likes 取得バッチ（要望：大きく）
const LIKES_BATCH_SIZE = 120;

// 初期表示の体感改善：一覧は先に出す（thumb）→ likes 取得後に並び替え
const INITIAL_RENDER_BEFORE_LIKES = true;

// いいね反映の戻り対策：サーバ値が小さく返ってもUIを戻さない
const APPLY_SERVER_LIKE_ONLY_IF_GREATER = true;

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

let resortTimer = null;

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

function safeNumber(n, fallback = 0) {
  return (typeof n === "number" && Number.isFinite(n)) ? n : fallback;
}

/* =========================
   Viewer（起動時に絶対開かない）
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

  $viewerOpen.href = photo.original;        // 原寸を開く（保存導線）
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
    $viewerImg.src = photo.thumb; // フォールバック
  } finally {
    if (token !== viewerLoadToken) return;
    $viewerLoading.hidden = true;
  }
}

/* =========================
   Likes API（頑丈に）
   - Worker側が「未登録IDは0」を返す前提でもOK
========================= */
async function fetchLikesBatch(ids) {
  if (!ids.length) return;

  // 1) POST /likes/batch
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
        else if (!likes.has(id)) likes.set(id, 0); // 保険
      }
      return;
    }
  } catch (e) {}

  // 2) GET /likes/batch?ids=...
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
  // 楽観更新（即反映）
  const current = safeNumber(likes.get(id), 0);
  const next = current + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  try {
    const res = await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) return;

    const data = await res.json();
    const serverCount =
      (typeof data?.likes === "number" && data.likes) ||
      (typeof data?.count === "number" && data.count) ||
      (typeof data?.value === "number" && data.value) ||
      (typeof data === "number" && data);

    if (typeof serverCount === "number") {
      if (APPLY_SERVER_LIKE_ONLY_IF_GREATER) {
        const localNow = safeNumber(likes.get(id), 0);
        if (serverCount > localNow) {
          likes.set(id, serverCount);
          updateLikeUI(id, serverCount);
        }
      } else {
        likes.set(id, serverCount);
        updateLikeUI(id, serverCount);
      }
    }

    scheduleResort();
  } catch (e) {
    // 通信失敗でもUIは維持
  }
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(safeNumber(count, 0));
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

  const likeCountValue = safeNumber(likes.get(photo.id), 0);
  likeBtn.innerHTML =
    `❤ <span class="like-count" data-like-count="${photo.id}">${likeCountValue}</span>`;

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
function scheduleResort() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerender();
  }, 700);
}

function resortByLikesAndRerender() {
  allPhotos.sort((a, b) => safeNumber(likes.get(b.id), 0) - safeNumber(likes.get(a.id), 0));

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
}

/* =========================
   Load Cloudinary list
   体感改善：
   - まず list を取って写真を表示（thumb）
   - その後 likes をまとめて取得→並び替え
========================= */
async function loadList() {
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);

  const data = await res.json();
  const resources = Array.isArray(data?.resources) ? data.resources : [];

  // 最新順（version大きいものが新しい）
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

  // likes の初期値（未取得は0表示）
  for (const p of allPhotos) {
    if (!likes.has(p.id)) likes.set(p.id, 0);
  }

  // 先に一覧を出す（初期表示高速化）
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  // ここで一旦オーバーレイを閉じて体感を良くする
  hideOverlay();

  // likesをまとめて取得して並び替え
  // ※ INITIAL_RENDER_BEFORE_LIKES=falseなら、ここまでoverlay出しっぱなしにもできる
  if (!INITIAL_RENDER_BEFORE_LIKES) {
    showOverlay("読み込み中…", "いいね数を取得しています", "");
  }

  const ids = allPhotos.map(p => p.id);
  const batches = chunk(ids, LIKES_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    if (!INITIAL_RENDER_BEFORE_LIKES) {
      updateOverlay(`${Math.min((i + 1) * LIKES_BATCH_SIZE, ids.length)} / ${ids.length}`);
    }
    await fetchLikesBatch(batches[i]);
  }

  // 並び替え＆再描画
  resortByLikesAndRerender();

  if (!INITIAL_RENDER_BEFORE_LIKES) hideOverlay();
}

/* =========================
   Upload（安定のため“数枚ずつ”）
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

  // 即時反映
  const newPhotos = uploaded.map(meta => ({
    id: meta.public_id,
    version: meta.version,
    format: meta.format,
    thumb: cldUrl(meta, THUMB_TRANSFORM),
    view: cldUrl(meta, VIEW_TRANSFORM),
    original: cldUrl(meta, ""),
  }));

  for (const p of newPhotos) {
    if (!likes.has(p.id)) likes.set(p.id, 0);
  }

  allPhotos = [...newPhotos, ...allPhotos];

  // 新規は0なので、既存のいいね順を崩さないならここで再ソート
  allPhotos.sort((a, b) => safeNumber(likes.get(b.id), 0) - safeNumber(likes.get(a.id), 0));

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Bulk Save（ZIPなし / 枚数制限あり）
   共有シートで「画像を保存」が出やすい：Web Share(files)
========================= */
async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  if (ids.length > BULK_SAVE_MAX) {
    alert(`一括保存は最大 ${BULK_SAVE_MAX} 枚までにしてください（端末制限対策）。`);
    return;
  }

  const canShareFiles =
    !!navigator.share &&
    typeof navigator.canShare === "function";

  showOverlay("一括保存の準備中…", "画像をまとめています（少し待ってね）", `0 / ${ids.length}`);

  const files = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      updateOverlay(`${i + 1} / ${ids.length}`);

      const photo = allPhotos.find(p => p.id === ids[i]);
      if (!photo) continue;

      // 原寸は重くて失敗しやすいので保存用は view 推奨
      const url = photo.view || photo.original;
      const file = await fetchImageAsFile(url, `photo_${i + 1}`);
      files.push(file);
    }

    hideOverlay();

    if (canShareFiles && navigator.canShare({ files })) {
      await navigator.share({
        files,
        title: "写真を保存",
        text: "「画像を保存」または「“ファイル”に保存」を選んでください",
      });
      return;
    }

    // フォールバック：従来のタブで開く
    for (const id of ids) {
      const photo = allPhotos.find(p => p.id === id);
      if (!photo) continue;
      window.open(photo.original, "_blank", "noopener");
      await sleep(450);
    }

    if (isLikelyTouchDevice()) {
      alert("この端末は“画像の一括共有”に非対応でした。各タブで画像を長押しして「写真に追加/画像を保存」してください。");
    }
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("一括保存の準備に失敗しました。枚数を減らして試してください。");
  }

  async function fetchImageAsFile(url, baseName) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BULK_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

      const blob = await res.blob();
      const ext = guessExt(blob.type) || "jpg";
      const type = blob.type || "image/jpeg";
      return new File([blob], `${baseName}.${ext}`, { type });
    } finally {
      clearTimeout(timer);
    }
  }

  function guessExt(mime) {
    if (!mime) return "";
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    return "";
  }
}

/* =========================
   Events
========================= */
function bindEvents() {
  // Upload
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

  // Bulk selection
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

  // Viewer close
  $viewerClose.addEventListener("click", closeViewer);
  $viewerBackdrop.addEventListener("click", closeViewer);

  // Esc close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$viewer.hidden) closeViewer();
  });

  // URL copy
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
}

boot();
