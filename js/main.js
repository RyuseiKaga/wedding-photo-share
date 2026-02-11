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

// Likes 取得最適化
const LIKES_BATCH_SIZE = 120;       // 1回で投げるids数
const LIKES_CONCURRENCY = 6;       // 並列数（速い回線なら 6〜8 推奨）
const RESORT_DEBOUNCE_MS = 900;    // 連打時の並び替え間引き

// 描画（画像は遅延）
const RENDER_CHUNK = 18;           // 追加描画枚数
const SKELETON_COUNT = 12;         // likes取得中のダミー枠

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

const selected = new Set();      // photo.id
const likes = new Map();         // photo.id -> number

// ✅ “いいねが戻る”対策（楽観更新の床）
const optimisticFloor = new Map(); // id -> min count
const likeReqSeq = new Map();      // id -> seq（古いレスポンス破棄）

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
   Skeleton（体感を速くする）
========================= */
function renderSkeleton() {
  $gallery.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (let i = 0; i < SKELETON_COUNT; i++) {
    const card = document.createElement("div");
    card.className = "card";

    const tile = document.createElement("div");
    tile.className = "tile";
    // うっすらプレースホルダ
    tile.style.background = "#f3f4f6";
    tile.style.backgroundImage =
      "linear-gradient(90deg, #f3f4f6 0px, #eaecef 40px, #f3f4f6 80px)";
    tile.style.backgroundSize = "200px 100%";
    tile.style.animation = "skel 1.2s ease-in-out infinite";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<span style="opacity:.45;font-weight:800;">❤ …</span>`;

    card.appendChild(tile);
    card.appendChild(meta);
    frag.appendChild(card);
  }

  // skel keyframes をJS側で一度だけ注入
  if (!document.getElementById("skel-style")) {
    const st = document.createElement("style");
    st.id = "skel-style";
    st.textContent = `
      @keyframes skel { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
    `;
    document.head.appendChild(st);
  }

  $gallery.appendChild(frag);
}

/* =========================
   Viewer（hidden制御）
========================= */
function closeViewer(hard = false) {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  if (hard) viewerLoadToken++;
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
   Likes API（全件取得＋戻り防止）
========================= */
function setOptimisticFloor(id, v) {
  const prev = optimisticFloor.get(id) ?? 0;
  if (v > prev) optimisticFloor.set(id, v);
}

function applyLikeFromServer(id, serverCount) {
  if (typeof serverCount !== "number") return;
  const floor = optimisticFloor.get(id) ?? 0;
  const safe = Math.max(serverCount, floor);
  likes.set(id, safe);
  updateLikeUI(id, safe);
}

async function fetchLikesBatch(ids) {
  // POST /likes/batch -> {likes: {id: n}}
  const res = await fetch(`${LIKE_API}/likes/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`likes batch failed: ${res.status}`);
  const data = await res.json();
  const obj = data?.likes || data || {};
  return obj;
}

/**
 * ✅ 全件 likes 取得を “並列” で速くする
 * - batchを分割
 * - 最大 LIKES_CONCURRENCY 並列で回す
 */
async function fetchAllLikes(ids) {
  const batches = chunk(ids, LIKES_BATCH_SIZE);

  let done = 0;
  const total = batches.length;

  // ワーカー
  async function worker() {
    while (true) {
      const idx = done;
      if (idx >= total) return;
      done++;
      const batch = batches[idx];

      try {
        const obj = await fetchLikesBatch(batch);
        for (const id of batch) {
          const v = obj[id];
          if (typeof v === "number") likes.set(id, v);
          else likes.set(id, 0);
        }
      } catch (e) {
        // 失敗バッチは 0 扱いで進める（初期表示を止めない）
        console.warn("batch failed -> fallback 0", e);
        for (const id of batch) {
          if (!likes.has(id)) likes.set(id, 0);
        }
      } finally {
        const finished = Math.min(done, total);
        updateOverlay(`${finished} / ${total}（いいね集計中）`);
      }
    }
  }

  const workers = [];
  const c = Math.min(LIKES_CONCURRENCY, total);
  for (let i = 0; i < c; i++) workers.push(worker());
  await Promise.all(workers);
}

/* =========================
   Render（いいね順＋TOP豪華）
========================= */
function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

function buildPhotoCard(photo, isTop = false, index = 0) {
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

  // 最初の数枚は優先度上げて体感改善（対応ブラウザのみ）
  if (index < 4) {
    img.fetchPriority = "high";
  }

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
  for (let i = renderIndex; i < end; i++) {
    frag.appendChild(buildPhotoCard(allPhotos[i], i === 0, i));
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
   Like POST（戻り防止＋並べ替え）
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
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  // 再描画（画像はlazyなので、ここで画像DLが爆発しにくい）
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
}

async function postLike(id) {
  // UI即反映（何回押してもOK）
  const current = likes.get(id) || 0;
  const next = current + 1;

  likes.set(id, next);
  setOptimisticFloor(id, next);
  updateLikeUI(id, next);

  scheduleResort();

  // seq（古いレスポンス破棄）
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
    const latest = likeReqSeq.get(id) || 0;
    if (seq !== latest) return;

    applyLikeFromServer(id, data?.likes);
    scheduleResort();
  } catch (e) {
    console.warn("postLike failed", e);
    // 失敗してもUIは戻さない（floor）
  }
}

/* =========================
   Load（要件：初期にlikes全件→並べ替え）
========================= */
async function loadListAndLikesAndSort() {
  // 1) list を取る
  showOverlay("読み込み中…", "写真一覧を取得しています", "");
  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);

  const data = await res.json();
  const resources = Array.isArray(data?.resources) ? data.resources : [];
  hideOverlay();

  // 2) すぐ “枠” を見せる（体感短縮）
  renderSkeleton();

  // 3) allPhotos 構築（画像URLは作るだけ、まだimgはDOMに入れないのでDLされない）
  //   ※ listは最新順っぽいが、versionで降順にしておく
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

  // 4) likes 全件取得（並列で速く）
  showOverlay("ランキング集計中…", "いいね数を取得しています（最初だけ）", "0 / 0（いいね集計中）");
  const ids = allPhotos.map(p => p.id);
  updateOverlay(`0 / ${Math.ceil(ids.length / LIKES_BATCH_SIZE)}（いいね集計中）`);
  await fetchAllLikes(ids);
  hideOverlay();

  // 5) いいね順に並べ替え（要件）
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  // 6) 初回描画（画像はlazy + chunk）
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
}

/* =========================
   Upload（安定）
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

  // 新規はlikes=0扱いで即反映 → 既存の“いいね順”の中に入る
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
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Bulk Save（現状のまま：Webだけで“写真へ一括保存”は不可）
========================= */
function buildSelectedUrlList() {
  const ids = Array.from(selected);
  const photos = ids.map(id => allPhotos.find(p => p.id === id)).filter(Boolean);
  return photos.map(p => p.original);
}

async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  if (ids.length > BULK_SAVE_MAX) {
    alert(`一括保存は最大 ${BULK_SAVE_MAX} 枚までにしてください（端末制限対策）。`);
    return;
  }

  const urls = buildSelectedUrlList();
  if (!urls.length) return;

  // iOSは共有シートを出す（URL一覧）
  if (isIOS() && canWebShare()) {
    try {
      const text = urls.join("\n");
      await navigator.share({ title: "Wedding Photos", text });
      alert(
        "共有シートを開きました。\n\n" +
        "※Webだけで“複数画像を一括で写真へ保存”はiOS制約でできません。\n" +
        "URL一覧を共有して、ショートカット等で一括保存するのが一番近い体験です。"
      );
      return;
    } catch {}
  }

  // フォールバック：タブを順に開く
  for (const u of urls) {
    window.open(u, "_blank", "noopener");
    await sleep(450);
  }
  if (isIOS()) {
    alert("各タブで画像を長押しして「写真に追加/画像を保存」してください。");
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
      alert("一括保存に失敗しました。");
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
  closeViewer(true);
  bindEvents();

  try {
    await loadListAndLikesAndSort();
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("初期読み込みに失敗しました。\nlist url = " + jsonUrl());
  }

  setBulkBar();
}

boot();
