/* =========================
   CONFIG
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

const VIEW_TRANSFORM  = "c_limit,w_1800,q_auto:eco";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

// 安定用制限
const UPLOAD_MAX_FILES_PER_BATCH = 8;
const BULK_SAVE_MAX = 25;
const HIRES_TIMEOUT_MS = 45000;

// ✅ 高速化：最初に likes を取りに行く枚数（先に写真だけ描画→後追いでlikes）
const INITIAL_LIKES_PREFETCH = 120;
const LIKES_BATCH_SIZE = 80;           // Worker負荷/URL長のバランス
const RESORT_DEBOUNCE_MS = 900;        // 連続いいね時の並び替え間引き

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
let allPhotos = []; // [{id, version, format, thumb, view, original}]
let renderIndex = 0;
const RENDER_CHUNK = 18;

const selected = new Set();   // photo.id
const likes = new Map();      // photo.id -> number

// ✅ likesの安定化（戻り防止）
const likeReqSeq = new Map();        // id -> seq number
const optimisticFloor = new Map();   // id -> min count to display (never go below this)

// ✅ すでにlikes取得済み/取得中を管理（無駄リクエスト削減）
const likesFetched = new Set();      // id
const likesInflight = new Set();     // id

let io = null;

// viewer
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

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function canWebShare() {
  return !!navigator.share;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   Viewer（class制御）
========================= */
function closeViewer(hard = false) {
  $viewer.classList.remove("is-open");
  $viewer.setAttribute("aria-hidden", "true");
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  if (hard) viewerLoadToken++;
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
   Likes API（戻り防止）
========================= */
function applyLikeFromServer(id, serverCount) {
  if (typeof serverCount !== "number") return;

  // ✅ “戻らない”：楽観値（floor）より小さいサーバ値は無視
  const floor = optimisticFloor.get(id) ?? 0;
  const safe = Math.max(serverCount, floor);

  likes.set(id, safe);
  updateLikeUI(id, safe);
}

function setOptimisticFloor(id, newFloor) {
  const prev = optimisticFloor.get(id) ?? 0;
  if (newFloor > prev) optimisticFloor.set(id, newFloor);
}

async function fetchLikesBatch(ids) {
  const target = ids.filter(id => !likesFetched.has(id) && !likesInflight.has(id));
  if (!target.length) return;

  // inflight
  for (const id of target) likesInflight.add(id);

  try {
    const res = await fetch(`${LIKE_API}/likes/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: target }),
    });

    if (!res.ok) return;

    const data = await res.json();
    const obj = data?.likes || data || {};

    for (const id of target) {
      const v = obj[id];
      if (typeof v === "number") {
        applyLikeFromServer(id, v);
      } else {
        // 未登録は 0 とみなす（表示揺れ防止）
        applyLikeFromServer(id, 0);
      }
      likesFetched.add(id);
    }
  } catch (e) {
    console.warn("fetchLikesBatch failed", e);
  } finally {
    for (const id of target) likesInflight.delete(id);
  }
}

async function postLike(id) {
  // ✅ UI即反映（楽観）
  const current = likes.get(id) || 0;
  const next = current + 1;

  likes.set(id, next);
  setOptimisticFloor(id, next);
  updateLikeUI(id, next);
  scheduleResort();

  // ✅ リクエスト順序管理（古いレスポンスを捨てる）
  const seq = (likeReqSeq.get(id) || 0) + 1;
  likeReqSeq.set(id, seq);

  try {
    const res = await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) return;

    const data = await res.json(); // {"id":"xxx","likes":n}
    const serverCount = data?.likes;

    // 最新seqだけ採用
    const latest = likeReqSeq.get(id) || 0;
    if (seq !== latest) return;

    applyLikeFromServer(id, serverCount);
    scheduleResort();
  } catch (e) {
    // 失敗してもUIは戻さない（floorで固定）
    console.warn("postLike failed", e);
  }
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

/* =========================
   Render
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

  const cnt = likes.get(photo.id) || 0;
  likeBtn.innerHTML = `❤ <span class="like-count" data-like-count="${photo.id}">${cnt}</span>`;

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
  const newlyVisibleIds = [];

  for (let i = renderIndex; i < end; i++) {
    const p = allPhotos[i];
    frag.appendChild(buildPhotoCard(p, i === 0));
    newlyVisibleIds.push(p.id);
  }

  $gallery.appendChild(frag);
  renderIndex = end;

  // ✅ 表示された分だけ likes を後追い取得（高速化の肝）
  prefetchLikesForIds(newlyVisibleIds);

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
   Likes Prefetch (visible only)
========================= */
let likesQueue = [];
let likesQueueTimer = null;

function prefetchLikesForIds(ids) {
  for (const id of ids) {
    if (likesFetched.has(id) || likesInflight.has(id)) continue;
    likesQueue.push(id);
  }
  if (likesQueueTimer) return;

  likesQueueTimer = setTimeout(async () => {
    likesQueueTimer = null;
    const uniq = Array.from(new Set(likesQueue));
    likesQueue = [];

    const batches = chunk(uniq, LIKES_BATCH_SIZE);
    for (const b of batches) {
      await fetchLikesBatch(b);
    }

    // likes揃ってきたらTOP装飾が効くように（重い再描画は間引き）
    scheduleResort();
  }, 250);
}

/* =========================
   Sort（いいね順）※重いので間引き
========================= */
let resortTimer = null;
function scheduleResort() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerender();
  }, RESORT_DEBOUNCE_MS);
}

function resortByLikesAndRerender() {
  // “戻らない”用：likes未取得は0
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
}

/* =========================
   Load list（高速：写真を先に出す）
========================= */
async function loadList() {
  // ✅ ここは “出すのが最優先” なので overlay は短く
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);

  const data = await res.json();
  const resources = Array.isArray(data?.resources) ? data.resources : [];

  // まず最新順（初期表示はこれでOK）
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

  // ✅ まず描画（ここで体感爆速）
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();

  // ✅ likesは “最初だけ先読み”（全部は取らない）
  const first = allPhotos.slice(0, Math.min(INITIAL_LIKES_PREFETCH, allPhotos.length)).map(p => p.id);
  prefetchLikesForIds(first);
}

/* =========================
   Upload（数枚ずつ）
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;
  const list = files.slice(0, UPLOAD_MAX_FILES_PER_BATCH);

  showOverlay(
    "アップロード中…",
    `※ 安定のため最大 ${UPLOAD_MAX_FILES_PER_BATCH} 枚ずつ`,
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

  // 即時反映（新規はいいね0）
  const newPhotos = uploaded.map(meta => ({
    id: meta.public_id,
    version: meta.version,
    format: meta.format,
    thumb: cldUrl(meta, THUMB_TRANSFORM),
    view: cldUrl(meta, VIEW_TRANSFORM),
    original: cldUrl(meta, ""),
  }));

  for (const p of newPhotos) {
    likes.set(p.id, likes.get(p.id) || 0);
    likesFetched.add(p.id); // 0確定扱い（揺れ防止）
  }

  allPhotos = [...newPhotos, ...allPhotos];

  // 再描画（軽く）
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Bulk Save（iOSは共有シートで “URL一覧” を共有）
========================= */
function buildSelectedUrlList() {
  const ids = Array.from(selected);
  const photos = ids.map(id => allPhotos.find(p => p.id === id)).filter(Boolean);
  return photos.map(p => p.original);
}

async function shareUrlList(urls) {
  const text =
    "選択した写真の原寸URLです（まとめて保存する場合は、このURL一覧を共有→ショートカット等で一括保存が便利です）\n\n" +
    urls.join("\n");

  // iOS Safari: 共有シートが出る（テキスト共有）
  await navigator.share({
    title: "Wedding Photos",
    text,
  });
}

async function bulkOpenTabs(urls) {
  // PC/Android向け：順に開く（ポップアップ制限あり）
  let opened = 0;
  for (const u of urls) {
    window.open(u, "_blank", "noopener");
    opened++;
    await sleep(450);
  }
  return opened;
}

async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  if (ids.length > BULK_SAVE_MAX) {
    alert(`一括保存は最大 ${BULK_SAVE_MAX} 枚までにしてください（端末制限対策）。`);
    return;
  }

  const urls = buildSelectedUrlList();
  if (!urls.length) {
    alert("保存対象が見つかりませんでした。");
    return;
  }

  // ✅ “共有っぽい画面” を出してほしい要望に寄せる
  // ただし Web単体で「複数画像を共有→写真に一括保存」は iOS制約で不可
  // → 代替：URL一覧を共有（ショートカットで一括保存可能）
  if (isIOS() && canWebShare()) {
    try {
      showOverlay("共有シートを開きます…", "URL一覧を共有できます", `${urls.length} 枚`);
      await sleep(200);
      hideOverlay();

      await shareUrlList(urls);

      alert(
        "共有シートを開きました。\n\n" +
        "iPhoneで“本当に一括で写真に保存”したい場合は、\n" +
        "共有先で「ショートカット」を使う方法が一番確実です。\n" +
        "（URL一覧から画像を保存するショートカットを作れます）"
      );
      return;
    } catch (e) {
      // shareキャンセル等 → フォールバック
    } finally {
      hideOverlay();
    }
  }

  // フォールバック：タブを順に開く
  showOverlay("一括保存の準備中…", "原寸画像を順番に開きます", `${urls.length} 枚`);
  hideOverlay();

  const opened = await bulkOpenTabs(urls);
  if (opened === 0) {
    alert("保存対象が見つかりませんでした。");
  } else if (isIOS()) {
    alert("各タブで画像を長押しして「写真に追加/画像を保存」してください。");
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
    document.querySelectorAll('.tile-check input[type="checkbox"]').forEach(cb => (cb.checked = false));
    setBulkBar();
  });

  // Bulk save
  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      alert("一括保存に失敗しました。");
    }
  });

  // Viewer close
  $viewerClose.addEventListener("click", () => closeViewer(true));
  $viewerBackdrop.addEventListener("click", () => closeViewer(true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeViewer(true);
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
  // 初期は必ず閉じる
  closeViewer(true);

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
