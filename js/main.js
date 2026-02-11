/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // ✅ .json無し
const UPLOAD_PRESET = "wedding_unsigned";  // Cloudinary unsigned preset
const UPLOAD_FOLDER = "";                  // 使ってなければ空でOK

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev"; // Workers URL

// Cloudinary 変換（表示は軽く / 保存は“わからない程度に”高め）
const VIEW_TRANSFORM  = "c_limit,w_1800,q_auto:eco";                  // ビューア
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";      // サムネ（軽い）
const SAVE_TRANSFORM  = "c_limit,w_2400,q_auto:eco,f_jpg";            // 一括保存用（体感劣化少・速度優先）

// likes
const LIKES_BATCH_SIZE = 120;     // ✅ 大きめ（Worker側も0返し推奨）
const LIKES_PREFETCH   = 240;     // 初期に先読みする件数（体感のため）

// 無限スクロール
const RENDER_CHUNK = 18;

// アップロード制限（安定優先）
const UPLOAD_MAX_FILES_PER_BATCH = 10;

// いいね連打防止：サーバ反映まで押せない（最低待ち時間も）
const LIKE_LOCK_MIN_MS = 900;
const LIKE_REQUEST_TIMEOUT_MS = 12000;

// viewer
const HIRES_TIMEOUT_MS = 45000;

// 一括保存：Web Share（files）優先。無い場合はフォールバックで開く
const BULK_FALLBACK_OPEN_DELAY_MS = 350;

// ダウンロード（裏DL）同時数：多すぎると詰まる
const PRELOAD_CONCURRENCY = 3;

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
const $viewerBackdrop = $viewer?.querySelector(".viewer-backdrop");
const $viewerClose = document.getElementById("viewerClose");
const $viewerImg = document.getElementById("viewerImg");
const $viewerLoading = document.getElementById("viewerLoading");
const $viewerOpen = document.getElementById("viewerOpen");
const $viewerCopy = document.getElementById("viewerCopy");

/* =========================
   STATE
========================= */
let allPhotos = [];                // [{id, version, format, thumb, view, original, save}]
let renderIndex = 0;

const selected = new Set();        // photo.id
const likes = new Map();           // photo.id -> number

let io = null;
let viewerLoadToken = 0;
let lastTopId = null;

// UI参照（card, checkbox, likeCount, likeBtn）
const uiById = new Map(); // id -> {card, checkbox, likeBtn, likeCountEl}

// いいねロック
const likeLocks = new Map(); // id -> {lockedUntil:number, inflight:boolean}

// 裏DL（Blob）キャッシュ
const downloadCache = new Map(); // id -> { status:'pending'|'done'|'error', file?:File, promise?:Promise<File>, controller?:AbortController }

// 裏DLキュー
let preloadQueue = [];
let preloadActive = 0;

// toast
let $toast = null;

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

function ensureToast() {
  if ($toast) return;
  $toast = document.createElement("div");
  $toast.style.position = "fixed";
  $toast.style.left = "50%";
  $toast.style.bottom = "92px";
  $toast.style.transform = "translateX(-50%)";
  $toast.style.zIndex = "200";
  $toast.style.padding = "10px 12px";
  $toast.style.borderRadius = "999px";
  $toast.style.background = "rgba(17,24,39,.85)";
  $toast.style.color = "#fff";
  $toast.style.fontWeight = "800";
  $toast.style.fontSize = "13px";
  $toast.style.backdropFilter = "blur(10px)";
  $toast.style.webkitBackdropFilter = "blur(10px)";
  $toast.style.opacity = "0";
  $toast.style.pointerEvents = "none";
  $toast.style.transition = "opacity .18s ease";
  document.body.appendChild($toast);
}
let toastTimer = null;
function toast(msg, ms = 1400) {
  ensureToast();
  $toast.textContent = msg;
  $toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if ($toast) $toast.style.opacity = "0";
  }, ms);
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
  refreshBulkSaveState();
}

function isLikelyTouchDevice() {
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

/* =========================
   Viewer（起動時に勝手に開かない）
========================= */
function forceViewerClosedOnLoad() {
  if (!$viewer) return;
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function closeViewer() {
  if (!$viewer) return;
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
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
  if (!photo || !$viewer) return;

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
   Likes API（batch大きめ + ロック）
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
        // Worker側が0返ししてくれる想定。無ければ0にする
        likes.set(id, (typeof v === "number") ? v : 0);
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
      likes.set(id, (typeof v === "number") ? v : 0);
    }
  } catch (e) {}
}

function updateLikeUI(id, count) {
  const ui = uiById.get(id);
  if (ui?.likeCountEl) ui.likeCountEl.textContent = String(count ?? 0);
}

function setLikeButtonDisabled(id, disabled) {
  const ui = uiById.get(id);
  if (!ui?.likeBtn) return;
  ui.likeBtn.disabled = !!disabled;
}

function playLikeGlow(id) {
  const ui = uiById.get(id);
  if (!ui?.likeBtn) return;
  ui.likeBtn.classList.remove("like-glow");
  void ui.likeBtn.offsetWidth;
  ui.likeBtn.classList.add("like-glow");
  setTimeout(() => ui.likeBtn?.classList.remove("like-glow"), 700);
}

async function postLike(id) {
  const now = Date.now();
  const lock = likeLocks.get(id);

  // ロック中は無視
  if (lock?.inflight || (lock?.lockedUntil && lock.lockedUntil > now)) return;

  likeLocks.set(id, { inflight: true, lockedUntil: now + LIKE_LOCK_MIN_MS });
  setLikeButtonDisabled(id, true);
  playLikeGlow(id);

  // UIは “増えた気分” を出しつつ、最終はサーバ値に合わせる
  const before = likes.get(id) || 0;
  const optimistic = before + 1;
  likes.set(id, optimistic);
  updateLikeUI(id, optimistic);

  try {
    const req = fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const res = await withTimeout(req, LIKE_REQUEST_TIMEOUT_MS, "like request timeout");
    if (!res.ok) throw new Error(`like bad status ${res.status}`);

    const data = await res.json().catch(() => ({}));
    const serverCount =
      (typeof data?.likes === "number" && data.likes) ||
      (typeof data?.count === "number" && data.count) ||
      (typeof data?.value === "number" && data.value) ||
      (typeof data === "number" && data);

    // サーバが返せない形なら optimistic のままでもいいが、基本合わせる
    if (typeof serverCount === "number") {
      likes.set(id, serverCount);
      updateLikeUI(id, serverCount);
    }

    scheduleResortUltra(); // いいね順の並び替え（1位入れ替え演出つき）
  } catch (e) {
    console.warn("like failed:", e);

    // 反映漏れが嫌という話だったので、失敗時は「増えた表示」を戻す
    // （サーバ反映されてない可能性が高いため）
    likes.set(id, before);
    updateLikeUI(id, before);
    toast("通信が不安定です。もう一度押してね");
  } finally {
    // ロック解除（最低待ち時間は担保）
    const st = likeLocks.get(id) || {};
    const wait = Math.max(0, (st.lockedUntil || 0) - Date.now());
    await sleep(wait);

    likeLocks.set(id, { inflight: false, lockedUntil: 0 });
    setLikeButtonDisabled(id, false);
  }
}

/* =========================
   Sort / TOP swap ULTRA
========================= */
let resortTimer = null;
function scheduleResortUltra() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerenderUltra();
  }, 500);
}

function triggerTopSwapUltra(topId) {
  const ui = uiById.get(topId);
  const card = ui?.card;
  if (!card) return;

  // ① クラスで豪華アニメ発火
  card.classList.remove("top-swap-ultra");
  void card.offsetWidth;
  card.classList.add("top-swap-ultra");

  // ② 紙吹雪DOMを一時生成（軽量）
  const old = card.querySelector(".confetti");
  if (old) old.remove();

  const confetti = document.createElement("div");
  confetti.className = "confetti";

  const N = 18;
  for (let i = 0; i < N; i++) {
    const p = document.createElement("i");
    p.className = ["c1","c2","c3","c4","c5"][i % 5];

    p.style.left = `${Math.random() * 100}%`;

    const w = 6 + Math.random() * 6;
    const h = 8 + Math.random() * 10;
    p.style.width = `${w}px`;
    p.style.height = `${h}px`;
    p.style.borderRadius = `${1 + Math.random() * 3}px`;

    const dur = 750 + Math.random() * 650;
    const delay = Math.random() * 120;
    p.style.animation = `${(i % 2 === 0) ? "confettiFall" : "confettiFall2"} ${dur}ms ease-out ${delay}ms forwards`;

    confetti.appendChild(p);
  }

  card.appendChild(confetti);

  // ③ お掃除
  setTimeout(() => {
    card.classList.remove("top-swap-ultra");
    const c = card.querySelector(".confetti");
    if (c) c.remove();
  }, 1700);
}

function resortByLikesAndRerenderUltra() {
  const prevTop = lastTopId;

  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  const nextTop = allPhotos[0]?.id || null;
  lastTopId = nextTop;

  // 再描画（無限スクロール維持）
  $gallery.innerHTML = "";
  uiById.clear();
  renderIndex = 0;

  renderNextChunk();
  setupInfiniteScroll();
  setBulkBar();

  if (prevTop && nextTop && prevTop !== nextTop) {
    requestAnimationFrame(() => {
      triggerTopSwapUltra(nextTop);
    });
  }
}

/* =========================
   Render（CSSの .card/.tile 構造に合わせる）
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
  img.decoding = "async";
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
    if (cb.checked) {
      selected.add(photo.id);
      enqueuePreloadForId(photo.id); // ✅ 選択した瞬間に裏DL
    } else {
      selected.delete(photo.id);
      // 解除時：DL中なら中断（できる範囲で）
      cancelPreloadIfPending(photo.id);
    }
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

  const likeCount = likes.get(photo.id) || 0;
  likeBtn.innerHTML = `❤ <span class="like-count" data-like-count="${photo.id}">${likeCount}</span>`;

  const likeCountEl = likeBtn.querySelector(`[data-like-count="${photo.id}"]`);

  likeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    postLike(photo.id);
  });

  meta.appendChild(likeBtn);

  card.appendChild(tile);
  card.appendChild(meta);

  uiById.set(photo.id, { card, checkbox: cb, likeBtn, likeCountEl });

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
   Cloudinary list load
   - まず list 取得
   - likes を先読みしてソート
   - 描画
========================= */
async function loadList() {
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);
  const data = await res.json();
  const resources = Array.isArray(data?.resources) ? data.resources : [];

  // 最新順の保険（version大きいほど新しい）
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
      original: cldUrl(meta, ""),              // 原寸（変換なし）
      save: cldUrl(meta, SAVE_TRANSFORM),      // ✅ 一括保存用（軽く＆十分きれい）
    };
  });

  // likes先読み（初期表示の体感を崩さず “並び替え” を成立させる）
  const ids = allPhotos.map(p => p.id);

  // 先頭だけ先にlikes取る（初期に見える範囲を優先）
  const pre = ids.slice(0, Math.min(LIKES_PREFETCH, ids.length));
  for (const batch of chunk(pre, LIKES_BATCH_SIZE)) {
    await fetchLikesBatch(batch);
  }

  // 一旦ソートして描画
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  $gallery.innerHTML = "";
  uiById.clear();
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
  lastTopId = allPhotos[0]?.id || null;

  hideOverlay();

  // 残りのlikesは裏で取得 → 最後にもう一回だけ整列（重くしない）
  const rest = ids.slice(pre.length);
  if (rest.length) {
    (async () => {
      for (const batch of chunk(rest, LIKES_BATCH_SIZE)) {
        await fetchLikesBatch(batch);
      }
      // 並び替え（1位入れ替え演出は“初回裏更新”ではうるさいので抑制）
      const prevTop = lastTopId;
      allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
      lastTopId = allPhotos[0]?.id || null;

      // 画面上のlike数を更新（再描画せず軽く）
      // ※ ただし順序が変わるので、軽く再描画する（無限スクロール維持）
      $gallery.innerHTML = "";
      uiById.clear();
      renderIndex = 0;
      renderNextChunk();
      setupInfiniteScroll();
      setBulkBar();

      // 初回ロードの裏更新ではエフェクト無し（必要なら有効化OK）
      if (prevTop && lastTopId && prevTop !== lastTopId) {
        // ここで演出したければ↓を有効化
        // triggerTopSwapUltra(lastTopId);
      }
    })().catch(() => {});
  }
}

/* =========================
   Upload（複数でも安定するよう制限）
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  const list = files.slice(0, UPLOAD_MAX_FILES_PER_BATCH);

  showOverlay(
    "アップロード中…",
    `※ 安定のため最大 ${UPLOAD_MAX_FILES_PER_BATCH} 枚まで`,
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

  // list json 反映待ちに依存しない “即時反映”
  const newPhotos = uploaded.map(meta => {
    const m = { public_id: meta.public_id, version: meta.version, format: meta.format };
    return {
      id: meta.public_id,
      version: meta.version,
      format: meta.format,
      thumb: cldUrl(m, THUMB_TRANSFORM),
      view: cldUrl(m, VIEW_TRANSFORM),
      original: cldUrl(m, ""),
      save: cldUrl(m, SAVE_TRANSFORM),
    };
  });

  for (const p of newPhotos) likes.set(p.id, likes.get(p.id) || 0);

  allPhotos = [...newPhotos, ...allPhotos];
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
  lastTopId = allPhotos[0]?.id || lastTopId;

  $gallery.innerHTML = "";
  uiById.clear();
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
  setBulkBar();

  hideOverlay();

  toast("アップロード完了");
}

/* =========================
   裏DL（選択した瞬間に実行）
   - 同時数を制御
   - DL中は一括保存ボタンを無効化
========================= */
function cancelPreloadIfPending(id) {
  const item = downloadCache.get(id);
  if (item?.status === "pending" && item.controller) {
    try { item.controller.abort(); } catch {}
    downloadCache.delete(id);
  }
  refreshBulkSaveState();
}

function enqueuePreloadForId(id) {
  // 既にdoneなら何もしない
  const cached = downloadCache.get(id);
  if (cached?.status === "done") {
    refreshBulkSaveState();
    return;
  }
  // pendingなら重ねない
  if (cached?.status === "pending") {
    refreshBulkSaveState();
    return;
  }

  preloadQueue.push(id);
  pumpPreloadQueue();
  refreshBulkSaveState();
}

function pumpPreloadQueue() {
  while (preloadActive < PRELOAD_CONCURRENCY && preloadQueue.length > 0) {
    const id = preloadQueue.shift();
    if (!selected.has(id)) continue; // もう解除されてたらスキップ
    startPreload(id);
  }
}

function startPreload(id) {
  const photo = allPhotos.find(p => p.id === id);
  if (!photo) return;

  const controller = new AbortController();
  preloadActive++;

  const p = (async () => {
    const url = photo.save || photo.view || photo.original;
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`download bad status ${res.status}`);

    const blob = await res.blob();

    // ファイル名（写真っぽく）
    const safeId = (id.split("/").pop() || id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const ext = "jpg";
    const file = new File([blob], `${safeId}.${ext}`, { type: blob.type || "image/jpeg" });

    return file;
  })();

  downloadCache.set(id, { status: "pending", promise: p, controller });

  p.then(file => {
    downloadCache.set(id, { status: "done", file });
  }).catch(err => {
    if (err?.name === "AbortError") {
      // 解除されたので無視
      return;
    }
    console.warn("preload failed:", id, err);
    downloadCache.set(id, { status: "error" });
  }).finally(() => {
    preloadActive--;
    pumpPreloadQueue();
    refreshBulkSaveState();
  });
}

function refreshBulkSaveState() {
  // 選択が無いならdisabled
  if (selected.size === 0) {
    $bulkSave.disabled = true;
    $bulkSave.textContent = "一括保存（カメラロール）";
    return;
  }

  // 選択分のうち pending があるならdisabled + 表示
  let pending = 0;
  let done = 0;
  let error = 0;

  for (const id of selected) {
    const st = downloadCache.get(id)?.status;
    if (st === "pending") pending++;
    else if (st === "done") done++;
    else if (st === "error") error++;
    else {
      // 未開始ならキュー投入
      enqueuePreloadForId(id);
      pending++;
    }
  }

  if (pending > 0) {
    $bulkSave.disabled = true;
    $bulkSave.textContent = `保存準備中… (${done}/${selected.size})`;
    return;
  }

  if (error > 0) {
    // エラーがあると共有に混ぜると失敗しがちなので、まず再DLを促す
    $bulkSave.disabled = false;
    $bulkSave.textContent = `一括保存（${selected.size}枚）※一部失敗`;
    return;
  }

  // 全部done
  $bulkSave.disabled = false;
  $bulkSave.textContent = `一括保存（${selected.size}枚）`;
}

/* =========================
   Bulk Save（共有シートで “画像を保存” を出す）
========================= */
function canShareFiles() {
  return !!(navigator.share && navigator.canShare);
}

async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  // まだ準備中なら待つ（押した瞬間に固める）
  showOverlay("保存準備中…", "画像を集めています", `0 / ${ids.length}`);

  const files = [];
  let ok = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];

    // 必ずDL開始
    enqueuePreloadForId(id);

    const item = downloadCache.get(id);
    try {
      const file =
        item?.status === "done" ? item.file :
        item?.promise ? await item.promise :
        null;

      if (file) {
        files.push(file);
        ok++;
        updateOverlay(`${ok} / ${ids.length}`);
      }
    } catch (e) {
      console.warn("download wait failed:", id, e);
    }
  }

  hideOverlay();

  if (files.length === 0) {
    toast("保存用の画像が準備できませんでした");
    return;
  }

  // ✅ iPhoneの共有（ここに「画像を保存」が出る）
  if (canShareFiles() && navigator.canShare({ files })) {
    try {
      await navigator.share({
        files,
        title: "Wedding Photos",
        text: "写真を保存",
      });

      // ✅ 共有成功 → 選択解除
      clearSelectionAfterSuccess();
      toast("保存の共有を開きました");
      return;
    } catch (e) {
      // キャンセル時は解除しない
      if (e?.name === "AbortError") {
        toast("キャンセルしました");
        return;
      }
      console.warn("share failed:", e);
      toast("共有が開けなかったので別方式で開きます");
      // fallthrough
    }
  }

  // フォールバック：タブで開く（端末制限あり）
  await fallbackOpenForSave(ids);
}

function clearSelectionAfterSuccess() {
  selected.clear();

  // チェックを外す
  for (const [id, ui] of uiById.entries()) {
    if (ui?.checkbox) ui.checkbox.checked = false;
  }
  setBulkBar();
}

async function fallbackOpenForSave(ids) {
  // なるべく“保存できる原寸URL”を開く
  let opened = 0;
  for (const id of ids) {
    const photo = allPhotos.find(p => p.id === id);
    if (!photo) continue;
    window.open(photo.original, "_blank", "noopener");
    opened++;
    await sleep(BULK_FALLBACK_OPEN_DELAY_MS);
  }

  if (opened > 0 && isLikelyTouchDevice()) {
    alert("原寸画像を開きました。各タブで画像を長押しして「写真に追加/画像を保存」してください。");
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

  // Clear selection
  $clearSelection.addEventListener("click", () => {
    selected.clear();
    for (const [, ui] of uiById) {
      if (ui?.checkbox) ui.checkbox.checked = false;
    }
    // 途中DLは止める
    for (const [id, item] of downloadCache.entries()) {
      if (item?.status === "pending" && item.controller) {
        try { item.controller.abort(); } catch {}
      }
      downloadCache.delete(id);
    }
    preloadQueue = [];
    preloadActive = 0;

    setBulkBar();
    toast("選択解除しました");
  });

  // Bulk save
  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      alert("一括保存に失敗しました（端末制限の可能性）。");
    }
  });

  // Viewer close
  if ($viewerClose) $viewerClose.addEventListener("click", closeViewer);
  if ($viewerBackdrop) $viewerBackdrop.addEventListener("click", closeViewer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $viewer && !$viewer.hidden) closeViewer();
  });

  // URL copy
  if ($viewerCopy) {
    $viewerCopy.addEventListener("click", async () => {
      const url = $viewerCopy.dataset.url || "";
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        const old = $viewerCopy.textContent;
        $viewerCopy.textContent = "コピーしました";
        await sleep(800);
        $viewerCopy.textContent = old || "URLコピー";
      } catch {
        prompt("コピーしてね", url);
      }
    });
  }
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