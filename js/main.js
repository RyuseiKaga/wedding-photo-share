/* =========================
   CONFIG
========================= */

const CLOUD_NAME = "dmei50xsu";   // ←あなたのCloud name
const TAG_NAME = "wedding_2026";  // 使っているタグ
const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";// Worker URL

/* =========================
   STATE
========================= */

let photos = [];
let likesMap = {};
let page = 1;
let loading = false;
let hasMore = true;

/* =========================
   Cloudinary URL builders
========================= */

// 一覧（超軽量）
function cldThumb(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_360/${publicId}`;
}

// ビュー表示（中画質）
function cldView(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_jpg,q_auto:good,w_1400,fl_progressive/${publicId}`;
}

// 保存用（高画質・Eager済み）
function cldOpen(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_1800,q_auto:eco,f_jpg,fl_progressive/${publicId}`;
}

/* =========================
   INIT
========================= */

document.addEventListener("DOMContentLoaded", () => {
  loadPhotos();
  setupInfiniteScroll();
});

/* =========================
   LOAD PHOTOS
========================= */

async function loadPhotos() {
  if (loading || !hasMore) return;
  loading = true;

  const url = `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${TAG_NAME}.json?page=${page}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      hasMore = false;
      return;
    }

    const data = await res.json();

    if (!data.resources.length) {
      hasMore = false;
      return;
    }

    photos.push(...data.resources);
    renderPhotos(data.resources);

    page++;
  } catch (e) {
    console.error("Load error:", e);
  }

  loading = false;
}

/* =========================
   RENDER
========================= */

function renderPhotos(newPhotos) {
  const grid = document.getElementById("photoGrid");

  newPhotos.forEach(photo => {
    const div = document.createElement("div");
    div.className = "photo-card";

    div.innerHTML = `
      <img src="${cldThumb(photo.public_id)}"
           data-id="${photo.public_id}"
           loading="lazy" />
      <div class="like-bar">
        <button onclick="likePhoto('${photo.public_id}')">❤️</button>
        <span id="like-${photo.public_id}">0</span>
      </div>
    `;

    div.querySelector("img").onclick = () => openViewer(photo.public_id);

    grid.appendChild(div);
  });
}

/* =========================
   VIEWER
========================= */

function openViewer(publicId) {
  const overlay = document.getElementById("viewerOverlay");
  const img = document.getElementById("viewerImage");

  overlay.style.display = "flex";
  img.src = cldView(publicId);

  document.getElementById("downloadBtn").onclick = () => {
    window.open(cldOpen(publicId), "_blank");
  };
}

function closeViewer() {
  document.getElementById("viewerOverlay").style.display = "none";
}

/* =========================
   LIKES
========================= */

async function likePhoto(publicId) {
  try {
    const res = await fetch(`${}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: publicId })
    });

    const data = await res.json();
    document.getElementById(`like-${publicId}`).innerText = data.likes;
  } catch (e) {
    console.error("Like error:", e);
  }
}

/* =========================
   INFINITE SCROLL
========================= */

function setupInfiniteScroll() {
  window.addEventListener("scroll", () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
      loadPhotos();
    }
  });
}
