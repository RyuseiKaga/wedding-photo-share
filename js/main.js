/* =========================
   Wedding Photo Share - main.js
   HTML IDs are matched to your provided index.html
========================= */

/* ====== CONFIG ====== */
const CLOUD_NAME = "dmei50xsu";            // Cloudinary cloud name
const TAG_NAME = "wedding_2026";           // Cloudinary list tag (image/list/<TAG>.json)
const UPLOAD_PRESET = "wedding_unsigned";  // Cloudinary unsigned upload preset name
const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev"; // your Worker base URL

// UI / perf
const RENDER_BATCH = 36;     // how many thumbnails to append per batch
const SCROLL_MARGIN = 800;   // px from bottom to trigger next batch

// Cloudinary URLs
function cldThumb(publicId) {
  // very light for grid
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_360/${publicId}`;
}
function cldView(publicId) {
  // viewer preview (medium)
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_jpg,q_auto:good,w_1400,fl_progressive/${publicId}`;
}
function cldOpen(publicId) {
  // save/open (high, but reasonable)
  // eager preset created: c_limit,w_1800,q_auto:eco
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_1800,q_auto:eco,f_jpg,fl_progressive/${publicId}`;
}

/* ====== DOM ====== */
const elGallery = document.getElementById("gallery");
const elFileInput = document.getElementById("fileInput");

const elBulkBar = document.getElementById("bulkBar");
const elSelectedCount = document.getElementById("selectedCount");
const elClearSelection = document.getElementById("clearSelection");
const elBulkSave = document.getElementById("bulkSave");

const elOverlay = document.getElementById("uploadOverlay");
const elOverlaySub = document.getElementById("uploadOverlaySub");
const elOverlayProgress = document.getElementById("uploadOverlayProgress");

const elViewer = document.getElementById("viewer");
const elViewerClose = document.getElementById("viewerClose");
const elViewerImg = document.getElementById("viewerImg");
const elViewerLoading = document.getElementById("viewerLoading");
const elViewerOpen = document.getElementById("viewerOpen");
const elViewerCopy = document.getElementById("viewerCopy");

/* ====== STATE ====== */
let allPhotos = [];            // full list from Cloudinary list JSON
let renderIndex = 0;           // how many are rendered
let loadingList = false;

const likes = new Map();       // publicId -> count
const selected = new Set();    // selected publicIds
let currentViewerId = null;

/* ====== Overlay helpers ====== */
function showOverlay(title = "処理中…", sub = "しばらくお待ちください", progressText = "") {
  elOverlay.hidden = false;
  // title is static in HTML. We update sub & progress only.
  elOverlaySub.textContent = sub;
  elOverlayProgress.textContent = progressText;
  document.body.classList.add("is-busy");
}
function updateOverlay(sub, progressText = "") {
  elOverlaySub.textContent = sub;
  elOverlayProgress.textContent = progressText;
}
function hideOverlay() {
  elOverlay.hidden = true;
  elOverlayProgress.textContent = "";
  document.body.classList.remove("is-busy");
}

/* ====== Utils ====== */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* =========================
   INIT
========================= */
document.addEventListener("DOMContentLoaded", () => {
  // events
  elFileInput.addEventListener("change", onPickFiles);

  elClearSelection.addEventListener("click", () => {
    selected.clear();
    syncSelectionUI();
    refreshSelectionMarks();
  });

  elBulkSave.addEventListener("click", bulkSaveSelected);

  elViewerClose.addEventListener("click", closeViewer);
  elViewer.addEventListener("click", (e) => {
    // click on backdrop closes
    if (e.target.classList.contains("viewer-backdrop")) closeViewer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !elViewer.hidden) closeViewer();
  });

  // start
  boot();
});

async function boot() {
  showOverlay("処理中…", "写真一覧を読み込み中…");
  await loadCloudinaryList();
  await warmLikesForRenderedSoon();
  renderNextBatch(); // initial render
  hideOverlay();
  setupInfiniteScroll();
}

/* =========================
   LOAD LIST (Cloudinary)
========================= */

async function loadCloudinaryList() {
  if (loadingList) return;
  loadingList = true;

  const url = `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${TAG_NAME}.json`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Cloudinary list fetch failed: ${res.status}`);
    }
    const data = await res.json();

    // Cloudinary list JSON usually has { resources: [...] }
    const resources = Array.isArray(data.resources) ? data.resources : [];
    // newest first if created_at exists
    resources.sort((a, b) => {
      const ta = Date.parse(a.created_at || "") || 0;
      const tb = Date.parse(b.created_at || "") || 0;
      return tb - ta;
    });

    allPhotos = resources;
    renderIndex = 0;
    elGallery.innerHTML = "";
  } catch (err) {
    console.error(err);
    elGallery.innerHTML = `
      <div style="padding:16px; line-height:1.6;">
        <b>写真一覧の取得に失敗しました。</b><br>
        Cloudinaryの list JSON が取得できないか、TAG名が違う可能性があります。<br>
        <div style="margin-top:8px; font-size:12px; opacity:.8;">
          ${escapeHtml(String(err))}
        </div>
      </div>
    `;
  } finally {
    loadingList = false;
  }
}

/* =========================
   RENDER (Infinite scroll: local batching)
========================= */

function renderNextBatch() {
  const slice = allPhotos.slice(renderIndex, renderIndex + RENDER_BATCH);
  if (slice.length === 0) return;

  const frag = document.createDocumentFragment();

  for (const p of slice) {
    const publicId = p.public_id;
    frag.appendChild(buildPhotoCard(publicId));
  }

  elGallery.appendChild(frag);
  renderIndex += slice.length;

  // after append, fetch likes for these items (batch)
  fetchLikesBatchFor(slice.map(p => p.public_id)).catch(() => {});
}

function buildPhotoCard(publicId) {
  const card = document.createElement("div");
  card.className = "card"; // style.css側に合わせて（もし無ければ galleryのCSSで拾う）

  const likeCount = likes.get(publicId) ?? 0;

  card.innerHTML = `
    <div class="tile">
      <button class="tile-hit" type="button" aria-label="表示"></button>
      <img class="tile-img" src="${cldThumb(publicId)}" alt="photo" loading="lazy" decoding="async">
      <label class="tile-check">
        <input type="checkbox" data-select="${escapeHtml(publicId)}">
        <span>選択</span>
      </label>
    </div>

    <div class="meta">
      <button class="like-btn" type="button" data-like="${escapeHtml(publicId)}" aria-label="いいね">
        ❤️ <span class="like-count" id="like-${escapeHtml(publicId)}">${likeCount}</span>
      </button>
    </div>
  `;

  // tap to open viewer
  card.querySelector(".tile-hit").addEventListener("click", () => openViewer(publicId));
  card.querySelector(".tile-img").addEventListener("click", () => openViewer(publicId));

  // like
  card.querySelector('[data-like]').addEventListener("click", () => likePhoto(publicId));

  // select
  const chk = card.querySelector('[data-select]');
  chk.checked = selected.has(publicId);
  chk.addEventListener("change", () => {
    if (chk.checked) selected.add(publicId);
    else selected.delete(publicId);
    syncSelectionUI();
  });

  return card;
}

function setupInfiniteScroll() {
  window.addEventListener("scroll", () => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - SCROLL_MARGIN;
    if (nearBottom) renderNextBatch();
  }, { passive: true });
}

/* =========================
   SELECTION UI
========================= */

function syncSelectionUI() {
  const n = selected.size;
  elSelectedCount.textContent = String(n);
  elBulkBar.hidden = n === 0;
}

function refreshSelectionMarks() {
  document.querySelectorAll('input[data-select]').forEach((el) => {
    const id = el.getAttribute("data-select");
    el.checked = selected.has(id);
  });
}

/* =========================
   VIEWER (preload方式)
========================= */

function openViewer(publicId) {
  currentViewerId = publicId;

  elViewer.hidden = false;
  document.body.style.overflow = "hidden";

  elViewerLoading.hidden = false;
  elViewerImg.removeAttribute("src");
  elViewerImg.alt = "preview";

  // buttons
  elViewerOpen.href = cldOpen(publicId);
  elViewerCopy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(elViewerOpen.href);
      toast("URLをコピーしました");
    } catch {
      toast("コピーできませんでした");
    }
  };

  // Preload the viewer image first to avoid endless spinner
  const url = cldView(publicId);
  const img = new Image();
  img.onload = () => {
    // only set if still same viewer
    if (currentViewerId !== publicId) return;
    elViewerImg.src = url;
    elViewerLoading.hidden = true;
  };
  img.onerror = () => {
    if (currentViewerId !== publicId) return;
    elViewerLoading.hidden = true;
    toast("高画質の読み込みに失敗しました（通信/URL確認）");
  };
  img.src = url;
}

function closeViewer() {
  currentViewerId = null;
  elViewer.hidden = true;
  elViewerLoading.hidden = true;
  elViewerImg.removeAttribute("src");
  document.body.style.overflow = "";
}

/* =========================
   LIKE API (Workers KV)
========================= */

// バッチ取得（存在すれば使う）
async function fetchLikesBatchFor(ids) {
  if (!LIKE_API) return;

  // 未取得だけ送る（既にあるものは省略）
  const unknown = ids.filter(id => !likes.has(id));
  if (unknown.length === 0) return;

  // まず /likes/batch を試す
  try {
    const res = await fetch(`${LIKE_API}/likes/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unknown })
    });

    if (!res.ok) throw new Error(`batch status ${res.status}`);
    const data = await res.json();

    // 期待フォーマットが揺れるので吸収
    // 例1: { likes: { "id": 3, ... } }
    // 例2: { "id": 3, ... }
    const map = data.likes && typeof data.likes === "object" ? data.likes : data;

    if (map && typeof map === "object") {
      for (const id of unknown) {
        const v = Number(map[id] ?? 0) || 0;
        likes.set(id, v);
        const el = document.getElementById(`like-${id}`);
        if (el) el.textContent = String(v);
      }
    }
    return;
  } catch (e) {
    // fallback: do nothing (likes stay 0 until pressed)
    console.warn("likes/batch failed, fallback:", e);
  }
}

async function warmLikesForRenderedSoon() {
  // list取得直後はまだDOMないので、最初のバッチ分だけ先に温める
  const firstIds = allPhotos.slice(0, RENDER_BATCH).map(p => p.public_id);
  await fetchLikesBatchFor(firstIds);
}

async function likePhoto(publicId) {
  // optimistic update
  const cur = likes.get(publicId) ?? 0;
  const optimistic = cur + 1;
  likes.set(publicId, optimistic);
  const el = document.getElementById(`like-${publicId}`);
  if (el) el.textContent = String(optimistic);

  try {
    const res = await fetch(`${LIKE_API}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: publicId })
    });

    if (!res.ok) throw new Error(`like status ${res.status}`);
    const data = await res.json();

    // 期待: { likes: number }
    const v = Number(data.likes);
    if (Number.isFinite(v)) {
      likes.set(publicId, v);
      const el2 = document.getElementById(`like-${publicId}`);
      if (el2) el2.textContent = String(v);
    }
  } catch (e) {
    console.warn("like failed:", e);
    // revert optimistic (optional)
    const back = (likes.get(publicId) ?? 1) - 1;
    likes.set(publicId, Math.max(0, back));
    const el3 = document.getElementById(`like-${publicId}`);
    if (el3) el3.textContent = String(likes.get(publicId));
    toast("いいね送信に失敗（Worker URL / CORS / エンドポイント確認）");
  }
}

/* =========================
   UPLOAD (Unsigned)
========================= */

async function onPickFiles() {
  const files = Array.from(elFileInput.files || []);
  if (files.length === 0) return;

  // optional limit (you can adjust)
  const MAX_UPLOAD = 30;
  if (files.length > MAX_UPLOAD) {
    alert(`一度にアップロードできるのは最大 ${MAX_UPLOAD} 枚までです`);
    elFileInput.value = "";
    return;
  }

  showOverlay("処理中…", "アップロード中…", `0 / ${files.length}`);

  try {
    let done = 0;

    for (const file of files) {
      updateOverlay("アップロード中…", `${done} / ${files.length}`);

      await uploadOne(file);
      done++;

      updateOverlay("アップロード中…", `${done} / ${files.length}`);

      // throttle a bit for stability on mobile
      await sleep(120);
    }

    updateOverlay("反映中…", "一覧を更新しています");

    // reload list to reflect new photos
    await loadCloudinaryList();
    await warmLikesForRenderedSoon();
    renderNextBatch();

    toast("アップロード完了！");
  } catch (e) {
    console.error(e);
    toast("アップロードに失敗しました（通信/プリセット/制限を確認）");
  } finally {
    hideOverlay();
    elFileInput.value = "";
  }
}

async function uploadOne(file) {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  // Tag付け（list用）
  fd.append("tags", TAG_NAME);

  // ここでフォルダ分けしたいなら（任意）
  // fd.append("folder", "wedding");

  const res = await fetch(endpoint, { method: "POST", body: fd });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${txt}`);
  }
  return res.json();
}

/* =========================
   BULK SAVE (no zip, iOS friendly)
========================= */

async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  // iOS/Safari stability: limit
  const BULK_LIMIT = 20;
  if (ids.length > BULK_LIMIT) {
    alert(`一括保存は最大 ${BULK_LIMIT} 枚までにしています（端末制限で落ちにくくするため）`);
    return;
  }

  // open each in new tab (most stable)
  showOverlay("処理中…", "一括保存の準備中…", `${ids.length} 枚`);

  // let overlay render first
  await sleep(80);

  hideOverlay();

  for (let i = 0; i < ids.length; i++) {
    const url = cldOpen(ids[i]);
    window.open(url, "_blank", "noopener");
    await sleep(200);
  }

  selected.clear();
  syncSelectionUI();
  refreshSelectionMarks();
}

/* =========================
   TOAST (simple)
========================= */
let toastTimer = null;
function toast(msg) {
  // minimal toast (no CSS dependency)
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = `
      position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
      padding: 10px 14px; border-radius: 12px; background: rgba(0,0,0,.78);
      color: #fff; font-size: 13px; z-index: 9999; max-width: 92vw;
      box-shadow: 0 10px 30px rgba(0,0,0,.2);
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.display = "none";
  }, 1800);
}
