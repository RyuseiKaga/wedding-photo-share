/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // .json無し
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

// 体感ほぼ変えず軽く（保存用＝view を使う）
const VIEW_TRANSFORM  = "c_limit,w_1600,q_auto:good,f_auto";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

// いいね取得
const LIKES_BATCH_SIZE = 120;

// 描画
const RENDER_CHUNK = 18;
const RESORT_DEBOUNCE_MS = 700;

// いいね：反映漏れ防止のため連打禁止
const LIKE_LOCK_MS = 900;

// ✅ 裏ダウンロード（選択時に仕込む）
const PREFETCH_CONCURRENCY = 3;       // 並列DL数（上げると速いが不安定になりやすい）
const PREFETCH_TIMEOUT_MS = 90000;    // 1枚のDLタイムアウト
const PREFETCH_USE_ORIGINAL = false;  // trueにすると原寸を取りに行く（重くなりがち）

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
let allPhotos = []; // [{id, version, format, thumb, view, original}]
let renderIndex = 0;

const selected = new Set(); // photo.id
const likes = new Map();    // photo.id -> number

let io = null;
let viewerLoadToken = 0;
let resortTimer = null;

const likeLocks = new Map(); // id -> unlock time(ms)

// id -> { card, likeBtn, countEl, cb, photo }
const uiById = new Map();

// ✅ TOP入れ替え検出用
let lastTopId = null;

// ✅ リロード/再描画で演出が消える対策（“発火予約”）
const PENDING_LIKE_GLOW_KEY = "wedding_pending_like_glow_v1";
const PENDING_TOP_SWAP_KEY  = "wedding_pending_top_swap_v1";

/**
 * ✅ 裏DL（prefetch）
 *  - entries: id -> { state, file, error, controller, url }
 *  - queue: ids待ち行列
 */
const prefetch = {
  entries: new Map(), // id -> entry
  queue: [],
  active: 0,
};

/* =========================
   Hardening: [hidden] を強制で効かせる
========================= */
(function enforceHiddenCSS() {
  const st = document.createElement("style");
  st.textContent = `[hidden]{ display:none !important; }`;
  document.head.appendChild(st);
})();

/* =========================
   Utils
========================= */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

function isLikelyTouchDevice() {
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   ✅ Pending Effects（再描画/リロードでも演出を出す）
========================= */
function setPendingEffect(key, payload) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...payload, t: Date.now() }));
  } catch {}
}
function consumePendingEffect(key, maxAgeMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const obj = JSON.parse(raw);
    if (!obj?.t || (Date.now() - obj.t) > maxAgeMs) return null;
    return obj;
  } catch {
    try { sessionStorage.removeItem(key); } catch {}
    return null;
  }
}
function applyPendingEffectsAfterRender() {
  // レンダリング直後に1回だけ実行（TOP/likeボタンDOMが出来てから）
  requestAnimationFrame(() => {
    // like glow（最大30秒まで）
    const pl = consumePendingEffect(PENDING_LIKE_GLOW_KEY, 30000);
    if (pl?.id) {
      // もう一度ふわっと光らせる（再描画で消えてもOK）
      pulseLikeGlow(pl.id);
    }

    // top swap（最大60秒まで）
    const pt = consumePendingEffect(PENDING_TOP_SWAP_KEY, 60000);
    if (pt?.id) {
      // 現在のTOPが一致している時だけ
      const topNow = allPhotos[0]?.id || null;
      if (topNow && topNow === pt.id) {
        triggerTopSwapUltra(pt.id);
      }
    }
  });
}

/* =========================
   Overlay（任意：使わないならそのままでOK）
========================= */
function showOverlay(title, sub, progressText = "") {
  if (!$overlay) return;
  $overlayTitle.textContent = title || "処理中…";
  $overlaySub.textContent = sub || "しばらくお待ちください";
  $overlayProgress.textContent = progressText || "";

  $overlay.hidden = false;
  $overlay.style.display = "flex";
  $overlay.style.pointerEvents = "auto";
  document.body.classList.add("is-busy");
}

function updateOverlay(progressText) {
  if (!$overlayProgress) return;
  $overlayProgress.textContent = progressText || "";
}

function forceHideOverlay() {
  if (!$overlay) return;
  $overlay.hidden = true;
  $overlay.style.display = "none";
  $overlay.style.pointerEvents = "none";
  document.body.classList.remove("is-busy");
}

async function withOverlay(title, sub, taskFn) {
  showOverlay(title, sub, "");
  try {
    return await taskFn();
  } finally {
    forceHideOverlay();
    requestAnimationFrame(() => requestAnimationFrame(forceHideOverlay));
    setTimeout(forceHideOverlay, 50);
  }
}

/* =========================
   Bulk bar state（✅ ここが肝）
========================= */
function getPrefetchStatsForSelected() {
  let total = selected.size;
  let ready = 0;
  let downloading = 0;
  let error = 0;

  for (const id of selected) {
    const e = prefetch.entries.get(id);
    if (!e) continue;
    if (e.state === "ready") ready++;
    else if (e.state === "downloading" || e.state === "queued") downloading++;
    else if (e.state === "error") error++;
  }
  return { total, ready, downloading, error };
}

function setBulkBar() {
  const n = selected.size;
  $selectedCount.textContent = String(n);
  $bulkBar.hidden = (n === 0);

  if (!$bulkSave) return;

  if (n === 0) {
    $bulkSave.disabled = true;
    $bulkSave.textContent = "一括保存（カメラロール）";
    return;
  }

  const st = getPrefetchStatsForSelected();

  // ✅ ダウンロード中は非活性
  if (st.downloading > 0) {
    $bulkSave.disabled = true;
    $bulkSave.textContent = `準備中… ${st.ready}/${st.total}`;
    return;
  }

  // ✅ 失敗があるとき
  if (st.error > 0) {
    $bulkSave.disabled = false;
    $bulkSave.textContent = `一括保存（再準備あり）`;
    return;
  }

  $bulkSave.disabled = (st.ready !== st.total);
  $bulkSave.textContent = "一括保存（カメラロール）";
}

/* =========================
   ✅ 選択を全解除（保存成功後に呼ぶ）
========================= */
function clearAllSelections() {
  // 選択を消す
  selected.clear();

  // UIのチェックも外す
  for (const [, ui] of uiById) {
    if (ui?.cb) ui.cb.checked = false;
  }

  // prefetchの準備済みファイルを解放（メモリ節約）
  // ※ entries自体は残してOKだが、fileは解放する
  for (const [id, e] of prefetch.entries) {
    if (!e) continue;
    // キューに残っているものは除去
    if (e.state === "queued") {
      prefetch.queue = prefetch.queue.filter(x => x !== id);
      e.state = "idle";
    }
    // DL中なら中断
    if (e.state === "downloading" && e.controller) {
      try { e.controller.abort(); } catch {}
      e.controller = null;
      e.state = "idle";
    }
    // ready/error もファイルを捨てる
    e.file = null;
    e.error = null;
    if (e.state !== "downloading") e.state = "idle";
  }

  setBulkBar();
}

/* =========================
   Viewer（勝手に出ない）
========================= */
function hardCloseViewer() {
  if (!$viewer) return;
  $viewer.hidden = true;
  $viewer.style.display = "none";
  if ($viewerLoading) $viewerLoading.hidden = true;
  if ($viewerImg) $viewerImg.removeAttribute("src");
  viewerLoadToken++;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function bindLifecycleGuards() {
  window.addEventListener("pageshow", () => {
    hardCloseViewer();
    forceHideOverlay();
    setBulkBar();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      hardCloseViewer();
      forceHideOverlay();
      setBulkBar();
    }
  });
  window.addEventListener("focus", () => {
    hardCloseViewer();
    forceHideOverlay();
    setBulkBar();
  });
}

function preloadImage(url, timeoutMs = 60000) {
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

  $viewer.style.display = "";
  $viewer.hidden = false;

  if ($viewerLoading) $viewerLoading.hidden = false;
  if ($viewerImg) $viewerImg.removeAttribute("src");

  if ($viewerOpen) $viewerOpen.href = photo.original;
  if ($viewerCopy) $viewerCopy.dataset.url = photo.original;

  const token = ++viewerLoadToken;
  const hiUrl = photo.view;

  try {
    await preloadImage(hiUrl, 60000);
    if (token !== viewerLoadToken) return;

    if ($viewerImg) {
      $viewerImg.src = hiUrl;
      if ($viewerImg.decode) {
        try { await $viewerImg.decode(); } catch {}
      }
    }
  } catch {
    if (token !== viewerLoadToken) return;
    if ($viewerImg) $viewerImg.src = photo.thumb;
  } finally {
    if (token !== viewerLoadToken) return;
    if ($viewerLoading) $viewerLoading.hidden = true;
  }
}

/* =========================
   Likes API
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
  } catch {}

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
  } catch {}
}

function updateLikeUI(id, count) {
  const ui = uiById.get(id);
  if (ui?.countEl) ui.countEl.textContent = String(count ?? 0);
}

function setLikeButtonDisabled(id, disabled) {
  const ui = uiById.get(id);
  if (!ui?.likeBtn) return;
  ui.likeBtn.disabled = !!disabled;
  ui.likeBtn.classList.toggle("is-locked", !!disabled);
}

/* =========================
   ✅ いいね：ふわっと光る（CSSの .like-btn.like-glow を使う）
========================= */
function pulseLikeGlow(id) {
  const ui = uiById.get(id);
  if (!ui?.likeBtn) return;

  ui.likeBtn.classList.remove("like-glow");
  void ui.likeBtn.offsetWidth; // reflow で連続発火できるように
  ui.likeBtn.classList.add("like-glow");

  // CSS側のアニメ時間に合わせて掃除
  setTimeout(() => {
    try { ui.likeBtn.classList.remove("like-glow"); } catch {}
  }, 750);
}

function scheduleResort() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerender();
  }, RESORT_DEBOUNCE_MS);
}

async function postLike(id) {
  const now = Date.now();
  const until = likeLocks.get(id) || 0;
  if (now < until) return;

  likeLocks.set(id, now + LIKE_LOCK_MS);
  setLikeButtonDisabled(id, true);

  // ✅ 先に演出（＋再描画/リロードで消えても出せるように予約）
  pulseLikeGlow(id);
  setPendingEffect(PENDING_LIKE_GLOW_KEY, { id });

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
      const data = await res.json();
      const serverCount =
        (typeof data?.likes === "number" && data.likes) ||
        (typeof data?.count === "number" && data.count) ||
        (typeof data?.value === "number" && data.value) ||
        (typeof data === "number" && data);

      if (typeof serverCount === "number") {
        likes.set(id, serverCount);
        updateLikeUI(id, serverCount);
      }
      scheduleResort();
    }
  } catch {} finally {
    const remaining = Math.max(0, (likeLocks.get(id) || 0) - Date.now());
    setTimeout(() => {
      likeLocks.delete(id);
      setLikeButtonDisabled(id, false);
    }, remaining);
  }
}

/* =========================
   ✅ TOP swap ULTRA（2位→1位に入れ替わった時だけ）
   - .top-swap-ultra クラス + .confetti を一時生成
========================= */
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
    try { card.classList.remove("top-swap-ultra"); } catch {}
    const c = card.querySelector(".confetti");
    if (c) c.remove();
  }, 1700);
}

/* =========================
   Prefetch（✅ 選択時に裏DL）
========================= */
function getPhotoById(id) {
  return allPhotos.find(p => p.id === id);
}

function getPrefetchUrl(photo) {
  if (!photo) return "";
  if (PREFETCH_USE_ORIGINAL) return photo.original;
  return photo.view;
}

function guessExtFromBlob(blob) {
  const t = (blob?.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic") || t.includes("heif")) return "heic";
  return "jpg";
}

async function fetchBlobWithTimeout(url, timeoutMs, controller) {
  const ctrl = controller || new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await res.blob();
  } finally {
    clearTimeout(t);
  }
}

function ensurePrefetchEntry(id) {
  let e = prefetch.entries.get(id);
  if (!e) {
    e = { id, state: "idle", file: null, error: null, controller: null, url: "" };
    prefetch.entries.set(id, e);
  }
  return e;
}

function enqueuePrefetch(id) {
  const photo = getPhotoById(id);
  if (!photo) return;

  const e = ensurePrefetchEntry(id);
  if (e.state === "ready" || e.state === "downloading" || e.state === "queued") return;

  e.state = "queued";
  e.error = null;
  e.file = null;
  e.url = getPrefetchUrl(photo);

  prefetch.queue.push(id);
  pumpPrefetchQueue();
  setBulkBar();
}

function abortPrefetchIfAny(id) {
  const e = prefetch.entries.get(id);
  if (!e) return;

  if (e.state === "queued") {
    prefetch.queue = prefetch.queue.filter(x => x !== id);
    e.state = "idle";
  }

  if (e.state === "downloading" && e.controller) {
    try { e.controller.abort(); } catch {}
    e.controller = null;
    e.state = "idle";
  }

  if (e.state === "ready") {
    e.file = null;
    e.state = "idle";
  }

  setBulkBar();
}

async function runPrefetchOne(id) {
  const photo = getPhotoById(id);
  const e = ensurePrefetchEntry(id);

  if (!photo) {
    e.state = "error";
    e.error = "photo missing";
    return;
  }
  if (!selected.has(id)) {
    e.state = "idle";
    return;
  }

  e.state = "downloading";
  e.error = null;
  e.controller = new AbortController();

  try {
    const blob = await fetchBlobWithTimeout(e.url, PREFETCH_TIMEOUT_MS, e.controller);

    if (!selected.has(id)) {
      e.file = null;
      e.state = "idle";
      return;
    }

    const ext = guessExtFromBlob(blob);
    const safeIdx = Array.from(selected).indexOf(id) + 1;
    const name = `photo_${safeIdx}_${id.slice(-6)}.${ext}`;

    e.file = new File([blob], name, { type: blob.type || "image/jpeg" });
    e.state = "ready";
  } catch (err) {
    if (err?.name === "AbortError") {
      e.state = "idle";
      e.error = "aborted";
    } else {
      e.state = "error";
      e.error = String(err?.message || err);
      console.warn("prefetch failed:", id, err);
    }
  } finally {
    e.controller = null;
  }
}

function pumpPrefetchQueue() {
  while (prefetch.active < PREFETCH_CONCURRENCY && prefetch.queue.length > 0) {
    const id = prefetch.queue.shift();
    const e = prefetch.entries.get(id);
    if (!e) continue;
    if (!selected.has(id)) { e.state = "idle"; continue; }

    prefetch.active++;
    runPrefetchOne(id)
      .catch(() => {})
      .finally(() => {
        prefetch.active--;
        pumpPrefetchQueue();
        setBulkBar();
      });
  }
}

/* =========================
   Share（✅ 事前DL済みfilesを使う）
========================= */
async function shareFilesIfPossible(files) {
  if (!navigator.canShare || !navigator.share) return false;
  try {
    if (!navigator.canShare({ files })) return false;
    await navigator.share({
      title: "Wedding Photos",
      text: "写真を保存してください",
      files,
    });
    return true;
  } catch (e) {
    console.warn("share canceled/failed:", e);
    return false;
  }
}

function buildFilesFromPrefetchSelected() {
  const ids = Array.from(selected);
  const files = [];
  const missing = [];
  const errors = [];

  for (const id of ids) {
    const e = prefetch.entries.get(id);
    if (!e) { missing.push(id); continue; }
    if (e.state === "ready" && e.file) files.push(e.file);
    else if (e.state === "error") errors.push(id);
    else missing.push(id);
  }
  return { files, missing, errors };
}

/* =========================
   Render
========================= */
function buildPhotoCard(photo, isTop = false) {
  const card = document.createElement("div");
  card.className = isTop ? "card card--top like-glow-scope" : "card like-glow-scope";
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
    if (cb.checked) {
      selected.add(photo.id);
      enqueuePrefetch(photo.id);
    } else {
      selected.delete(photo.id);
      abortPrefetchIfAny(photo.id);
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
  likeBtn.innerHTML = `❤ <span class="like-count">${likes.get(photo.id) || 0}</span>`;
  likeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    postLike(photo.id);
  });

  const countEl = likeBtn.querySelector(".like-count");
  meta.appendChild(likeBtn);

  card.appendChild(tile);
  card.appendChild(meta);

  uiById.set(photo.id, { card, likeBtn, countEl, cb, photo });

  const locked = (likeLocks.get(photo.id) || 0) > Date.now();
  if (locked) setLikeButtonDisabled(photo.id, true);

  if (selected.has(photo.id)) enqueuePrefetch(photo.id);

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

function resortByLikesAndRerender() {
  const prevTop = lastTopId;

  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  const nextTop = allPhotos[0]?.id || null;
  lastTopId = nextTop;

  $gallery.innerHTML = "";
  uiById.clear();
  renderIndex = 0;

  renderNextChunk();
  setupInfiniteScroll();
  setBulkBar();

  // ✅ 2位が1位を超えた時だけ（TOPが変わった時だけ）演出
  if (prevTop && nextTop && prevTop !== nextTop) {
    // 再描画/リロードで消えてもOKなように予約
    setPendingEffect(PENDING_TOP_SWAP_KEY, { id: nextTop });

    // 今の描画が完了してから発火
    requestAnimationFrame(() => triggerTopSwapUltra(nextTop));
  }

  // 予約していた演出があれば、ここでも拾える
  applyPendingEffectsAfterRender();
}

/* =========================
   Load List
========================= */
async function loadList() {
  await withOverlay("読み込み中…", "いいねを取得して並び替えています", async () => {
    const res = await fetch(jsonUrl(), { cache: "no-store" });
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

    const ids = allPhotos.map(p => p.id);
    const batches = chunk(ids, LIKES_BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
      updateOverlay(`${Math.min((i + 1) * LIKES_BATCH_SIZE, ids.length)} / ${ids.length}`);
      await fetchLikesBatch(batches[i]);
      await sleep(0);
    }

    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
    lastTopId = allPhotos[0]?.id || null;

    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;

    renderNextChunk();
    setupInfiniteScroll();

    // ✅ リロード/再描画で消えた演出があればここで復元
    applyPendingEffectsAfterRender();
  });
}

/* =========================
   Upload
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  await withOverlay("アップロード中…", "しばらくお待ちください", async () => {
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      updateOverlay(`${i + 1} / ${files.length}`);

      const file = files[i];
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
      uploaded.push({ public_id: data.public_id, version: data.version, format: data.format || "jpg" });
    }

    const newPhotos = uploaded.map(meta => {
      const m = { public_id: meta.public_id, version: meta.version, format: meta.format };
      return {
        id: meta.public_id,
        version: meta.version,
        format: meta.format,
        thumb: cldUrl(m, THUMB_TRANSFORM),
        view: cldUrl(m, VIEW_TRANSFORM),
        original: cldUrl(m, ""),
      };
    });

    for (const p of newPhotos) if (!likes.has(p.id)) likes.set(p.id, 0);

    allPhotos = [...newPhotos, ...allPhotos];
    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
    lastTopId = allPhotos[0]?.id || lastTopId;

    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;
    renderNextChunk();
    setupInfiniteScroll();

    // 念のため（予約演出があれば）
    applyPendingEffectsAfterRender();
  });
}

/* =========================
   Bulk Save（✅ 準備済みfilesで共有）
   ✅ 成功したら選択解除する
========================= */
async function bulkSaveSelected() {
  const n = selected.size;
  if (n === 0) return;

  const st = getPrefetchStatsForSelected();
  if (st.downloading > 0) {
    alert(`まだ準備中です… ${st.ready}/${st.total}`);
    return;
  }

  if (st.error > 0) {
    if (confirm("一部の画像の準備に失敗しました。再準備しますか？")) {
      for (const id of selected) {
        const e = prefetch.entries.get(id);
        if (e?.state === "error") {
          e.state = "idle";
          e.error = null;
          enqueuePrefetch(id);
        }
      }
      setBulkBar();
    }
    return;
  }

  const { files, missing } = buildFilesFromPrefetchSelected();
  if (missing.length > 0) {
    for (const id of missing) enqueuePrefetch(id);
    setBulkBar();
    alert("準備が不足していました。もう少し待ってから一括保存してください。");
    return;
  }

  // ✅ share成功したら選択解除
  const ok = await shareFilesIfPossible(files);
  if (ok) {
    clearAllSelections();
    return;
  }

  // フォールバック：順に開く（この場合は“保存成功”が判定できないので解除しない）
  if (isLikelyTouchDevice()) {
    alert("共有で一括保存できない端末でした。代わりにタブで画像を開きます。\n各画像を長押しして「写真に追加/画像を保存」してください。");
  }
  for (const id of Array.from(selected)) {
    const photo = getPhotoById(id);
    if (!photo) continue;
    window.open(photo.view, "_blank", "noopener");
    await sleep(350);
  }
}

/* =========================
   Events
========================= */
function bindEvents() {
  $fileInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    try {
      await uploadFiles(files);
    } catch (err) {
      console.error(err);
      forceHideOverlay();
      alert("アップロードに失敗しました。電波が弱い場合は枚数を減らして試してください。");
    }
  });

  $clearSelection?.addEventListener("click", () => {
    clearAllSelections();
  });

  $bulkSave?.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      alert("一括保存に失敗しました。通信が弱い場合は時間を置いて再試行してください。");
    } finally {
      setBulkBar();
    }
  });

  $viewerClose?.addEventListener("click", hardCloseViewer);
  $viewerBackdrop?.addEventListener("click", hardCloseViewer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $viewer && !$viewer.hidden) hardCloseViewer();
  });

  $viewerCopy?.addEventListener("click", async () => {
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
  hardCloseViewer();
  forceHideOverlay();

  bindEvents();
  bindLifecycleGuards();

  try {
    await loadList();
  } catch (e) {
    console.error(e);
    forceHideOverlay();
    alert("写真一覧の読み込みに失敗しました。\nlist url = " + jsonUrl());
  }

  setBulkBar();
}

boot();