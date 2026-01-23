const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

let photos = [
  { id: "photo1", src: "https://placehold.co/600x600?text=Photo+1", likes: 0 },
  { id: "photo2", src: "https://placehold.co/600x600?text=Photo+2", likes: 0 },
  { id: "photo3", src: "https://placehold.co/600x600?text=Photo+3", likes: 0 },
  { id: "photo4", src: "https://placehold.co/600x600?text=Photo+4", likes: 0 },
  { id: "photo5", src: "https://placehold.co/600x600?text=Photo+5", likes: 0 },
  { id: "photo6", src: "https://placehold.co/600x600?text=Photo+6", likes: 0 },
  { id: "photo7", src: "https://placehold.co/600x600?text=Photo+7", likes: 0 },
  { id: "photo8", src: "https://placehold.co/600x600?text=Photo+8", likes: 0 },
  { id: "photo9", src: "https://placehold.co/600x600?text=Photo+9", likes: 0 },
  { id: "photo10", src: "https://placehold.co/600x600?text=Photo+10", likes: 0 },
];

const gallery = document.getElementById("gallery");
let lastTopId = null;

// 写真ごとの「処理中」フラグ（連打・競合防止）
const inflight = new Map();

function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

async function hydrateLikes() {
  for (const p of photos) {
    try {
      const res = await fetch(`${API_BASE}/likes?id=${encodeURIComponent(p.id)}`);
      const data = await res.json();
      p.likes = Number(data.likes) || 0;
    } catch {
      // 通信失敗時は0のまま
    }
  }
}

async function likeOnServer(photo) {
  const res = await fetch(`${API_BASE}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: photo.id }),
  });
  const data = await res.json();
  // サーバの値を唯一の真実にする
  photo.likes = Number(data.likes) || photo.likes;
}

function render() {
  gallery.innerHTML = "";

  const topPhotos = [...photos]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 9);

  const currentTopId = topPhotos[0]?.id;

  topPhotos.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    if (index === 0) {
      card.classList.add("rank-1");
      if (lastTopId && lastTopId !== photo.id) {
        card.classList.add("pop");
      }
    }

    const img = document.createElement("img");
    img.src = photo.src;
    img.alt = photo.id;

    const likeBtn = document.createElement("button");
    likeBtn.className = "like";

    const busy = inflight.get(photo.id) === true;
    likeBtn.disabled = busy;
    likeBtn.style.opacity = busy ? "0.6" : "1";
    likeBtn.textContent = `${getCrown(index)} ❤️ ${photo.likes}${busy ? "…" : ""}`;

    likeBtn.addEventListener("click", async () => {
      if (inflight.get(photo.id)) return; // 念のため
      inflight.set(photo.id, true);
      render();

      try {
        await likeOnServer(photo);
      } catch {
        // 失敗時はそのまま（必要なら alert を入れてもOK）
      } finally {
        inflight.set(photo.id, false);
        render();
      }
    });

    card.appendChild(img);
    card.appendChild(likeBtn);
    gallery.appendChild(card);
  });

  lastTopId = currentTopId;
}

(async () => {
  await hydrateLikes();
  render();
})();
