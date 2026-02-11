/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // https://res.cloudinary.com/<cloud>/image/list/<LIST_NAME>.json
const UPLOAD_PRESET = "wedding_unsigned";  // unsigned preset
const UPLOAD_FOLDER = "";                  // 使ってなければ空でOK

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev"; // あなたのWorkers

// Cloudinary 変換（配信URLに付ける＝自由に付けてOK）
const VIEW_TRANSFORM  = "c_limit,w_1800,q_auto:eco";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

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
let allPhotos = [];          // [{id, version, format, thumb, view, original}]
let renderIndex = 0;
const RENDER_CHUNK = 18;

const selected = new Set(); // photo.id
const likes = new Map();    // photo.id -> number

let io = null;
let viewerLoadToken = 0;

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

/* =========================
   Viewer（タップ時のみ開く / 起動時は絶対閉じる）
========================= */
function forceViewerClosedOnLoad() {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function closeViewer() {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
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
  if (!photo) return;

  $viewer.hidden = false;
  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  // ボタンは先に埋める（※ ここで出るのは正常。画像は読み込み後に出る）
  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  const token = ++viewerLoadToken;
  const hiUrl = photo.view;

  try {
    await preloadImage(hiUrl, 60000);
    if (token !== viewerLoadToken) return;

    $viewerImg.src = hiUrl;
    if ($viewerImg.decode) { try { await $viewerImg.decode(); } catch {} }
  } catch (e) {
    console.warn("viewer preload failed:", e);
    if (token !== viewerLoadToken) return;
    // フォールバック：サムネでも表示
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
      }
      return;
    }
  } catch (e) {
    console.warn("POST /likes/batch failed:", e);
  }

  // 2) GET /likes/batch?ids=a,b,c
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

async function fetchAllLikes(ids, batchSize = 100) {
  const total = ids.length;
  for (let i = 0; i < total; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    updateOverlay(`いいね取得中… ${Math.min(i + batchSize, total)} / ${total}`);
    await fetchLikesBatch(chunk);
    // 少し休ませる（Workersにも優しい）
    await sleep(60);
  }
}

async function postLike(id) {
  // ローカル即反映（何回押してもOK）
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  // 1) POST /likes {id}
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

  // 2) POST /likes/{id}
  try {
    const res = await fetch(`${LIKE_API}/likes/${encodeURIComponent(id)}`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
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

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

/* =========================
   Sort（いいね多い順 → 同点は新しい順）
========================= */
function sortPhotosByLikes() {
  allPhotos.sort((a, b) => {
    const la = likes.get(a.id) || 0;
    const lb = likes.get(b.id) || 0;
    if (lb !== la) return lb - la;
    return (b.version || 0) - (a.version || 0);
  });
}

/* =========================
   Render（CSSと100%一致：card/tile/meta/like-btn/tile-check）
========================= */
function buildPhotoCard(photo, index) {
  const card = document.createElement("div");
  card.className = "card" + (index === 0 ? " is-top" : "");

  if (index === 0) {
    const badge = document.createElement("div");
    badge.className = "top-badge";
    badge.textContent = "👑 No.1（いいね最多）";
    card.appendChild(badge);
  }

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
  likeBtn.innerHTML = "❤";
  likeBtn.addEventListener("click", async () => {
    await postLike(photo.id);

    // いいね更新後：トップの入れ替わりが起き得るので並べ替え→先頭だけ軽く再描画
    // （全部描画し直すと重いので、ここは“安全寄り”に全再描画にしてる）
    // もし重いなら「先頭30枚だけ再描画」に変えられます。
    rerenderAllKeepingSelection();
  });

  const likeCount = document.createElement("span");
  likeCount.className = "like-count";
  likeCount.dataset.likeCount = photo.id;
  likeCount.textContent = String(likes.get(photo.id) || 0);

  meta.appendChild(likeBtn);
  meta.appendChild(likeCount);

  card.appendChild(tile);
  card.appendChild(meta);

  return card;
}

function renderNextChunk() {
  const end = Math.min(renderIndex + RENDER_CHUNK, allPhotos.length);
  if (renderIndex >= end) return false;

  const frag = document.createDocumentFragment();
  for (let i = renderIndex; i < end; i++) {
    frag.appendChild(buildPhotoCard(allPhotos[i], i));
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

function rerenderAllKeepingSelection() {
  // チェック状態は selected から復元できるので全再描画でも壊れない
  sortPhotosByLikes();
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
  setBulkBar();
}

/* =========================
   Load Cloudinary list
========================= */
async function loadList() {
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);
  const data = await res.json();

  const resources = Array.isArray(data?.resources) ? data.resources : [];
  // まず新しい順（versionが新しい＝最近）
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
      original: cldUrl(meta, ""), // 原寸（変換なし）
    };
  });

  // ✅ いいねを「全件」取得してからソート（トップ豪華が正しくなる）
  updateOverlay("いいね取得中…");
  await fetchAllLikes(allPhotos.map(p => p.id), 100);

  // ✅ いいね順に並び替え
  sortPhotosByLikes();

  // 描画
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Upload（枚数が多いと失敗しやすいので“少数ずつ”推奨表示）
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  showOverlay("アップロード中…", "画面は操作できません（※数枚ずつアップが安定します）", `0 / ${files.length}`);

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
    uploaded.push({
      public_id: data.public_id,
      version: data.version,
      format: data.format || "jpg",
    });
  }

  // list json 反映待ちがあるので、今回は “再読み込み” が一番安全
  hideOverlay();
  await sleep(800);
  await loadList();
}

/* =========================
   Bulk Save（iPhone制限あり：1ボタンで“まとめ導線”）
   - 完全自動でカメラロール保存はブラウザ仕様で不可
   - 代わりに「選択→1ボタン→選択画像を順番に開く」を提供
========================= */
async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  // ポップアップ制限があるので、ユーザーの1クリックで「順番に開く」
  // 開いた先で長押し保存が現実解
  const urls = ids
    .map(id => allPhotos.find(p => p.id === id)?.original)
    .filter(Boolean);

  if (!urls.length) {
    alert("保存対象が見つかりませんでした。");
    return;
  }

  // iOS は一気に開くとブロックされるので、少しずつ
  showOverlay("一括保存の準備中…", "端末によっては途中で止まる場合があります", `${urls.length} 枚`);
  await sleep(350);
  hideOverlay();

  // 先に案内（最初の1回目だけ“許可”が必要なことが多い）
  alert("これから原寸画像を順番に開きます。各画像を長押しして「写真に追加/画像を保存」してください。");

  for (let i = 0; i < urls.length; i++) {
    window.open(urls[i], "_blank", "noopener");
    await sleep(450);
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
    // DOM上のチェックも外す
    document.querySelectorAll('.tile-check input[type="checkbox"]').forEach(cb => cb.checked = false);
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
    alert("写真一覧の読み込みに失敗しました。Cloudinary list JSON が開けるか確認してください。");
  }

  setBulkBar();
}

boot();
