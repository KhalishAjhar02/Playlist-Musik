const fileInput = document.getElementById('fileInput');
const videoPlayer = document.getElementById('mainPlayer');
const playlistElement = document.getElementById('playlist');

let playlist = [];
let currentIndex = 0;

fileInput.addEventListener('change', function() {
    const files = Array.from(this.files);
    
    files.forEach((file) => {
        const fileURL = URL.createObjectURL(file);
        playlist.push({ name: file.name, url: fileURL });
    });

    renderPlaylist();

    // Langsung putar jika player masih kosong
    if (playlist.length > 0 && videoPlayer.src === "") {
        playMedia(0);
    }
});

function renderPlaylist() {
    playlistElement.innerHTML = "";
    playlist.forEach((item, index) => {
        const li = document.createElement('li');
        li.textContent = item.name;
        li.onclick = () => playMedia(index);
        if (index === currentIndex) li.classList.add('active');
        playlistElement.appendChild(li);
    });
}

function playMedia(index) {
    currentIndex = index;
    videoPlayer.src = playlist[index].url;
    videoPlayer.play();
    renderPlaylist();
}

// Otomatis lanjut ke video berikutnya
videoPlayer.addEventListener('ended', function() {
    if (currentIndex + 1 < playlist.length) {
        playMedia(currentIndex + 1);
    }
});