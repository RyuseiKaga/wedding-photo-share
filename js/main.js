document.addEventListener("DOMContentLoaded", () => {
  const gallery = document.getElementById("gallery");

  // ダミー画像（正方形）
  const dummyPhotos = [
    "https://placehold.co/600x600?text=Photo+1",
    "https://placehold.co/600x600?text=Photo+2",
    "https://placehold.co/600x600?text=Photo+3",
    "https://placehold.co/600x600?text=Photo+4",
    "https://placehold.co/600x600?text=Photo+5",
    "https://placehold.co/600x600?text=Photo+6",
    "https://placehold.co/600x600?text=Photo+7",
    "https://placehold.co/600x600?text=Photo+8",
    "https://placehold.co/600x600?text=Photo+9"
  ];

  dummyPhotos.forEach((src, index) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    const img = document.createElement("img");
    img.src = src;
    img.alt = `photo ${index + 1}`;

    const likeBtn = document.createElement("button");
    likeBtn.className = "like";
    likeBtn.textContent = "❤️ 0";

    card.appendChild(img);
    card.appendChild(likeBtn);
    gallery.appendChild(card);
  });
});

