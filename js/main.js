/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // .json無し
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

// 結婚式終了時刻（JST）。この時刻を過ぎると特別モードへ
const WEDDING_END = new Date("2026-04-11T21:30:00+09:00");
function isPostWedding() {
  if (new URLSearchParams(location.search).get("preview") === "postwedding") return true;
  return Date.now() >= WEDDING_END.getTime();
}

// 結婚式で流した曲リスト（Spotify + Apple Music）
const WEDDING_TRACKS = [
  { id:"16z37gv2vAQF1mYLXY6NHr", itunes:"https://music.apple.com/jp/album/717125506?i=717126898",  name:"おさんぽクンクン",      artist:"Daisuke Yokoyama, Takumi Mitani", art:"https://i.scdn.co/image/ab67616d00001e028bed33a04132160cffcaa9c6" },
  { id:"068D6ROpy0TVujBDPKntVy", itunes:"https://music.apple.com/jp/album/1511080007?i=1511080015", name:"4645",                 artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e02f84ccff21745688370ce77ec" },
  { id:"5oA6WuNqODuCtRF3YCSoka", itunes:"https://music.apple.com/jp/album/1850882799?i=1850882800", name:"最大公約数",             artist:"SEKAI NO OWARI",                   art:"https://i.scdn.co/image/ab67616d00001e02ff5245568d6d4576a0f7dcdf" },
  { id:"3VfcTMAgdty9VYOgeuyqiN", itunes:"https://music.apple.com/jp/album/1475232910?i=1475233530", name:"CHEERS",               artist:"Mrs. GREEN APPLE",                art:"https://i.scdn.co/image/ab67616d00001e0281f55cd879e9480e3ed313df" },
  { id:"1huEH8RmhiCGB6M0iPYq6v", itunes:"https://music.apple.com/jp/album/1445035134?i=1445035144", name:"ソラシド",              artist:"GReeeeN",                         art:"https://i.scdn.co/image/ab67616d00001e026c3cd8f09d0e713dffc5e27b" },
  { id:"738jPe2gzSeNay3MouWSqO", itunes:"https://music.apple.com/jp/album/1659013026?i=1659013323", name:"チーズケーキ・ファクトリー", artist:"ELLEGARDEN",                      art:"https://i.scdn.co/image/ab67616d00001e026c795df60a32c2e9448a0cd9" },
  { id:"33o5B8veTEuqEzkcJrWnN2", itunes:"https://music.apple.com/jp/album/1577132552?i=1577132555", name:"TWILIGHT",             artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e02da5ad52eaad222720afcd788" },
  { id:"60MIUYWw2md2IlCQowA6sv", itunes:"https://music.apple.com/jp/album/1518843994?i=1518845173", name:"'I' Novel",            artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e021b70a19a834b7f15d33fe523" },
  { id:"699ku1Ebqi9pwi0IwnRPET", itunes:"https://music.apple.com/jp/album/1518516321?i=1518516324", name:"サイハテアイニ",          artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e023586e02986ded6e995a87cec" },
  { id:"4lqJviq0yaeYIcXkF6Br7F", itunes:"https://music.apple.com/jp/album/317980498?i=317980502",   name:"マジで感謝！",           artist:"T-Pistonz+KMC",                   art:"https://i.scdn.co/image/ab67616d00001e025ef149dc26fb1955fb633014" },
  { id:"7LwJEwrjYWX1uXzI8oIuZR", itunes:"https://music.apple.com/jp/album/1840600650?i=1840600926", name:"春風",                 artist:"3rd Sunday",                      art:"https://i.scdn.co/image/ab67616d00001e024538fb7e0425284c2f41d13f" },
  { id:"4UaWhczMjTpTaZvjgYfjCE", itunes:"https://music.apple.com/jp/album/1840600650?i=1840600990", name:"shed light on",        artist:"3rd Sunday",                      art:"https://i.scdn.co/image/ab67616d00001e024538fb7e0425284c2f41d13f" },
  { id:"26nwwSSmrHobQ5vi5kIxgU", itunes:"https://music.apple.com/jp/album/1840600650?i=1840600941", name:"Twilight",             artist:"3rd Sunday",                      art:"https://i.scdn.co/image/ab67616d00001e024538fb7e0425284c2f41d13f" },
  { id:"3XE1VB9SMnkOoj4f9s9MWk", itunes:"https://music.apple.com/jp/album/1840600650?i=1840600995", name:"Awkward",              artist:"3rd Sunday",                      art:"https://i.scdn.co/image/ab67616d00001e024538fb7e0425284c2f41d13f" },
  { id:"3cBpJn5WWYj0SMix7VSevV", itunes:"https://music.apple.com/jp/album/1839433378?i=1839433382", name:"週末グルーミー",          artist:"Saucy Dog",                       art:"https://i.scdn.co/image/ab67616d00001e0211bc128805fe58b82c59e76e" },
  { id:"7BBhAZPkDnJ6mYVua3O1F4", itunes:"https://music.apple.com/jp/album/1511080228?i=1511080505", name:"いいんですか?",           artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e02a2f4114eb1e98cafef5a3f3d" },
  { id:"1v7bzIjGsqshSjRG3Fe2CB", itunes:"https://music.apple.com/jp/album/1511080007?i=1511080463",  name:"トレモロ",              artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e02f84ccff21745688370ce77ec" },
  { id:"5NAtMtiyKLZFNDFHAtDrXj", itunes:"https://music.apple.com/jp/album/1511079462?i=1511080038", name:"ラストバージン",          artist:"RADWIMPS",                        art:"https://i.scdn.co/image/ab67616d00001e024490022d0f425aace1c49d83" },
];

const DELETED_PHOTOS_KEY = "wedding_deleted_v1";

// アップロード直後〜Cloudinaryリスト反映までの空白を埋めるキャッシュ
const UPLOAD_CACHE_KEY = "wedding_upload_cache_v1";

// いいね数ポーリング間隔（10秒）
const LIKES_POLL_MS = 10000;
// 新着写真チェック間隔（30秒）
const PHOTOS_POLL_MS = 30000;

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
const $galleryEmpty = document.getElementById("galleryEmpty");
const $fileInput = document.getElementById("fileInput");
const $sentinel = document.getElementById("sentinel");

const $bulkBar = document.getElementById("bulkBar");
const $selectedCount = document.getElementById("selectedCount");
const $clearSelection = document.getElementById("clearSelection");
const $bulkDelete = document.getElementById("bulkDelete");
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
const $photoCount   = document.getElementById("photoCount");
const $sortToggle   = document.getElementById("sortToggle");

/* =========================
   STATE
========================= */
let allPhotos = []; // [{id, version, format, thumb, view, original}]
let renderIndex = 0;

const selected = new Set(); // photo.id
const likes = new Map();    // photo.id -> number

// ✅ 削除済み写真（localStorageで永続化）
const deletedPhotos = new Set(
  (() => { try { return JSON.parse(localStorage.getItem(DELETED_PHOTOS_KEY) || "[]"); } catch { return []; } })()
);

let io = null;
let viewerLoadToken = 0;
let resortTimer = null;

const likeLocks = new Map(); // id -> unlock time(ms)

// id -> { card, likeBtn, countEl, cb, photo }
const uiById = new Map();

// ✅ TOP入れ替え検出用
let lastTopId = null;

// ソートモード: "likes" | "time"
let sortMode = "likes";

// ポーリング二重実行防止フラグ
let pollLikesRunning = false;
let pollNewPhotosRunning = false;

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
   Upload cache（Cloudinaryリスト反映待ち対策）
========================= */
function saveUploadCache(photos) {
  try {
    const existing = JSON.parse(localStorage.getItem(UPLOAD_CACHE_KEY) || "[]");
    const now = Date.now();
    // 24時間超えたエントリは捨てる
    const fresh = existing.filter(e => now - (e.t || 0) < 86400000);
    for (const p of photos) fresh.push({ ...p, t: now });
    localStorage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(fresh));
  } catch (e) {}
}

function mergeUploadCache(photos) {
  try {
    const raw = localStorage.getItem(UPLOAD_CACHE_KEY);
    if (!raw) return photos;
    const now = Date.now();
    const cached = JSON.parse(raw).filter(e => now - (e.t || 0) < 86400000);
    const listIds = new Set(photos.map(p => p.id));
    for (const e of cached) {
      if (!listIds.has(e.id) && !deletedPhotos.has(e.id)) {
        // キャッシュにあってリストに無い＝まだCloudinaryに反映されていない
        const { t, ...photo } = e;
        photos.push(photo);
      }
    }
    return photos;
  } catch (e) {
    return photos;
  }
}

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

function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

// Android 用: プリフェッチ済み File Blob を <a download> でダウンロード
async function downloadBlobFiles(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || `wedding_photo_${i + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    await sleep(600); // ブラウザの保存ダイアログが被らないよう間隔を空ける
    URL.revokeObjectURL(url);
  }
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
  requestAnimationFrame(() => {
    // like glow（最大30秒まで）
    const pl = consumePendingEffect(PENDING_LIKE_GLOW_KEY, 30000);
    if (pl?.id) {
      pulseLikeGlow(pl.id);
    }

    // top swap（最大60秒まで）※今は「再描画で消える」時の保険
    const pt = consumePendingEffect(PENDING_TOP_SWAP_KEY, 60000);
    if (pt?.id) {
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
  selected.clear();

  for (const [, ui] of uiById) {
    if (ui?.cb) ui.cb.checked = false;
  }

  for (const [id, e] of prefetch.entries) {
    if (!e) continue;

    if (e.state === "queued") {
      prefetch.queue = prefetch.queue.filter(x => x !== id);
      e.state = "idle";
    }

    if (e.state === "downloading" && e.controller) {
      try { e.controller.abort(); } catch {}
      e.controller = null;
      e.state = "idle";
    }

    e.file = null;
    e.error = null;
    if (e.state !== "downloading") e.state = "idle";
  }

  setBulkBar();
}

/* =========================
   空ギャラリー表示
========================= */
function updateEmptyState() {
  if (!$galleryEmpty) return;
  $galleryEmpty.hidden = (allPhotos.length > 0);
}

/* =========================
   ✅ 削除
========================= */
/* =========================
   ✅ 削除
   - サーバー（LIKE_API/hidden）に削除リストを同期する
   - Worker が /hidden に未対応の場合は localStorage のみで動作（フォールバック）
========================= */

/** サーバーから削除済みIDを取得してローカルとマージ */
async function syncDeletedFromServer() {
  try {
    const res = await fetch(`${LIKE_API}/hidden`, { cache: "no-store" });
    if (!res.ok) return; // Worker未対応の場合はスキップ
    const data = await res.json();
    const ids = Array.isArray(data?.ids) ? data.ids : [];
    for (const id of ids) deletedPhotos.add(id);
    saveDeletedPhotos(); // ローカルにも反映
  } catch (e) {
    // Worker未対応 or ネットワーク失敗 → ローカルのみで続行
  }
}

/** 削除済みIDをサーバーに送信 */
async function pushDeletedToServer(ids) {
  try {
    await fetch(`${LIKE_API}/hidden`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: Array.from(ids) }),
    });
  } catch (e) {
    // Worker未対応 or ネットワーク失敗 → ローカル保存のみで続行
  }
}

function saveDeletedPhotos() {
  try {
    localStorage.setItem(DELETED_PHOTOS_KEY, JSON.stringify(Array.from(deletedPhotos)));
  } catch (e) {}
}

function deleteSelectedPhotos() {
  const n = selected.size;
  if (n === 0) return;
  if (!confirm(`選択した ${n} 枚の写真をギャラリーから削除しますか？`)) return;

  const newlyDeleted = new Set();
  for (const id of selected) {
    deletedPhotos.add(id);
    newlyDeleted.add(id);
    const ui = uiById.get(id);
    if (ui?.card) ui.card.remove();
    uiById.delete(id);
  }

  allPhotos = allPhotos.filter(p => !deletedPhotos.has(p.id));

  // Bug fix: renderIndex を実際のDOM枚数に合わせる（スキップ防止）
  renderIndex = uiById.size;

  // Bug fix: 削除された写真が1位だった場合に lastTopId を更新
  if (deletedPhotos.has(lastTopId)) {
    lastTopId = allPhotos[0]?.id || null;
  }

  saveDeletedPhotos();
  pushDeletedToServer(newlyDeleted); // サーバーにも送信（失敗してもローカルは保持）
  updateEmptyState();
  updatePhotoCount();
  clearAllSelections();
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
  void ui.likeBtn.offsetWidth;
  ui.likeBtn.classList.add("like-glow");

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
      // Bug fix: || チェーンは 0（falsy）を無視するため三項演算子で抽出
      const serverCount =
        typeof data?.likes  === "number" ? data.likes  :
        typeof data?.count  === "number" ? data.count  :
        typeof data?.value  === "number" ? data.value  :
        typeof data         === "number" ? data         : null;

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
========================= */
/* =========================
   Victory Overlay（1位獲得モーダル）
========================= */
function showVictoryOverlay(photo) {
  if (!photo) return;

  // 既存があれば即削除
  const existing = document.querySelector(".victory-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "victory-overlay";

  // 写真カード
  const inner = document.createElement("div");
  inner.className = "victory-inner";

  const badge = document.createElement("div");
  badge.className = "victory-badge";
  badge.textContent = "NO. 1";

  const img = document.createElement("img");
  img.className = "victory-img";
  img.alt = "1位の写真";
  img.src = photo.view;

  const hint = document.createElement("div");
  hint.className = "victory-hint";
  hint.textContent = "タップで閉じる";

  inner.appendChild(badge);
  inner.appendChild(img);
  // hint は inner の外（overflow:hidden でクリップされないよう overlay に直接置く）

  // 紙吹雪（画面全体）
  const confetti = document.createElement("div");
  confetti.className = "victory-confetti";
  const colors = ["c1","c2","c3","c4","c5","c6"];
  const anims  = ["vcFall1","vcFall2","vcFall3"];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("i");
    p.className = colors[i % 6];
    p.style.left = `${Math.random() * 102}%`;
    const s = 6 + Math.random() * 10;
    p.style.width  = `${s}px`;
    p.style.height = `${s}px`;
    p.style.borderRadius = "2px";
    const dur   = 1800 + Math.random() * 1800;
    const delay = Math.random() * 800;
    p.style.animation = `${anims[i % 3]} ${dur}ms ease-out ${delay}ms forwards`;
    confetti.appendChild(p);
  }

  overlay.appendChild(inner);
  overlay.appendChild(hint);
  overlay.appendChild(confetti);
  document.body.appendChild(overlay);

  function dismiss() {
    if (!overlay.parentNode) return;
    overlay.classList.add("victory-out");
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 480);
  }

  overlay.addEventListener("click", dismiss);
  setTimeout(dismiss, 3400);
}

function triggerTopSwapUltra(topId) {
  const ui = uiById.get(topId);
  const card = ui?.card;
  if (!card) return;

  // ビクトリーモーダル（写真を画面中央に大きく表示）
  const topPhoto = ui?.photo;
  if (!topPhoto) return;
  showVictoryOverlay(topPhoto);

  // カードアニメ
  card.classList.remove("top-swap-ultra");
  void card.offsetWidth;
  card.classList.add("top-swap-ultra");

  // 全画面ゴールドフラッシュ
  const flash = document.createElement("div");
  flash.className = "top-flash-overlay";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1800);

  // 波紋リング（画面中央から3本）— ビクトリーオーバーレイが全画面のため中央固定
  {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    for (let r = 0; r < 3; r++) {
      const ring = document.createElement("div");
      ring.className = "top-ring";
      ring.style.left = `${cx}px`;
      ring.style.top  = `${cy}px`;
      ring.style.animationDelay = `${r * 220}ms`;
      ring.style.borderColor = [
        "rgba(255,211,94,.85)",
        "rgba(255,180,30,.70)",
        "rgba(255,255,255,.60)",
      ][r];
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1700 + r * 220);
    }
  }

  // 紙吹雪（50枚・広範囲・長尺）
  const old = card.querySelector(".confetti");
  if (old) old.remove();

  const confetti = document.createElement("div");
  confetti.className = "confetti";

  const anims = ["confettiFall", "confettiFall2", "confettiFall3"];
  const N = 50;
  for (let i = 0; i < N; i++) {
    const p = document.createElement("i");
    p.className = ["c1","c2","c3","c4","c5","c6"][i % 6];

    p.style.left = `${-15 + Math.random() * 130}%`;

    const s = 5 + Math.random() * 10;
    p.style.width  = `${s}px`;
    p.style.height = `${s}px`;
    p.style.borderRadius = "2px";

    const dur   = 1400 + Math.random() * 1400;
    const delay = Math.random() * 500;
    p.style.animation = `${anims[i % 3]} ${dur}ms ease-out ${delay}ms forwards`;

    confetti.appendChild(p);
  }

  card.appendChild(confetti);

  setTimeout(() => {
    try { card.classList.remove("top-swap-ultra"); } catch {}
    const c = card.querySelector(".confetti");
    if (c) c.remove();
  }, 3200);
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
    // ユーザーがキャンセルした場合はフォールバックを実行しない
    if (e?.name === "AbortError") return true;
    console.warn("share failed:", e);
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

/* ✅ 追加：カード入場アニメ（CSSの .card-enter / .is-in を発火） */
function animateCardEntrance(cards) {
  if (!cards || cards.length === 0) return;

  requestAnimationFrame(() => {
    for (const c of cards) {
      try { c.classList.add("is-in"); } catch {}
    }
    setTimeout(() => {
      for (const c of cards) {
        try { c.classList.remove("card-enter"); } catch {}
      }
    }, 650);
  });
}

function buildPhotoCard(photo, isTop = false) {
  const card = document.createElement("div");
  card.className = isTop ? "card card--top like-glow-scope" : "card like-glow-scope";
  card.dataset.photoId = photo.id;

  // ✅ 入場の初期状態（透明＆少し下）
  card.classList.add("card-enter");

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

  // NEW バッジ（5分以内にアップロードされた写真）
  if (photo.version && (Date.now() - photo.version * 1000) < 5 * 60 * 1000) {
    const badge = document.createElement("span");
    badge.className = "badge-new";
    badge.textContent = "NEW";
    tile.appendChild(badge);
  }

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
  const newCards = [];

  for (let i = renderIndex; i < end; i++) {
    const c = buildPhotoCard(allPhotos[i], i === 0 && sortMode === "likes");
    newCards.push(c);
    frag.appendChild(c);
  }
  $gallery.appendChild(frag);

  animateCardEntrance(newCards);

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
   ✅ FIX: いいね後にDOMを作り直さず、既存カードを並べ替える（チカつき防止）
========================= */
function reorderRenderedCardsInPlace() {
  // 現在描画済みのカード枚数（作り直さない）
  const nodes = Array.from($gallery?.children || []);
  if (nodes.length === 0) return;

  const renderedCount = nodes.length;
  const desiredIds = allPhotos.slice(0, renderedCount).map(p => p.id);

  // 今の並びが既に正しいなら何もしない
  let same = true;
  for (let i = 0; i < renderedCount; i++) {
    const curId = nodes[i]?.dataset?.photoId || "";
    if (curId !== desiredIds[i]) { same = false; break; }
  }
  if (same) return;

  const frag = document.createDocumentFragment();
  const used = new Set();

  // 望ましい順に既存ノードをappend（移動するだけ）
  for (const id of desiredIds) {
    const card = uiById.get(id)?.card;
    if (card) {
      frag.appendChild(card);
      used.add(id);
    }
  }

  // 念のため、残りがあれば末尾に維持（基本ここは空のはず）
  for (const n of nodes) {
    const id = n?.dataset?.photoId || "";
    if (!used.has(id)) frag.appendChild(n);
  }

  $gallery.appendChild(frag);
}

function updateTopClass(prevTop, nextTop) {
  if (prevTop && prevTop !== nextTop) {
    const prevEl = uiById.get(prevTop)?.card;
    if (prevEl) prevEl.classList.remove("card--top");
  }
  if (nextTop) {
    const nextEl = uiById.get(nextTop)?.card;
    // 時系列モードではTOPバッジを付けない
    if (nextEl) nextEl.classList.toggle("card--top", sortMode === "likes");
  }
}

function resortByLikesAndRerender() {
  const prevTop = lastTopId;

  if (sortMode === "time") {
    allPhotos.sort((a, b) => (b.version || 0) - (a.version || 0));
  } else {
    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
  }

  const nextTop = allPhotos[0]?.id || null;
  lastTopId = nextTop;

  reorderRenderedCardsInPlace();
  updateTopClass(prevTop, nextTop);
  setBulkBar();
  updatePhotoCount();
  updateNewBadges();

  if (sortMode === "likes" && prevTop && nextTop && prevTop !== nextTop) {
    setPendingEffect(PENDING_TOP_SWAP_KEY, { id: nextTop });
    requestAnimationFrame(() => triggerTopSwapUltra(nextTop));
  }

  applyPendingEffectsAfterRender();
}

/* =========================
   Load List
========================= */
/* =========================
   ③ NEW Badge update
========================= */
function updateNewBadges() {
  const now = Date.now();
  for (const [id, ui] of uiById) {
    const photo = ui.photo;
    if (!photo?.version) continue;
    const tile = ui.card.querySelector(".tile");
    if (!tile) continue;
    const isNew   = (now - photo.version * 1000) < 5 * 60 * 1000;
    const existing = tile.querySelector(".badge-new");
    if (isNew && !existing) {
      const badge = document.createElement("span");
      badge.className = "badge-new";
      badge.textContent = "NEW";
      tile.appendChild(badge);
    } else if (!isNew && existing) {
      existing.remove();
    }
  }
}

/* =========================
   ④ Photo Count
========================= */
function updatePhotoCount() {
  if (!$photoCount) return;
  const n = allPhotos.length;
  $photoCount.textContent = n > 0 ? `${n}枚の思い出が集まりました` : "";
}

/* =========================
   ⑦ Sort Toggle
========================= */
if ($sortToggle) {
  $sortToggle.addEventListener("click", () => {
    sortMode = sortMode === "likes" ? "time" : "likes";
    $sortToggle.textContent = sortMode === "likes" ? "時系列で見る" : "いいね順で見る";
    $sortToggle.classList.toggle("active", sortMode === "time");
    // 時系列に切り替えた時は既存のTOPバッジを除去
    if (sortMode === "time") {
      document.querySelectorAll(".card--top").forEach(el => el.classList.remove("card--top"));
    }

    // ギャラリーを再描画
    allPhotos.sort(sortMode === "time"
      ? (a, b) => (b.version || 0) - (a.version || 0)
      : (a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0)
    );
    lastTopId = sortMode === "likes" ? (allPhotos[0]?.id || null) : lastTopId;
    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;
    renderNextChunk();
    setupInfiniteScroll();
    updateEmptyState();
    updatePhotoCount();
    updateNewBadges();
  });
}

// NEWバッジを30秒ごとに再チェック
setInterval(updateNewBadges, 30_000);

async function loadList() {
  await withOverlay("読み込み中…", "いいねを取得して並び替えています", async () => {
    // サーバーの削除リストとローカルをマージ（未対応Workerなら無視）
    await syncDeletedFromServer();

    const res = await fetch(jsonUrl(), { cache: "no-store" });

    if (res.status === 404 || res.status === 403) {
      allPhotos = [];
      $gallery.innerHTML = "";
      uiById.clear();
      renderIndex = 0;
      updateEmptyState();
      return;
    }

    if (!res.ok) throw new Error(`list json failed: ${res.status}`);

    let data;
    try {
      data = await res.json();
    } catch {
      data = { resources: [] };
    }

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
    }).filter(p => !deletedPhotos.has(p.id));

    // Cloudinaryリスト未反映の直後アップロード写真を補完
    allPhotos = mergeUploadCache(allPhotos);

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
    updateEmptyState();
    updatePhotoCount();
    updateNewBadges();

    applyPendingEffectsAfterRender();
  });
}

/* =========================
   Upload
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  await withOverlay("アップロード中…", "しばらくお待ちください", async () => {
    const total     = files.length;
    const uploaded  = new Array(total).fill(null);
    let   completed = 0;

    updateOverlay(`0 / ${total}`);

    // 最大3枚同時アップロード
    const CONCURRENCY = 3;
    const tasks = Array.from(files).map((file, i) => async () => {
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
      uploaded[i] = { public_id: data.public_id, version: data.version, format: data.format || "jpg" };
      completed++;
      updateOverlay(`${completed} / ${total}`);
    });

    // 並列実行（CONCURRENCY枚ずつ）
    const queue = tasks.slice();
    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
      while (queue.length) await queue.shift()();
    });
    await Promise.all(workers);

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
    saveUploadCache(newPhotos); // Cloudinaryリスト反映待ち対策

    allPhotos = [...newPhotos, ...allPhotos];
    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
    lastTopId = allPhotos[0]?.id || lastTopId;

    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;
    renderNextChunk();
    setupInfiniteScroll();
    updateEmptyState();
    updatePhotoCount();
    updateNewBadges();

    applyPendingEffectsAfterRender();
  });
}

/* =========================
   Bulk Save（✅ 準備済みfilesで共有）
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

  const ok = await shareFilesIfPossible(files);
  if (ok) {
    clearAllSelections();
    return;
  }

  // Android: blob URL 経由でダウンロードフォルダに保存
  if (isAndroid()) {
    await downloadBlobFiles(files);
    alert(`${files.length} 枚の写真をダウンロードしました。通知バーまたはギャラリーアプリからご確認ください。`);
    clearAllSelections();
    return;
  }

  // その他の端末: タブで開いて長押し保存を案内
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
      alert("アップロードに失敗しました。電波が弱い場合は枚数を減らして試してください。\n解決しない場合は新郎にお問い合わせください。");
    }
  });

  $clearSelection?.addEventListener("click", () => {
    clearAllSelections();
  });

  $bulkDelete?.addEventListener("click", deleteSelectedPhotos);

  $bulkSave?.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      alert("一括保存に失敗しました。通信が弱い場合は時間を置いて再試行してください。\n解決しない場合は新郎にお問い合わせください。");
    } finally {
      setBulkBar();
    }
  });

  $viewerClose?.addEventListener("click", hardCloseViewer);
  $viewerBackdrop?.addEventListener("click", hardCloseViewer);

  document.getElementById("summaryClose")?.addEventListener("click", closeSummary);
  document.getElementById("summaryBackdrop")?.addEventListener("click", closeSummary);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const summaryModal = document.getElementById("summaryModal");
    if (summaryModal && !summaryModal.hidden) { closeSummary(); return; }
    if ($viewer && !$viewer.hidden) hardCloseViewer();
  });

}

/* =========================
   自動ポーリング（新着写真をサイレント検知・更新）
========================= */
// いいね数だけ更新（Cloudinaryと独立・5秒ごと）
async function pollLikes() {
  if (pollLikesRunning) return;
  if ($overlay && !$overlay.hidden) return;
  if (selected.size > 0) return;
  if (!allPhotos.length) return;

  pollLikesRunning = true;
  try {
    const ids = allPhotos.map(p => p.id);
    const batches = chunk(ids, LIKES_BATCH_SIZE);
    for (const batch of batches) await fetchLikesBatch(batch);
    for (const p of allPhotos) updateLikeUI(p.id, likes.get(p.id) ?? 0);
    resortByLikesAndRerender();
  } catch {} finally {
    pollLikesRunning = false;
  }
}

// 新着写真チェック（Cloudinary・30秒ごと）
async function pollForNewPhotos() {
  if (pollNewPhotosRunning) return;
  if ($overlay && !$overlay.hidden) return;
  if ($viewer && !$viewer.hidden) return; // ビューワー表示中は再描画しない
  if (selected.size > 0) return;

  pollNewPhotosRunning = true;

  try {
    const res = await fetch(jsonUrl(), { cache: "no-store" });
    if (!res.ok) return;

    let data;
    try { data = await res.json(); } catch { return; }

    const resources = Array.isArray(data?.resources) ? data.resources : [];
    const currentIds = new Set(allPhotos.map(p => p.id));

    // 既存にない・削除済みでもない写真があるか確認
    const hasNew = resources.some(r => !currentIds.has(r.public_id) && !deletedPhotos.has(r.public_id));
    if (!hasNew) return;

    // 新しい写真のいいね数だけ取得（既存は保持）
    resources.sort((a, b) => (b.version || 0) - (a.version || 0));
    const freshAll = resources
      .map(r => {
        const id = r.public_id;
        const version = r.version;
        const format = r.format || "jpg";
        const meta = { public_id: id, version, format };
        return { id, version, format,
          thumb: cldUrl(meta, THUMB_TRANSFORM),
          view: cldUrl(meta, VIEW_TRANSFORM),
          original: cldUrl(meta, ""),
        };
      })
      .filter(p => !deletedPhotos.has(p.id));

    const newIds = freshAll.filter(p => !currentIds.has(p.id)).map(p => p.id);
    if (newIds.length) {
      const batches = chunk(newIds, LIKES_BATCH_SIZE);
      for (const batch of batches) await fetchLikesBatch(batch);
    }
    for (const p of freshAll) if (!likes.has(p.id)) likes.set(p.id, 0);

    allPhotos = freshAll;
    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));
    lastTopId = allPhotos[0]?.id || null;

    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;
    renderNextChunk();
    setupInfiniteScroll();
    updateEmptyState();
    updatePhotoCount();
    updateNewBadges();

    applyPendingEffectsAfterRender();
  } catch {
    // サイレントに失敗（ユーザーへの通知なし）
  } finally {
    pollNewPhotosRunning = false;
  }
}

/* =========================
   Post-wedding UI
========================= */
function initPostWeddingUI() {
  if (!isPostWedding()) return;

  // サマリーボタンを表示
  const btn = document.getElementById("summaryBtn");
  if (btn) {
    btn.hidden = false;
    btn.addEventListener("click", showSummary);
  }
}

function showSummary() {
  const modal = document.getElementById("summaryModal");
  if (!modal) return;

  // Top 5 写真を構築
  const photosEl = document.getElementById("smryPhotos");
  if (photosEl && photosEl.children.length === 0) {
    const top5 = [...allPhotos]
      .sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0))
      .slice(0, 5);

    top5.forEach((photo, i) => {
      const div = document.createElement("div");
      div.className = "smry-photo";
      const likeCount = likes.get(photo.id) || 0;

      const img = document.createElement("img");
      img.className = "smry-photo-img";
      img.src = photo.view;

      const rank = document.createElement("div");
      rank.className = "smry-photo-rank";
      rank.textContent = String(i + 1);

      div.appendChild(img);
      div.appendChild(rank);

      if (likeCount > 0) {
        const lk = document.createElement("div");
        lk.className = "smry-photo-likes";
        lk.textContent = `♡ ${likeCount}`;
        div.appendChild(lk);
      }

      div.addEventListener("click", () => {
        closeSummary();
        openViewer(photo);
      });
      photosEl.appendChild(div);
    });
  }

  // 曲リストを構築（初回のみ）
  const tracksEl = document.getElementById("smryTracks");
  if (tracksEl && tracksEl.children.length === 0) {
    WEDDING_TRACKS.forEach(t => {
      const div = document.createElement("div");
      div.className = "smry-track";

      const art = document.createElement("img");
      art.className = "smry-track-art";
      art.src = t.art;
      art.alt = t.name;
      art.loading = "lazy";

      const info = document.createElement("div");
      info.className = "smry-track-info";
      info.innerHTML = `
        <div class="smry-track-name">${t.name}</div>
        <div class="smry-track-artist">${t.artist}</div>`;

      const links = document.createElement("div");
      links.className = "smry-track-links";

      const spotifyBtn = document.createElement("a");
      spotifyBtn.className = "smry-track-open smry-track-open--spotify";
      spotifyBtn.href = `https://open.spotify.com/track/${t.id}`;
      spotifyBtn.target = "_blank";
      spotifyBtn.rel = "noopener";
      spotifyBtn.setAttribute("aria-label", `${t.name}をSpotifyで聴く`);
      spotifyBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="17" height="17" aria-hidden="true"><path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;

      const appleBtn = document.createElement("a");
      appleBtn.className = "smry-track-open smry-track-open--apple";
      appleBtn.href = t.itunes;
      appleBtn.target = "_blank";
      appleBtn.rel = "noopener";
      appleBtn.setAttribute("aria-label", `${t.name}をApple Musicで聴く`);
      appleBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FA2D48"/><text x="12" y="16.5" text-anchor="middle" fill="white" font-size="13" font-weight="bold" font-family="-apple-system, BlinkMacSystemFont, sans-serif">♫</text></svg>`;

      links.appendChild(spotifyBtn);
      links.appendChild(appleBtn);

      div.appendChild(art);
      div.appendChild(info);
      div.appendChild(links);
      tracksEl.appendChild(div);
    });
  }

  modal.hidden = false;
  modal.style.display = "";
  document.body.classList.add("is-busy");

  // 写真の入場アニメーション（開くたびに再生）
  requestAnimationFrame(() => animateSummaryPhotos());
}

function animateSummaryPhotos() {
  const photosEl = document.getElementById("smryPhotos");
  if (!photosEl) return;
  const photoEls = [...photosEl.querySelectorAll(".smry-photo")];
  if (!photoEls.length) return;

  // リセット
  photosEl.classList.add("smry-photos-anim");
  photoEls.forEach(el => el.classList.remove("smry-photo-in"));

  // ダブル RAF でリセットを確実に反映させてからアニメ開始
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      photoEls.forEach((el, i) => {
        // hero(0): 220ms, 2〜5枚目: 380ms から 140ms 刻みでスタガー
        const delay = i === 0 ? 220 : 380 + (i - 1) * 140;
        setTimeout(() => el.classList.add("smry-photo-in"), delay);
      });
    });
  });
}

function closeSummary() {
  const modal = document.getElementById("summaryModal");
  if (!modal || modal.hidden) return;
  modal.classList.add("smry-out");
  setTimeout(() => {
    modal.hidden = true;
    modal.style.display = "none";
    modal.classList.remove("smry-out");
    document.body.classList.remove("is-busy");
  }, 420);
}

/* =========================
   Opening Intro Animation
========================= */
function showIntro() {
  const overlay = document.getElementById("introOverlay");
  if (!overlay) return Promise.resolve();

  const post = isPostWedding();

  if (post) {
    overlay.classList.add("intro-post");
    const titleEl = overlay.querySelector(".intro-title");
    const subEl   = overlay.querySelector(".intro-sub");
    if (titleEl) titleEl.textContent = "ありがとう";
    if (subEl)   subEl.textContent   = "今日は来てくれてありがとうございました";
  }

  return new Promise(resolve => {
    const dismiss = () => {
      overlay.classList.add("intro-out");
      setTimeout(() => { overlay.remove(); resolve(); }, 800);
    };

    const timer = setTimeout(dismiss, post ? 4800 : 3800);

    overlay.addEventListener("click", () => {
      clearTimeout(timer);
      dismiss();
    }, { once: true });
  });
}

/* =========================
   Boot
========================= */
async function boot() {
  const introFinished = showIntro(); // Promise: resolves when overlay is gone

  hardCloseViewer();
  forceHideOverlay();

  bindEvents();
  bindLifecycleGuards();
  initPostWeddingUI();

  try {
    await loadList(); // 写真読み込み完了を待つ
  } catch (e) {
    console.error(e);
    forceHideOverlay();
    alert("写真一覧の読み込みに失敗しました。ページを再読み込みしてください。\n解決しない場合は新郎にお問い合わせください。");
  }

  setBulkBar();

  // 初回ロード後に自動ポーリング開始
  setInterval(pollLikes, LIKES_POLL_MS);
  setInterval(pollForNewPhotos, PHOTOS_POLL_MS);

  // Post-wedding: 写真ロード済み・イントロ終了後にサマリーを自動表示
  if (isPostWedding()) {
    await introFinished;
    showSummary();
  }
}

/* =========================
   REMOVED: Dog Mascot
========================= */
if (false) (function initDog() {
  const stage  = document.getElementById("dogStage");
  const mascot = document.getElementById("dogMascot");
  const sprite = document.getElementById("dogSprite");
  if (!stage || !mascot || !sprite) return;

  // ---- スプライト座標 (元画像 約1130×950px) ----
  const IMG_W = 1130, IMG_H = 950;
  const DISP_H = 82;

  function pose(x, y, w, h) {
    const s = DISP_H / h;
    return { w: Math.round(w * s),
      bs: `${Math.round(IMG_W * s)}px ${Math.round(IMG_H * s)}px`,
      bp: `${Math.round(-x * s)}px ${Math.round(-y * s)}px` };
  }

  const POSES = {
    walk:  pose( 30,  10, 250, 210),
    leap:  pose(350,  15, 370, 270),
    sit:   pose(810,  15, 240, 240),
    roll:  pose( 25, 560, 270, 310),
    sniff: pose(345, 590, 350, 260),
  };

  // 状態ごとのCSSアニメーション名（R=右向き / L=左向き）
  const STATE_ANIM = {
    walk:  { R: "dogWalkR 0.38s ease-in-out infinite",
             L: "dogWalkL 0.38s ease-in-out infinite" },
    sit:   { R: "dogSitR  2.8s ease-in-out infinite",
             L: "dogSitL  2.8s ease-in-out infinite" },
    sniff: { R: "dogSniffR 0.75s ease-in-out infinite",
             L: "dogSniffL 0.75s ease-in-out infinite" },
    leap:  { R: "dogLeap 1.1s ease-out forwards",
             L: "dogLeap 1.1s ease-out forwards" },
    roll:  { R: "dogRoll 1.0s ease-in-out forwards",
             L: "dogRoll 1.0s ease-in-out forwards" },
  };

  let posX       = 20;
  let dir        = 1;      // 1=右 / -1=左
  const SPEED    = 52;     // px/秒
  let pauseUntil = 0;
  let reactUntil = 0;
  let curPose    = "walk";
  let lastTs     = null;
  let transitioning = false;

  // ポーズ切り替え（フェードクロス）
  function changePose(name, smooth = true) {
    if (curPose === name && !transitioning) return;
    curPose = name;
    const dk = dir > 0 ? "R" : "L";
    const anim = STATE_ANIM[name]?.[dk] || STATE_ANIM.walk[dk];
    const p = POSES[name] || POSES.walk;

    if (!smooth) {
      // 即時切り替え（初回・ページ読み込み時）
      mascot.style.width  = p.w + "px";
      mascot.style.height = DISP_H + "px";
      sprite.style.width  = p.w + "px";
      sprite.style.height = DISP_H + "px";
      sprite.style.backgroundSize     = p.bs;
      sprite.style.backgroundPosition = p.bp;
      sprite.style.animation = anim;
      return;
    }

    // フェードアウト → スプライト変更 → フェードイン
    if (transitioning) return;
    transitioning = true;
    sprite.style.opacity = "0";
    setTimeout(() => {
      mascot.style.width  = p.w + "px";
      mascot.style.height = DISP_H + "px";
      sprite.style.width  = p.w + "px";
      sprite.style.height = DISP_H + "px";
      sprite.style.backgroundSize     = p.bs;
      sprite.style.backgroundPosition = p.bp;
      sprite.style.animation = anim;
      sprite.style.opacity = "1";
      transitioning = false;
    }, 150);
  }

  function spawnHeart() {
    const el = document.createElement("span");
    el.className = "dog-heart";
    el.textContent = ["💕","🐾","✨","💛"][Math.floor(Math.random() * 4)];
    el.style.left   = (posX + (POSES[curPose]?.w || 60) / 2 - 11) + "px";
    el.style.bottom = DISP_H + "px";
    stage.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  // タップ反応
  stage.addEventListener("click", () => {
    const now = performance.now();
    if (now < reactUntil) return;
    const dur  = 1100;
    reactUntil = now + dur;
    pauseUntil = now + dur;
    changePose(Math.random() < 0.5 ? "leap" : "roll");
    spawnHeart();
    setTimeout(() => changePose("walk"), dur + 50);
  });

  // 初期化
  changePose("walk", false);

  function tick(ts) {
    if (lastTs === null) { lastTs = ts; requestAnimationFrame(tick); return; }
    const dt = Math.min(ts - lastTs, 50) / 1000;
    lastTs = ts;

    const stageW   = stage.clientWidth;
    const dogW     = POSES[curPose]?.w || POSES.walk.w;
    const reacting = ts < reactUntil;
    const paused   = ts < pauseUntil;

    if (!reacting && !paused) {
      posX += dir * SPEED * dt;

      if (dir > 0 && posX + dogW >= stageW) {
        posX = stageW - dogW;
        dir  = -1;
        maybeIdle(ts);
      } else if (dir < 0 && posX <= 0) {
        posX = 0;
        dir  = 1;
        maybeIdle(ts);
      } else {
        if (curPose !== "walk") changePose("walk");
      }

      mascot.style.transform = `translateX(${posX}px)`;

    } else if (!reacting && paused) {
      mascot.style.transform = `translateX(${posX}px)`;
    }

    requestAnimationFrame(tick);
  }

  function maybeIdle(ts) {
    if (Math.random() < 0.45) {
      const idlePose = Math.random() < 0.5 ? "sit" : "sniff";
      const idleDur  = 1500 + Math.random() * 2000;
      changePose(idlePose);
      pauseUntil = ts + idleDur;
      setTimeout(() => changePose("walk"), idleDur + 50);
    } else {
      changePose("walk");
    }
  }

  requestAnimationFrame(tick);
}());

boot();