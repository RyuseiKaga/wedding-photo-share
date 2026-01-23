const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";

const gallery = document.getElementById("gallery");
const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewerImg");
const viewerLoading = document.getElementById("viewerLoading");
const viewerOpen = document.getElementById("viewerOpen");
const viewerClose = document.getElementById("viewerClose");

/* =========================
   Cloudinary URLs
   ========================= */
function cldThumb(id) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_360,h_360,q_auto,f_auto/${id}`;
}

function cldView(id) {
  // Safari安定：JPG固定・上限1600
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_1600,q_auto:good,f_jpg,fl_progressive/${id}`;
}

function cldOpen(id) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_3000,q_auto:best,f_jpg,fl_progressive/${id}`;
}

/* =========================
   Viewer Loading Helpers
   ========================= */
function showViewerLoading() {
  viewerLoading.hidden = false;
  viewerLoading.style.display = "grid";
}

function hideViewerLoading() {
  viewerLoading.hidden = true;
  viewerLoading.style.display = "none";
}

/* =========================
   Viewer (プリロード方式)
   ========================= */
function openViewer(photo) {
  viewer.hidden = false;
  document.body.classList.add("no-scroll");

  viewerOpen.href = cldOpen(photo.id);

  // まずサムネを即表示
  viewerImg.src = cldThumb(photo.id);

  showViewerLoading();

  const highUrl = cldView(photo.id);
  const pre = new Image();

  const timer = setTimeout(() => {
    hideViewerLoading();
    console.warn("viewer timeout");
  }, 12000);

  pre.onload = () => {
    clearTimeout(timer);
    viewerImg.src = highUrl;
    hideViewerLoading();
  };

  pre.onerror = () => {
    clearTimeout(timer);
    hideViewerLoading();
    console.warn("viewer load error");
  };

  pre.src = highUrl;
}

viewerClose.addEventListener("click", () => {
  viewer.hidden = true;
  document.body.classList.remove("no-scroll");
});

/* =========================
   Load gallery
   ========================= */
async function loadPhotos() {
  const res = await fetch(
    `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${TAG}.json`,
    { cache: "no-store" }
  );
  const data = await res.json();

  gallery.innerHTML = "";

  data.resources.forEach((r) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    const img = document.createElement("img");
    img.src = cldThumb(r.public_id);
    img.loading = "lazy";

    img.addEventListener("click", () =>
      openViewer({ id: r.public_id })
    );

    const like = document.createElement("div");
    like.className = "like";
    like.textContent = "❤️";

    card.appendChild(img);
    card.appendChild(like);
    gallery.appendChild(card);
  });
}

/* =========================
   Init
   ========================= */
loadPhotos();
