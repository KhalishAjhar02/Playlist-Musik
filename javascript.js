(function () {
  // Dukungan audio + video (termasuk MP4)
  var AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus|weba|webm|mp4|m4v|mov)$/i;
  var VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv)$/i;
  var ORDER_KEY = "musik-lokal-urutan";
  var COLS_KEY = "musik-lokal-koleksi";
  var DEFAULT_COL = "umum";
  var $ = function (id) { return document.getElementById(id); };
  var audio = $("audio"), video = $("videoPreview"), artEl = $("art");
  var listEl = $("list"), msgEl = $("msg"), playerEl = $("player");
  var tracks = [], current = -1, currentUrl = null;
  var cols = [{ id: DEFAULT_COL, name: "Umum" }];
  var view = "all";          // "all" atau id koleksi
  var colMode = "new";       // "new" atau "rename"
  var shuffle = false, repeat = 0, filter = "", dbp = null, seeking = false;
  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  $("toggle").innerHTML = ICON_PLAY;

  function isVideoFile(name, mime) {
    if (mime && mime.indexOf("video/") === 0) return true;
    return VIDEO_EXT.test(name || "");
  }
  function isPlayable(file) {
    if (file.type && (file.type.indexOf("audio/") === 0 || file.type.indexOf("video/") === 0)) return true;
    return AUDIO_EXT.test(file.name);
  }

  // ---------- util ----------
  function hueOf(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }
  function setPct(el) {
    var max = parseFloat(el.max) || 0, v = parseFloat(el.value) || 0;
    el.style.setProperty("--pct", (max ? (v / max) * 100 : 0) + "%");
  }
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function cleanName(n) { return n.replace(/\.[^.]+$/, "").replace(/_+/g, " "); }
  function say(text, isErr) { msgEl.textContent = text; msgEl.className = "msg" + (isErr ? " err" : ""); }
  function readDuration(t) {
    return new Promise(function (resolve) {
      var el = isVideoFile(t.name, t.blob && t.blob.type) ? document.createElement("video") : new Audio();
      var u = URL.createObjectURL(t.blob);
      var done = function () { URL.revokeObjectURL(u); resolve(); };
      el.preload = "metadata";
      el.onloadedmetadata = function () { t.duration = el.duration; done(); };
      el.onerror = done;
      el.src = u;
    });
  }

  // ---------- penyimpanan (IndexedDB) ----------
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open("playlist-musik-lokal", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("tracks", { keyPath: "id" }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("tracks", mode), r = fn(t.objectStore("tracks"));
        t.oncomplete = function () { resolve(r && r.result); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function record(t) { return { id: t.id, name: t.name, size: t.size, blob: t.blob, col: t.col }; }
  function persistTrack(t) { return tx("readwrite", function (s) { return s.put(record(t)); }); }
  function saveOrder() {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(tracks.map(function (t) { return t.id; }))); } catch (e) {}
  }
  function saveCols() {
    try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch (e) {}
  }
  function loadCols() {
    try {
      var c = JSON.parse(localStorage.getItem(COLS_KEY));
      if (Array.isArray(c) && c.length) cols = c;
    } catch (e) {}
    if (!cols.some(function (c) { return c.id === DEFAULT_COL; })) cols.unshift({ id: DEFAULT_COL, name: "Umum" });
  }

  // ---------- koleksi ----------
  function colById(id) {
    for (var i = 0; i < cols.length; i++) if (cols[i].id === id) return cols[i];
    return null;
  }
  function colName(id) { var c = colById(id); return c ? c.name : "Umum"; }
  function findColByName(name, exceptId) {
    var n = name.trim().toLowerCase();
    for (var i = 0; i < cols.length; i++) if (cols[i].name.toLowerCase() === n && cols[i].id !== exceptId) return cols[i];
    return null;
  }
  function ensureCol(name) {
    name = name.trim().slice(0, 40) || "Umum";
    var f = findColByName(name);
    if (f) return f;
    var c = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name };
    cols.push(c);
    return c;
  }
  function countIn(id) {
    return tracks.filter(function (t) { return id === "all" || t.col === id; }).length;
  }
  function visibleIdx() {
    var out = [];
    tracks.forEach(function (t, i) { if (view === "all" || t.col === view) out.push(i); });
    return out;
  }
  function setView(v) {
    view = (v === "all" || colById(v)) ? v : "all";
    if (view !== "all") $("target").value = view;
    closeColForm();
    render();
  }
  function rebuildTarget() {
    var sel = $("target"), prev = sel.value || (view !== "all" ? view : DEFAULT_COL);
    sel.innerHTML = "";
    cols.forEach(function (c) {
      var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    sel.value = colById(prev) ? prev : DEFAULT_COL;
  }
  function openColForm(mode) {
    colMode = mode;
    $("colForm").hidden = false;
    $("colName").value = mode === "rename" ? colName(view) : "";
    $("colName").placeholder = mode === "rename" ? "Nama baru koleksi" : "Nama koleksi baru";
    $("colName").focus();
  }
  function closeColForm() { $("colForm").hidden = true; $("colName").value = ""; }

  function renderCols() {
    var box = $("cols"); box.innerHTML = "";
    function chip(id, label, count) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chipbtn" + (view === id ? " on" : "");
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", view === id ? "true" : "false");
      var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = label;
      var sm = document.createElement("small"); sm.textContent = count;
      b.appendChild(nm); b.appendChild(sm);
      b.onclick = function () { setView(id); };
      box.appendChild(b);
    }
    chip("all", "Semua", countIn("all"));
    cols.forEach(function (c) { chip(c.id, c.name, countIn(c.id)); });
    var add = document.createElement("button");
    add.type = "button"; add.className = "chipbtn new"; add.textContent = "+ Koleksi baru";
    add.onclick = function () { openColForm("new"); };
    box.appendChild(add);
  }

  $("colForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("colName").value.trim();
    if (!name) return;
    if (colMode === "rename") {
      var c = colById(view);
      if (!c) return;
      if (findColByName(name, c.id)) { say("Sudah ada koleksi dengan nama itu.", true); return; }
      c.name = name; saveCols(); rebuildTarget(); closeColForm(); render(); say("Nama koleksi diubah.");
    } else {
      if (findColByName(name)) { say("Sudah ada koleksi dengan nama itu.", true); return; }
      var n = ensureCol(name); saveCols(); rebuildTarget(); setView(n.id); say("Koleksi \"" + n.name + "\" dibuat. File yang kamu tambahkan akan masuk ke sini.");
    }
  });
  $("colCancel").onclick = closeColForm;
  $("renameCol").onclick = function () { if (view !== "all") openColForm("rename"); };
  $("delCol").onclick = function () {
    if (view === "all" || view === DEFAULT_COL) return;
    if (this.dataset.sure !== "1") {
      var b = this; b.dataset.sure = "1"; b.textContent = "Yakin? Klik lagi";
      setTimeout(function () { b.dataset.sure = ""; b.textContent = "Hapus koleksi"; }, 3000);
      return;
    }
    this.dataset.sure = ""; this.textContent = "Hapus koleksi";
    var gone = view, moved = 0;
    tracks.forEach(function (t) { if (t.col === gone) { t.col = DEFAULT_COL; persistTrack(t); moved++; } });
    cols = cols.filter(function (c) { return c.id !== gone; });
    saveCols(); rebuildTarget(); setView("all");
    say("Koleksi dihapus. " + moved + " lagu dipindah ke Umum.");
  };
  $("target").addEventListener("change", function () { if (view !== "all") setView(this.value); });

  // ---------- menambah file ----------
  function folderOf(f) {
    var p = f.webkitRelativePath ? f.webkitRelativePath.split("/") : [];
    if (p.length >= 3) return p[1];   // Musik/Album/lagu.mp3 -> koleksi "Album"
    if (p.length === 2) return p[0];  // Album/lagu.mp3 -> koleksi "Album"
    return "";
  }
  function addFiles(fileList, byFolder) {
    var all = Array.prototype.slice.call(fileList);
    var good = all.filter(isPlayable);
    if (!good.length) { say("Tidak ada file musik/video yang dikenali (mp3, wav, ogg, m4a, flac, aac, mp4, mov).", true); return; }
    var skipped = all.length - good.length, added = [], chain = Promise.resolve();
    var targetId = $("target").value || DEFAULT_COL;
    say("Menambahkan " + good.length + " file…");
    good.forEach(function (f) {
      chain = chain.then(function () {
        var dup = tracks.some(function (t) { return t.name === cleanName(f.name) && t.blob.size === f.size; });
        if (dup) return;
        var colId = targetId;
        if (byFolder) { var fn = folderOf(f); if (fn) colId = ensureCol(fn).id; }
        var t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: cleanName(f.name), size: f.size, blob: f, duration: 0, col: colId };
        return readDuration(t).then(function () { return persistTrack(t); }).then(function () { tracks.push(t); added.push(t); });
      });
    });
    chain.then(function () {
      saveOrder(); saveCols(); rebuildTarget();
      var ids = [], names = [];
      added.forEach(function (t) { if (ids.indexOf(t.col) < 0) { ids.push(t.col); names.push(colName(t.col)); } });
      if (ids.length === 1) setView(ids[0]); else if (ids.length > 1) setView("all"); else render();
      var dupCount = good.length - added.length;
      say(added.length + " lagu/video ditambahkan" + (names.length ? " ke koleksi " + names.join(", ") : "") + "." +
          (dupCount ? " " + dupCount + " file sudah ada." : "") + (skipped ? " " + skipped + " file bukan media dilewati." : ""));
      if (current === -1 && added.length) play(tracks.indexOf(added[0]), false);
    }).catch(function () {
      say("Gagal menyimpan ke browser (penyimpanan penuh atau mode privat). File tetap bisa diputar di sesi ini.", true);
      render();
    });
  }

  // ---------- pemutar ----------
  function setTheme(name) { document.documentElement.style.setProperty("--hue", name ? hueOf(name) : 152); }
  function updateNow() {
    if (current < 0 || !tracks[current]) {
      $("nowTitle").textContent = "Belum ada lagu"; $("nowInfo").textContent = "Tambahkan file musik atau video untuk mulai"; return;
    }
    var t = tracks[current], q = visibleIdx(), pos = q.indexOf(current);
    $("nowTitle").textContent = t.name;
    $("nowInfo").textContent = colName(t.col) + (pos >= 0 ? " · lagu " + (pos + 1) + " dari " + q.length : "");
  }
  function resetNow() {
    current = -1; setTheme(""); updateNow();
    $("seek").value = 0; $("seek").max = 0; setPct($("seek")); $("cur").textContent = "0:00"; $("total").textContent = "0:00";
    artEl.classList.remove("has-video");
    try { video.removeAttribute("src"); video.load(); } catch (e) {}
  }
  function play(i, autoStart) {
    if (i < 0 || i >= tracks.length) return;
    current = i;
    var t = tracks[i];
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(t.blob);
    audio.src = currentUrl;
    setTheme(t.name);

    // Tampilkan video jika file MP4/video
    if (isVideoFile(t.name, t.blob && t.blob.type)) {
      artEl.classList.add("has-video");
      video.src = currentUrl;
      video.currentTime = audio.currentTime || 0;
    } else {
      artEl.classList.remove("has-video");
      try { video.removeAttribute("src"); video.load(); } catch (e) {}
    }

    if (autoStart !== false) {
      audio.play().catch(function () {});
      if (isVideoFile(t.name, t.blob && t.blob.type)) video.play().catch(function () {});
    }
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: colName(t.col) }); } catch (e) {}
    }
    render();
  }
  function step(dir) {
    var q = visibleIdx();
    if (!q.length) return;
    var pos = q.indexOf(current), n;
    if (shuffle && q.length > 1) { do { n = q[Math.floor(Math.random() * q.length)]; } while (n === current); }
    else if (pos < 0) n = dir > 0 ? q[0] : q[q.length - 1];
    else n = q[(pos + dir + q.length) % q.length];
    play(n);
  }
  function toggle() {
    if (current === -1) { var q = visibleIdx(); if (q.length) play(q[0]); return; }
    if (!audio.src) return;
    if (audio.paused) {
      audio.play().catch(function () {});
      if (artEl.classList.contains("has-video")) video.play().catch(function () {});
    } else {
      audio.pause();
      try { video.pause(); } catch (e) {}
    }
  }

  audio.addEventListener("play", function () {
    $("toggle").innerHTML = ICON_PAUSE; $("toggle").setAttribute("aria-label", "Jeda");
    playerEl.classList.add("playing"); document.body.classList.add("playing");
    initAnalyser(); startViz();
    if (artEl.classList.contains("has-video")) video.play().catch(function () {});
  });
  audio.addEventListener("pause", function () {
    $("toggle").innerHTML = ICON_PLAY; $("toggle").setAttribute("aria-label", "Putar");
    playerEl.classList.remove("playing"); document.body.classList.remove("playing");
    try { video.pause(); } catch (e) {}
  });
  audio.addEventListener("loadedmetadata", function () {
    $("seek").max = audio.duration || 0; $("total").textContent = fmt(audio.duration); setPct($("seek"));
  });
  audio.addEventListener("timeupdate", function () {
    if (!seeking) { $("seek").value = audio.currentTime; setPct($("seek")); }
    $("cur").textContent = fmt(audio.currentTime);
    // sinkronisasi video dengan audio
    if (artEl.classList.contains("has-video") && Math.abs((video.currentTime || 0) - audio.currentTime) > 0.35) {
      try { video.currentTime = audio.currentTime; } catch (e) {}
    }
  });
  audio.addEventListener("ended", function () {
    if (repeat === 2) { audio.currentTime = 0; audio.play(); return; }
    if (repeat === 0 && !shuffle) {
      var q = visibleIdx();
      if (q.length && q.indexOf(current) === q.length - 1) return;
    }
    step(1);
  });
  audio.addEventListener("error", function () {
    if (audio.src) say("File tidak bisa diputar oleh browser: " + (tracks[current] ? tracks[current].name : ""), true);
  });

  $("seek").addEventListener("input", function () { seeking = true; $("cur").textContent = fmt(this.value); setPct(this); });
  $("seek").addEventListener("change", function () {
    var v = parseFloat(this.value);
    audio.currentTime = v;
    if (artEl.classList.contains("has-video")) { try { video.currentTime = v; } catch (e) {} }
    seeking = false;
  });
  $("vol").addEventListener("input", function () {
    audio.volume = parseFloat(this.value); setPct(this);
    try { localStorage.setItem("musik-lokal-volume", this.value); } catch (e) {}
  });
  $("toggle").onclick = toggle;
  $("next").onclick = function () { step(1); };
  $("prev").onclick = function () { if (audio.currentTime > 3) { audio.currentTime = 0; try { video.currentTime = 0; } catch (e) {} } else step(-1); };
  $("shuffle").onclick = function () {
    shuffle = !shuffle; this.classList.toggle("on", shuffle);
    this.title = "Acak: " + (shuffle ? "nyala" : "mati"); this.setAttribute("aria-label", this.title);
  };
  $("repeat").onclick = function () {
    repeat = (repeat + 1) % 3;
    var label = ["mati", "semua", "satu lagu"][repeat];
    this.classList.toggle("on", repeat > 0);
    if (repeat === 2) this.setAttribute("data-badge", "1"); else this.removeAttribute("data-badge");
    this.title = "Ulangi: " + label; this.setAttribute("aria-label", this.title);
  };
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", toggle);
      navigator.mediaSession.setActionHandler("pause", toggle);
      navigator.mediaSession.setActionHandler("nexttrack", function () { step(1); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { step(-1); });
    } catch (e) {}
  }
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.code === "Space" && tag !== "input" && tag !== "button" && tag !== "label" && tag !== "select") { e.preventDefault(); toggle(); }
  });

  // ---------- visualizer ----------
  var actx = null, analyser = null, vizOn = false, canvas = $("viz"), cctx = canvas.getContext("2d");
  function initAnalyser() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        var src = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.82;
        src.connect(analyser); analyser.connect(actx.destination);
      } catch (e) { actx = null; analyser = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
  }
  function fitCanvas() {
    var r = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
  }
  function startViz() { if (!vizOn) { vizOn = true; requestAnimationFrame(draw); } }
  function draw() {
    fitCanvas();
    var w = canvas.width, h = canvas.height, bars = 36, gap = 3 * (window.devicePixelRatio || 1);
    var bw = (w - gap * (bars - 1)) / bars, data = null;
    if (analyser) { data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    var hue = getComputedStyle(document.documentElement).getPropertyValue("--hue").trim() || 152;
    cctx.clearRect(0, 0, w, h);
    for (var i = 0; i < bars; i++) {
      var v = data ? data[Math.floor(i * (data.length * 0.75) / bars)] / 255 : 0;
      var bh = Math.max(3, v * h);
      cctx.fillStyle = "hsla(" + hue + ", 85%, " + (55 + v * 15) + "%, " + (0.35 + v * 0.65) + ")";
      var x = i * (bw + gap), r = Math.min(bw / 2, bh / 2);
      cctx.beginPath();
      if (cctx.roundRect) cctx.roundRect(x, h - bh, bw, bh, r); else cctx.rect(x, h - bh, bw, bh);
      cctx.fill();
    }
    if (!audio.paused) requestAnimationFrame(draw); else vizOn = false;
  }

  // ---------- daftar lagu ----------
  function move(i, dir) {
    var vis = visibleIdx(), p = vis.indexOf(i), j = vis[p + dir];
    if (p < 0 || j === undefined) return;
    var cur = current >= 0 ? tracks[current] : null, tmp = tracks[i];
    tracks[i] = tracks[j]; tracks[j] = tmp;
    current = cur ? tracks.indexOf(cur) : -1;
    saveOrder(); render();
  }
  function moveToCol(i, colId) {
    tracks[i].col = colId; persistTrack(tracks[i]);
    say("Dipindah ke koleksi " + colName(colId) + ".");
    render();
  }
  function remove(i) {
    var t = tracks[i], was = i === current;
    tx("readwrite", function (s) { return s.delete(t.id); });
    tracks.splice(i, 1);
    if (was) { audio.pause(); audio.removeAttribute("src"); audio.load(); resetNow(); }
    else if (i < current) current--;
    saveOrder(); render();
  }
  function icon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }
  function render() {
    renderCols();
    var vis = visibleIdx();
    $("listTitle").textContent = view === "all" ? "Semua musik &amp; video" : colName(view);
    $("count").textContent = vis.length + " lagu";
    $("renameCol").hidden = view === "all";
    $("delCol").hidden = view === "all" || view === DEFAULT_COL;
    $("clear").textContent = view === "all" ? "Kosongkan semua" : "Kosongkan koleksi";
    $("clear").dataset.sure = "";
    updateNow();
    listEl.innerHTML = "";

    if (!vis.length) {
      var e = document.createElement("li"); e.className = "empty";
      var global = !tracks.length;
      e.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
        '<b>' + (global ? "Daftar putar masih kosong" : "Koleksi ini masih kosong") + '</b>' +
        (global ? "Pilih file audio atau video MP4 dari komputer kamu untuk mulai." : "Tambahkan file dengan kolom \"Simpan file ke koleksi\" di atas, atau pindahkan lagu dari koleksi lain.");
      listEl.appendChild(e); return;
    }
    var shown = 0;
    vis.forEach(function (i, pos) {
      var t = tracks[i];
      if (filter && t.name.toLowerCase().indexOf(filter) === -1) return;
      shown++;
      var li = document.createElement("li"); li.className = "row" + (i === current ? " active" : "");
      var h = hueOf(t.name);
      var vid = isVideoFile(t.name, t.blob && t.blob.type);

      var thumb = document.createElement("div"); thumb.className = "thumb";
      thumb.style.background = "linear-gradient(135deg, hsl(" + h + " 65% 42%), hsl(" + (h + 55) + " 65% 26%))";
      thumb.innerHTML = '<span class="n">' + (pos + 1) + '</span><span class="eq"><i></i><i></i><i></i></span>' +
        (vid ? '<span class="vid-badge">MP4</span>' : '');
      thumb.onclick = function () { if (i === current) toggle(); else play(i); };

      var meta = document.createElement("div"); meta.className = "meta"; meta.tabIndex = 0;
      var s = document.createElement("strong"); s.textContent = t.name;
      var sm = document.createElement("small");
      sm.textContent = (view === "all" ? colName(t.col) + " · " : "") + (vid ? "video" : "audio") + " · " + (t.blob.size / 1048576).toFixed(1) + " MB";
      meta.appendChild(s); meta.appendChild(sm);
      meta.onclick = function () { if (i === current) toggle(); else play(i); };
      meta.onkeydown = function (ev) { if (ev.key === "Enter") play(i); };

      var dur = document.createElement("div"); dur.className = "dur"; dur.textContent = t.duration ? fmt(t.duration) : "";

      var acts = document.createElement("div"); acts.className = "acts";
      var mv = document.createElement("select");
      mv.title = "Pindah ke koleksi"; mv.setAttribute("aria-label", "Pindah ke koleksi");
      cols.forEach(function (c) {
        var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; mv.appendChild(o);
      });
      mv.value = t.col;
      mv.onchange = function () { moveToCol(i, mv.value); };
      acts.appendChild(mv);
      [["Naikkan", '<path d="m18 15-6-6-6 6"/>', function () { move(i, -1); }, "move"],
       ["Turunkan", '<path d="m6 9 6 6 6-6"/>', function () { move(i, 1); }, "move"],
       ["Hapus", '<path d="M18 6 6 18M6 6l12 12"/>', function () { remove(i); }, "del"]].forEach(function (d) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ib " + d[3]; b.title = d[0]; b.setAttribute("aria-label", d[0]);
        b.innerHTML = icon(d[1]); b.onclick = d[2]; acts.appendChild(b);
      });

      li.appendChild(thumb); li.appendChild(meta); li.appendChild(dur); li.appendChild(acts);
      listEl.appendChild(li);
    });
    if (!shown) {
      var n = document.createElement("li"); n.className = "empty";
      n.innerHTML = "<b>Tidak ada hasil</b>Tidak ada lagu yang cocok dengan pencarian.";
      listEl.appendChild(n);
    }
  }

  $("search").addEventListener("input", function () { filter = this.value.trim().toLowerCase(); render(); });
  $("clear").onclick = function () {
    var ids = tracks.filter(function (t) { return view === "all" || t.col === view; }).map(function (t) { return t.id; });
    if (!ids.length) return;
    if (this.dataset.sure !== "1") {
      var b = this; b.dataset.sure = "1"; b.textContent = "Yakin? Klik lagi";
      setTimeout(function () { if (b.dataset.sure === "1") { b.dataset.sure = ""; b.textContent = view === "all" ? "Kosongkan semua" : "Kosongkan koleksi"; } }, 3000);
      return;
    }
    var cur = current >= 0 ? tracks[current] : null;
    tx("readwrite", function (s) { ids.forEach(function (id) { s.delete(id); }); });
    tracks = tracks.filter(function (t) { return ids.indexOf(t.id) < 0; });
    if (cur && ids.indexOf(cur.id) >= 0) { audio.pause(); audio.removeAttribute("src"); audio.load(); resetNow(); }
    else current = cur ? tracks.indexOf(cur) : -1;
    saveOrder(); render(); say(ids.length + " lagu dihapus.");
  };

  // ---------- input file & seret-lepas ----------
  $("files").addEventListener("change", function () { addFiles(this.files, false); this.value = ""; });
  $("folder").addEventListener("change", function () { addFiles(this.files, true); this.value = ""; });
  var dragDepth = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  document.addEventListener("dragenter", function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
  document.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("dragleave", function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
  document.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, false);
  });

  // ---------- muat saat dibuka ----------
  loadCols(); rebuildTarget();
  try { var v = localStorage.getItem("musik-lokal-volume"); if (v !== null) $("vol").value = v; } catch (e) {}
  audio.volume = parseFloat($("vol").value); setPct($("vol"));
  window.addEventListener("resize", function () { if (audio.paused) { fitCanvas(); cctx.clearRect(0, 0, canvas.width, canvas.height); } });
  fitCanvas(); draw(); render();

  tx("readonly", function (s) { return s.getAll(); }).then(function (rows) {
    rows = rows || [];
    var order = [];
    try { order = JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch (e) {}
    rows.sort(function (a, b) {
      var ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });
    tracks = rows.map(function (r) {
      return { id: r.id, name: r.name, size: r.size, blob: r.blob, duration: 0, col: colById(r.col) ? r.col : DEFAULT_COL };
    });
    render();
    if (tracks.length) say(tracks.length + " lagu/video dimuat dari penyimpanan browser.");
    return tracks.reduce(function (p, t) { return p.then(function () { return readDuration(t); }).then(function () { render(); }); }, Promise.resolve());
  }).catch(function () { render(); });
})();