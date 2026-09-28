"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SRC_LABEL = { netease: "\u7F51\u6613\u4E91", tencent: "QQ", kugou: "\u9177\u72D7", kuwo: "\u9177\u6211", migu: "\u54AA\u5495" };
const THEME_LIST = [
  { id: "t1", lab: "\u6D45 \xB7 \u6781\u7B80", a: "#1e4fd6", b: "#ffffff" },
  { id: "t2", lab: "\u6D45 \xB7 \u6E05\u65B0", a: "#0f7a6c", b: "#f2f2ee" },
  { id: "t3", lab: "\u6DF1 \xB7 \u901A\u900F", a: "#52d8c0", b: "#12151c" },
  { id: "t4", lab: "\u6DF1 \xB7 \u6C89\u6D78", a: "#f2f2ee", b: "#000000" }
];
const Q_NAMES = { master: "Master", atmos_plus: "Atmos+", atmos: "Atmos", hires: "Hires", lossless: "Flac", high: "320K", standard: "128K" };
const el = {
  searchInput: $("#searchInput"),
  searchBtn: $("#searchBtn"),
  playlistBtn: $("#playlistBtn"),
  queueBtn: $("#queueBtn"),
  queueCount: $("#queueCount"),
  resultTitle: $("#resultTitle"),
  resultMeta: $("#resultMeta"),
  results: $("#results"),
  backBtn: $("#backBtn"),
  searchTabs: $("#searchTabs"),
  engineBar: $("#engineBar"),
  engineBtn: $("#engineBtn"),
  engineMenu: $("#engineMenu"),
  engineName: $("#engineName"),
  engineMs: $("#engineMs"),
  cntSong: $("#cntSong"),
  cntAlbum: $("#cntAlbum"),
  cntPlaylist: $("#cntPlaylist"),
  viewSearch: $("#viewSearch"),
  viewQueue: $("#viewQueue"),
  expandBtn: $("#expandBtn"),
  immersive: $("#immersive"),
  immClose: $("#immClose"),
  immCover: $("#immCover"),
  immBgImg: $("#immBgImg"),
  immName: $("#immName"),
  immArtist: $("#immArtist"),
  immTags: $("#immTags"),
  immPrev: $("#immPrev"),
  immPlay: $("#immPlay"),
  immNext: $("#immNext"),
  immLyricInner: $("#immLyricInner"),
  immTone: $("#immTone"),
  progressLine: $("#progressLine"),
  progressFill: $("#progressFill"),
  progressThumb: $("#progressThumb"),
  pTrack: $("#pTrack"),
  pCover: $("#pCover"),
  pName: $("#pName"),
  pArtist: $("#pArtist"),
  prevBtn: $("#prevBtn"),
  playBtn: $("#playBtn"),
  nextBtn: $("#nextBtn"),
  loopBtn: $("#loopBtn"),
  tCur: $("#tCur"),
  tDur: $("#tDur"),
  miniLyric: $("#miniLyric"),
  lyricBtn: $("#lyricBtn"),
  qualityBtn: $("#qualityBtn"),
  player: $("#player"),
  viewHistory: $("#viewHistory"),
  historyList: $("#historyList"),
  historyClear: $("#historyClear"),
  volSlider: $("#volSlider"),
  qualityPop: $("#qualityPop"),
  qualityNow: $("#qualityNow"),
  playlistModal: $("#playlistModal"),
  playlistUrl: $("#playlistUrl"),
  playlistCancel: $("#playlistCancel"),
  playlistGo: $("#playlistGo"),
  queueList: $("#queueList"),
  clearQueue: $("#clearQueue"),
  bgPhotoA: $("#bgPhotoA"),
  bgPhotoB: $("#bgPhotoB"),
  bgBtn: $("#bgBtn"),
  toasts: $("#toasts"),
  audio: $("#audio")
};
const state = {
  quality: "lossless",
  source: "all",
  lastResults: [],
  lastAlbums: [],
  lastPlaylists: [],
  activeTab: "song",
  engineBySource: {},
  lxEngines: [],
  lat: {},
  latBusy: null,
  latEngineName: {},
  theme: "t2",
  immTone: "auto",
  queue: [],
  idx: -1,
  current: null,
  loop: "all",
  audioStreamUrl: "",
  everPlayed: false,
  lrcLines: [],
  lrcToken: 0,
  seekDragging: false,
  histDone: false
};
const store = {
  load() {
    try {
      const s = JSON.parse(localStorage.getItem("fg.settings") || "{}");
      if (s.engineBySource) state.engineBySource = s.engineBySource;
      if (s.theme) state.theme = s.theme;
      if (s.immTone) state.immTone = s.immTone;
      if (s.quality) state.quality = s.quality;
      if (s.source) state.source = s.source;
      if (typeof s.vol === "number") el.audio.volume = s.vol;
      if (s.loop) state.loop = s.loop;
      const q = JSON.parse(localStorage.getItem("fg.queue") || "null");
      if (q && Array.isArray(q.queue)) {
        state.queue = q.queue;
        state.idx = q.idx ?? -1;
      }
    } catch (_) {
    }
  },
  save() {
    localStorage.setItem("fg.settings", JSON.stringify({ quality: state.quality, source: state.source, vol: el.audio.volume, loop: state.loop, engineBySource: state.engineBySource, theme: state.theme, immTone: state.immTone }));
    localStorage.setItem("fg.queue", JSON.stringify({ queue: state.queue, idx: state.idx }));
  }
};
const fmtTime = (s) => {
  if (!isFinite(s)) return "0:00";
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const hist = {
  list: [],
  key: (t) => `${t.source}:${t.id}`,
  load() {
    try {
      const l = JSON.parse(localStorage.getItem("fg.history") || "[]");
      if (Array.isArray(l)) hist.list = l.filter((t) => t && t.id && t.source);
    } catch (_) {
      hist.list = [];
    }
  },
  save() {
    try {
      localStorage.setItem("fg.history", JSON.stringify(hist.list.slice(0, 300)));
    } catch (_) {
    }
  },
  add(track) {
    if (!track || !track.id || !track.source) return;
    const k = hist.key(track);
    hist.list = hist.list.filter((t) => hist.key(t) !== k);
    const rec = Object.assign({}, track);
    rec._ts = Date.now();
    hist.list.unshift(rec);
    hist.save();
    if (!el.viewHistory.hidden) renderHistory();
  }
};
let histArm = 0;
function armHistory() {
  disarmHistory();
  const t = state.current;
  histArm = setTimeout(() => {
    histArm = 0;
    if (state.current === t && !el.audio.paused) {
      state.histDone = true;
      hist.add(t);
    }
  }, 5000);
}
function disarmHistory() {
  if (histArm) {
    clearTimeout(histArm);
    histArm = 0;
  }
}
let toastTimer = 0;
function toast(msg, isErr = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  el.toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 350);
  }, 3200);
}
const BLANK_COVER = "data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect width=%2240%22 height=%2240%22 fill=%22%23eceae6%22/><path d=%22M17 28V13l11-2v13%22 fill=%22none%22 stroke=%22%239aa09a%22 stroke-width=%222%22/><circle cx=%2215%22 cy=%2228%22 r=%223%22 fill=%22%239aa09a%22/><circle cx=%2226%22 cy=%2226%22 r=%223%22 fill=%22%239aa09a%22/></svg>";
const picViaProxy = (u) => u && !/^data:/i.test(u) ? `/api/pic?u=${encodeURIComponent(u)}` : "";
const picProxy = (u) => {
  if (!u) return BLANK_COVER;
  if (/kugou\.com/i.test(u)) return picViaProxy(u) || BLANK_COVER;
  if (/^https:/i.test(u)) return u;
  if (/^http:/i.test(u)) return u.replace(/^http:/i, "https:");
  return picViaProxy(u) || BLANK_COVER;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const parseDurSec = (s) => {
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(String(s))) {
    const n = +s;
    return n > 1e4 ? Math.round(n / 1e3) : n;
  }
  const p = String(s).split(":").map(Number);
  return p.every((x) => !Number.isNaN(x)) ? p.reduce((a, b) => a * 60 + b, 0) : 0;
};
const withDur = (url, track) => {
  if (!url || !url.includes("/api/stream")) return url;
  try {
    const d = parseDurSec(track && (track.duration || track.interval));
    return d ? url + "&dur=" + d : url;
  } catch (_) {
    return url;
  }
};
function dropAudioCache() {
  const src = state.audioStreamUrl || "";
  state.audioStreamUrl = "";
  if (!src.includes("/api/stream")) return;
  try {
    const u = new URL(src).searchParams.get("u");
    if (u) fetch(`/api/cache/drop?u=${encodeURIComponent(u)}`, { method: "POST", keepalive: true }).catch(() => {
    });
  } catch (_) {
  }
}
async function api(path, opts = {}) {
  const r = await fetch(path, { signal: AbortSignal.timeout(opts.timeout || 7e4) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function setTheme(t, silent) {
  state.theme = t;
  document.body.dataset.theme = t;
  if (t === "t4") {
    document.body.classList.add("hasbg");
  } else {
    document.body.classList.remove("hasbg");
  }
  renderThemeList();
  syncThemeColor();
  state.immTone = "auto";
  applyTone();
  store.save();
}
(function sparkles() {
  const cv = document.getElementById("sparks");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let dots = [], raf = 0, running = false;
  const rect = () => cv.getBoundingClientRect();
  const dot = (r) => ({
    x: Math.random() * r.width,
    y: Math.random() * r.height,
    r: 0.7 + Math.random() * 2,
    base: 0.16 + Math.random() * 0.3,
    ph: Math.random() * Math.PI * 2,
    tw: 0.5 + Math.random() * 1.3,
    vx: (Math.random() - 0.5) * 0.14,
    vy: (Math.random() - 0.5) * 0.14,
    next: performance.now() + 2200 + Math.random() * 5200,
    j: 0,
    tx: 0,
    ty: 0
  });
  function reseed() {
    const r = rect();
    const n = Math.max(12, Math.min(22, Math.round(r.width * r.height / 2e4)));
    dots = Array.from({ length: n }, () => dot(r));
  }
  function resize() {
    const r = rect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    reseed();
  }
  function frame(t) {
    const r = rect();
    ctx.clearRect(0, 0, r.width, r.height);
    for (const d of dots) {
      if (d.j <= 0) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > r.width) d.vx *= -1;
        if (d.y < 0 || d.y > r.height) d.vy *= -1;
        if (t >= d.next) {
          d.j = 1e-3;
          d.tx = Math.random() * r.width;
          d.ty = Math.random() * r.height;
        }
      } else {
        d.j += 0.018;
        if (d.j >= 1) {
          d.j = 0;
          d.x = d.tx;
          d.y = d.ty;
          d.next = t + 2200 + Math.random() * 5200;
          d.vx = (Math.random() - 0.5) * 0.14;
          d.vy = (Math.random() - 0.5) * 0.14;
        } else {
          d.x += (d.tx - d.x) * 0.07;
          d.y += (d.ty - d.y) * 0.07;
        }
      }
      let a = d.base * (0.55 + 0.45 * Math.sin(t * 1e-3 * d.tw + d.ph));
      if (d.j > 0) a *= 1 - Math.abs(d.j - 0.5) * 1.4;
      if (a <= 0.012) continue;
      const rad = d.r * 3.4;
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rad);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.35, `rgba(255,255,255,${a * 0.4})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(d.x, d.y, rad, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 1.5)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 0.55, 0, 6.2832);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  const start = () => {
    if (running || reduce) return;
    running = true;
    resize();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
    const r = rect();
    ctx.clearRect(0, 0, r.width, r.height);
  };
  addEventListener("resize", () => {
    if (running) resize();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (document.body.dataset.theme === "t4") start();
  });
  new MutationObserver(() => {
    document.body.dataset.theme === "t4" ? start() : stop();
  }).observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.body.dataset.theme === "t4") start();
})();
const THEME_COLOR = { t1: "#ffffff", t2: "#f2f2ee", t3: "#0b0c0e", t4: "#16171b" };
function syncThemeColor() {
  const m = document.querySelector("#themeColor") || document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", THEME_COLOR[state.theme] || "#f2f2ee");
}
function applyTone() {
  const auto = state.theme === "t3" || state.theme === "t4" ? "dark" : "light";
  const tone = state.immTone === "light" || state.immTone === "dark" ? state.immTone : auto;
  el.immersive.dataset.tone = tone;
  if (el.immTone) {
    el.immTone.classList.toggle("tone-light", tone === "light");
    el.immTone.title = `\u6C89\u6D78\u9875\u8272\u8C03\uFF1A${tone === "light" ? "\u6D45\u8272" : "\u6DF1\u8272"}\uFF08\u70B9\u51FB\u5207\u6362\uFF09`;
  }
}
function setView(name) {
  document.body.dataset.view = name;
  el.viewSearch.hidden = name !== "search";
  el.viewQueue.hidden = name !== "queue";
  el.viewHistory.hidden = name !== "history";
  if (name === "queue") renderQueue();
  if (name === "history") renderHistory();
}
let immFullscreenAsked = false;
async function enterNativeFullscreen() {
  if (document.fullscreenElement) return;
  immFullscreenAsked = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch (_) {
  }
}
function exitNativeFullscreen() {
  if (!immFullscreenAsked) return;
  immFullscreenAsked = false;
  if (document.fullscreenElement) {
    try {
      document.exitFullscreen();
    } catch (_) {
    }
  }
}
function setImmersive(open) {
  state.immersive = open;
  el.immersive.hidden = !open;
  el.expandBtn.classList.toggle("expanded", open);
  document.body.style.overflow = open ? "hidden" : "";
  document.body.classList.toggle("imm-on", open);
  if (open) {
    updateLrcActive(true);
    pushLayer("imm");
    enterNativeFullscreen();
  } else {
    popLayer("imm");
    exitNativeFullscreen();
  }
}
function toggleImmersive() {
  setImmersive(!state.immersive);
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.immersive && immFullscreenAsked) setImmersive(false);
});
let searchSeq = 0;
async function doSearch() {
  const kw = el.searchInput.value.trim();
  if (!kw) {
    el.searchInput.focus();
    return;
  }
  const seq = ++searchSeq;
  setView("search");
  state.kw = kw;
  state.activeTab = "song";
  el.backBtn.hidden = true;
  el.resultTitle.textContent = `\u201C${kw}\u201D`;
  el.results.innerHTML = `<div class="loading">${'<div class="sk"></div>'.repeat(6)}</div>`;
  el.resultMeta.textContent = "\u641C\u7D22\u4E2D\u2026";
  el.searchTabs.hidden = true;
  const q = encodeURIComponent(kw);
  state.lastResults = [];
  state.lastAlbums = [];
  state.lastPlaylists = [];
  state.tabCache = { kw, album: null, playlist: null };
  const paint = () => {
    if (seq !== searchSeq) return;
    el.searchTabs.hidden = false;
    updateTabCounts();
    if (state.activeTab === "song") renderSongList(state.lastResults);
    refreshEngineBar();
  };
  const mergeAppend = (rows) => {
    const seen = new Set(state.lastResults.map((t) => t.source + ":" + t.id));
    const add = rows.filter((t) => !seen.has(t.source + ":" + t.id));
    if (!add.length) return;
    state.lastResults = state.lastResults.concat(add);
    const bySrc = {};
    state.lastResults.forEach((t) => (bySrc[t.source] = bySrc[t.source] || []).push(t));
    const out = [];
    let more = true;
    let i = 0;
    while (more) {
      more = false;
      for (const s of Object.keys(bySrc)) {
        if (bySrc[s][i]) {
          out.push(bySrc[s][i]);
          more = true;
        }
      }
      i++;
    }
    state.lastResults = out;
  };
  const ALL_SRC = ["netease", "kugou", "tencent", "kuwo", "migu"];
  const songSources = state.source === "all" ? ALL_SRC.slice(0, 2) : [state.source];
  const laterSources = state.source === "all" ? ALL_SRC.slice(2) : [];
  const enrichSong = async (s, rows) => {
    const byId = new Map(rows.map((t) => [t.source + ":" + t.id, t]));
    state.lastResults = state.lastResults.map((t) => {
      const f = byId.get(t.source + ":" + t.id);
      return f ? Object.assign({}, t, { pic: f.pic || t.pic, duration: f.duration || t.duration, album: f.album || t.album }) : t;
    });
    paint();
  };
  const fetchSong = async (s) => {
    try {
      const r = await api(`/api/search?kw=${q}&source=${s}&type=song`);
      if (seq !== searchSeq) return;
      mergeAppend(r.tracks || []);
      paint();
      hydrateCovers();
    } catch (_) {
    }
  };
  await Promise.allSettled(songSources.map(fetchSong));
  if (seq === searchSeq) {
    updateTabCounts();
    renderTab();
  }
  laterSources.forEach((s) => setTimeout(() => fetchSong(s), 150));
  state.tabCache = { kw, album: null, playlist: null };
  updateTabCounts();
}
function updateTabCounts() {
  el.cntSong.textContent = state.lastResults.length;
  const loadedA = state.tabCache && state.tabCache.kw === state.kw && !!state.tabCache.album;
  const loadedP = state.tabCache && state.tabCache.kw === state.kw && !!state.tabCache.playlist;
  el.cntAlbum.textContent = (state.lastAlbums || []).length || (loadedA ? "0" : "\u2013");
  el.cntPlaylist.textContent = (state.lastPlaylists || []).length || (loadedP ? "0" : "\u2013");
  const empty = !state.lastResults.length;
  const parts = [`${state.lastResults.length} \u5355\u66F2`];
  if (el.cntAlbum.textContent !== "\u2013") parts.push(`${state.lastAlbums.length} \u4E13\u8F91`);
  if (el.cntPlaylist.textContent !== "\u2013") parts.push(`${state.lastPlaylists.length} \u6B4C\u5355`);
  const latNote = state.source !== "all" && $("#probeState") ? ` \xB7 ${$("#probeState").textContent}` : "";
  el.resultMeta.textContent = empty ? "\u65E0\u7ED3\u679C\uFF0C\u6362\u4E2A\u8BCD\u8BD5\u8BD5" : parts.join(" \xB7 ") + latNote;
}
function renderTab() {
  $$(".stab", el.searchTabs).forEach((b) => b.classList.toggle("active", b.dataset.tab === state.activeTab));
  if (state.activeTab === "album") return renderAlbumGrid(state.lastAlbums);
  if (state.activeTab === "playlist") return renderPlaylistGrid(state.lastPlaylists);
  renderSongList(state.lastResults);
}
function renderSongList(tracks) {
  if (!tracks.length) {
    el.results.innerHTML = `<div class="empty">${state.source === "all" ? "\u6CA1\u6709\u7ED3\u679C" : state.source === "migu" ? "\u54AA\u5495\u4E0A\u6E38\u955C\u50CF\u6682\u4E0D\u53EF\u7528<br>\u53EF\u6362\u5176\u4ED6\u97F3\u6E90" : "\u8BE5\u5206\u7C7B\u4E0B\u6CA1\u6709\u7ED3\u679C<br>\u6362\u4E2A\u97F3\u6E90\u8BD5\u8BD5"}</div>`;
    return;
  }
  el.results.innerHTML = tracks.map((t, i) => `<div class="row" style="animation-delay:${Math.min(i * 20, 300)}ms">${rowHTML(t, i)}</div>`).join("");
  bindRows(el.results, tracks, (t, i) => playFrom(state.lastResults, i));
  markPlayingRow();
}
function cardHTML(item, i, type) {
  const tag = `<span class="tag src-${item.source} card-tag">${SRC_LABEL[item.source] || item.source}</span>`;
  const sub = type === "album" ? `${esc(item.artist || "")}${item.publish ? " \xB7 " + esc(item.publish) : ""}` : `${esc(item.artist || "")}${item.count ? " \xB7 " + item.count + " \u9996" : ""}`;
  return `
    <div class="card" data-card="${i}">
      <div class="card-cover">
        <img loading="lazy" data-orig="${esc(item.pic || "")}" src="${esc(picProxy(item.pic))}" onerror="window.__imgfail(this)">
        ${tag}
        <div class="card-play"><svg viewBox="0 0 24 24" class="ic"><path d="M9 5.5v13l10-6.5z" fill="currentColor"/></svg></div>
      </div>
      <div class="card-name">${esc(item.name)}</div>
      <div class="card-sub">${sub}</div>
    </div>`;
}
function renderAlbumGrid(albums) {
  if (!albums.length) {
    el.results.innerHTML = '<div class="empty">\u8BE5\u5206\u7C7B\u4E0B\u6CA1\u6709\u7ED3\u679C</div>';
    return;
  }
  el.results.innerHTML = `<div class="card-grid">${albums.map((a, i) => cardHTML(a, i, "album")).join("")}</div>`;
  el.results.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openAlbum(state.lastAlbums[+card.dataset.card]));
  });
}
function renderPlaylistGrid(playlists) {
  if (!playlists.length) {
    el.results.innerHTML = '<div class="empty">\u8BE5\u5206\u7C7B\u4E0B\u6CA1\u6709\u7ED3\u679C<br>\u4E5F\u53EF\u7C98\u8D34\u6B4C\u5355\u94FE\u63A5\u5BFC\u5165</div>';
    return;
  }
  el.results.innerHTML = `<div class="card-grid">${playlists.map((p, i) => cardHTML(p, i, "playlist")).join("")}</div>`;
  el.results.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openPlaylist(state.lastPlaylists[+card.dataset.card]));
  });
}
async function openAlbum(a) {
  if (!a) return;
  const seq = ++searchSeq;
  el.backBtn.hidden = false;
  pushLayer("detail");
  el.searchTabs.hidden = true;
  el.resultTitle.textContent = a.name || "\u4E13\u8F91";
  el.resultMeta.textContent = `${SRC_LABEL[a.source] || a.source} \xB7 ${a.artist || ""}`;
  el.results.innerHTML = `<div class="loading">${'<div class="sk"></div>'.repeat(5)}</div>`;
  try {
    const d = await api(`/api/album?source=${a.source}&id=${encodeURIComponent(a.id)}`);
    if (seq !== searchSeq) return;
    if (d.error || !d.tracks || !d.tracks.length) {
      el.results.innerHTML = `<div class="empty">${esc(d.error || "\u8FD9\u5F20\u4E13\u8F91\u6CA1\u6709\u66F2\u76EE")}</div>`;
      return;
    }
    renderCollection(d, a);
  } catch (e) {
    if (seq === searchSeq) el.results.innerHTML = `<div class="empty">\u4E13\u8F91\u52A0\u8F7D\u5931\u8D25\uFF1A${esc(e.message)}</div>`;
  }
}
async function openPlaylist(p) {
  if (!p) return;
  const seq = ++searchSeq;
  el.backBtn.hidden = false;
  pushLayer("detail");
  el.searchTabs.hidden = true;
  el.resultTitle.textContent = p.name || "\u6B4C\u5355";
  el.resultMeta.textContent = `${SRC_LABEL[p.source] || p.source} \xB7 ${p.artist || ""}`;
  el.results.innerHTML = `<div class="loading">${'<div class="sk"></div>'.repeat(5)}</div>`;
  try {
    const d = await api(`/api/playlist-detail?source=${p.source}&id=${encodeURIComponent(p.id)}`);
    if (seq !== searchSeq) return;
    if (d.error || !d.tracks || !d.tracks.length) {
      el.results.innerHTML = `<div class="empty">${esc(d.error || "\u6B4C\u5355\u6682\u65E0\u66F2\u76EE")}</div>`;
      return;
    }
    renderCollection(d, p);
  } catch (e) {
    if (seq === searchSeq) el.results.innerHTML = `<div class="empty">\u6B4C\u5355\u52A0\u8F7D\u5931\u8D25\uFF1A${esc(e.message)}</div>`;
  }
}
function renderCollection(d, meta) {
  const tracks = d.tracks;
  const label = meta.count && !d.name ? "\u6B4C\u5355" : "\u4E13\u8F91";
  el.resultMeta.textContent = `${SRC_LABEL[meta.source] || meta.source} \xB7 ${d.artist || meta.artist || ""}${d.publish ? " \xB7 " + d.publish : ""} \xB7 ${tracks.length} \u9996`;
  el.results.innerHTML = `<div class="album-hero">
      <img src="${esc(picProxy(d.pic || d.cover || meta.pic))}" onerror="window.__imgfail(this)">
      <div><div class="ah-name">${esc(d.name || meta.name)}</div>
      <div class="ah-sub">${label} \xB7 ${esc(d.artist || meta.artist || "")}${d.publish ? " \xB7 " + esc(d.publish) : ""} \xB7 ${tracks.length} \u9996</div></div>
    </div>` + tracks.map((t, i) => `<div class="row" style="animation-delay:${Math.min(i * 16, 260)}ms">${rowHTML(t, i)}</div>`).join("");
  bindRows(el.results, tracks, (t, i) => playFrom(tracks, i));
}
el.searchTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".stab");
  if (!tab) return;
  state.activeTab = tab.dataset.tab;
  renderSourceList();
  if (tab.dataset.tab !== "song") loadTabData(tab.dataset.tab);
  renderTab();
});
function loadTabData(type) {
  if (!state.kw) return;
  if (state.tabCache && state.tabCache.kw === state.kw && state.tabCache[type]) {
    updateTabCounts();
    return;
  }
  const ok = CAP[type] || CAP.song;
  let src = state.source;
  if (src !== "all" && !ok.includes(src)) {
    src = "all";
    el.resultMeta.textContent = `${SRC_LABEL[state.source] || state.source}\u6682\u65E0${type === "album" ? "\u4E13\u8F91" : "\u6B4C\u5355"}\uFF0C\u5DF2\u6309\u5168\u90E8\u97F3\u6E90\u663E\u793A`;
  }
  window.__tabSrc = src;
  const badge = type === "album" ? $("#cntAlbum") : $("#cntPlaylist");
  if (badge) badge.textContent = "\u2026";
  if (state.activeTab === type) el.results.innerHTML = '<div class="loading"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>';
  const q = encodeURIComponent(state.kw);
  api(`/api/search?kw=${q}&source=${window.__tabSrc || state.source}&type=${type}`).then((r) => {
    if (state.kw !== (state.tabCache && state.tabCache.kw)) return;
    if (type === "album") state.lastAlbums = r.albums || [];
    else state.lastPlaylists = r.playlists || [];
    state.tabCache[type] = true;
    updateTabCounts();
    if (state.activeTab === type) renderTab();
  }).catch(() => {
    if (badge) badge.textContent = "0";
    if (state.activeTab === type) renderTab();
  });
}
function backToResults() {
  el.backBtn.hidden = true;
  el.searchTabs.hidden = false;
  el.resultTitle.textContent = state.kw ? `\u201C${state.kw}\u201D` : "\u641C\u7D22";
  updateTabCounts();
  renderTab();
}
el.backBtn.addEventListener("click", () => {
  backToResults();
  popLayer("detail");
});
function rowHTML(t, i, showRemove) {
  const qTag = t.extra && t.extra.sq ? '<span class="tag q">Flac+</span>' : "";
  const vip = t.extra && t.extra.pay ? '<span class="tag vip">VIP</span>' : "";
  return `
    <img class="row-cover" loading="lazy" data-orig="${esc(t.pic || "")}" src="${esc(picProxy(t.pic))}" onerror="window.__imgfail(this)">
    <div class="row-main">
      <div class="row-name"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>${esc(t.name)}${t.extra && t.extra.live ? ' <span class="tag live">Live</span>' : ""}</div>
      <div class="row-artist">${esc(t.artist)}${t.album ? " \xB7 " + esc(t.album) : ""}</div>
    </div>
    <div class="row-album">${esc(t.album || "")}</div>
    <div class="row-right">
    <div class="row-badges"><span class="tag src-${t.source}">${SRC_LABEL[t.source] || t.source}</span>${qTag}${vip}</div>
    <button class="row-play" data-i="${i}" title="\u64AD\u653E">
      <svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
    </button>
    ${showRemove ? '<button class="icon-btn row-del" data-i="' + i + '" title="\u79FB\u51FA\u961F\u5217"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' : ""}
    </div>
  `;
}
function bindRows(container, list, onPlay) {
  container.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".row-del")) return;
      const i = +row.querySelector("[data-i]").dataset.i;
      onPlay(list[i], i);
    });
  });
  container.querySelectorAll(".row-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = +btn.dataset.i;
      state.queue.splice(i, 1);
      if (state.idx > i) state.idx--;
      else if (state.idx === i) state.idx = Math.min(state.idx, state.queue.length - 1);
      store.save();
      renderQueue();
      updateQueueCount();
    });
  });
}
function renderWelcome() {
  el.searchTabs.hidden = true;
  el.resultTitle.textContent = "\u6D6E\u5149\u97F3\u4E50";
  el.resultMeta.textContent = "\u7F51\u6613\u4E91 \xB7 QQ \xB7 \u9177\u72D7 \xB7 \u9177\u6211 \xB7 \u54AA\u5495";
  el.results.innerHTML = `
    <div class="guide">
      <p class="guide-text">\u641C\u4E00\u9996\u6B4C\uFF0C\u4E94\u4E2A\u5E73\u53F0\u4E00\u8D77\u627E\u3002</p>
      <div class="guide-kbd"><kbd>\u7A7A\u683C</kbd>\u64AD\u653E \xB7 <kbd>Esc</kbd>\u6536\u8D77 \xB7 \u70B9 <kbd>FLAC</kbd> \u6362\u97F3\u8D28</div>
    </div>`;
}
const LAYERS = {
  imm: () => {
    if (state.immersive) setImmersive(false);
  },
  modal: () => {
    if (!el.playlistModal.hidden) el.playlistModal.hidden = true;
  },
  detail: () => {
    if (!el.backBtn.hidden) backToResults();
  },
  queue: () => {
    if (document.body.dataset.view === "queue") setView("search");
  }
};
const layerStack = [];
function pushLayer(k) {
  if (layerStack[layerStack.length - 1] === k) return;
  layerStack.push(k);
  try {
    history.pushState({ layer: k }, "");
  } catch (_) {
  }
}
function popLayer(k) {
  const i = layerStack.lastIndexOf(k);
  if (i < 0) return;
  layerStack.splice(i, 1);
  if (history.state && history.state.layer === k) {
    try {
      history.back();
    } catch (_) {
    }
  }
}
addEventListener("popstate", (e) => {
  const want = e.state && e.state.layer || null;
  while (layerStack.length && layerStack[layerStack.length - 1] !== want) LAYERS[layerStack.pop()]();
});
let loadSeq = 0;
function stopAudio() {
  state.suppressErr = true;
  try {
    el.audio.pause();
    el.audio.removeAttribute("src");
    el.audio.load();
  } catch (_) {
  }
  setTimeout(() => {
    state.suppressErr = false;
  }, 0);
  el.audio.dataset.seq = "";
  setPlayingUI(false);
}
function setPlayingUI(playing) {
  if (playing) el.qualityBtn.classList.remove("busy");
  el.playBtn.classList.toggle("playing", playing);
  el.immPlay.classList.toggle("playing", playing);
  document.body.classList.toggle("paused", !playing);
  el.immersive.classList.toggle("playing", playing);
}
function setCoverImg(img, url, has) {
  if (has && url) {
    img.classList.remove("noimg");
    img.src = url;
  } else {
    img.removeAttribute("src");
    img.classList.add("noimg");
  }
}
function updateQueueCount() {
  el.queueCount.textContent = state.queue.length;
}
function updateTrackUI(track) {
  const cover = picProxy(track.pic);
  el.pName.textContent = track.name;
  el.pArtist.textContent = track.artist;
  el.immName.textContent = track.name;
  el.immArtist.textContent = track.artist || "\u672A\u77E5\u6B4C\u624B";
  setCoverImg(el.pCover, cover, !!track.pic);
  setCoverImg(el.immCover, cover, !!track.pic);
  el.immTags.innerHTML = `<span class="tag src-${track.source}">${SRC_LABEL[track.source] || track.source}</span>` + (track._switched ? '<span class="tag q">\u5DF2\u6362\u6E90</span>' : "");
  el.immBgImg.src = cover;
  setImmBg(cover, !!track.pic);
}
function markPlayingRow() {
  const key = state.current && `${state.current.source}:${state.current.id}`;
  $$(".row", el.results).forEach((r, i) => {
    const t = state.lastResults[i];
    r.classList.toggle("playing", !!t && key === `${t.source}:${t.id}`);
  });
}
async function playFrom(list, i) {
  if (!list || !list[i]) return;
  state.queue = list.slice();
  await playAt(i);
}
async function playAt(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.idx = i;
  await playTrack(state.queue[i]);
  store.save();
}
async function guardPlay() {
  try {
    await el.audio.play();
    setPlayingUI(true);
    return true;
  } catch (e) {
    setPlayingUI(false);
    if (e && (e.name === "NotAllowedError" || /gesture|not allowed|permission/i.test(String(e.message || ""))))
      toast("\u9700\u518D\u70B9\u4E00\u6B21\u64AD\u653E\uFF08\u6D4F\u89C8\u5668\u9650\u5236\uFF09", true);
    return false;
  }
}
async function playTrack(track, tierOverride) {
  if (!track) return;
  const seq = ++loadSeq;
  state.manualTier = !!tierOverride && track === state.current;
  if (track.audioSeq === void 0) track.audioSeq = 0;
  if (!tierOverride || state.current !== track) stopAudio();
  state.current = track;
  disarmHistory();
  state.histDone = false;
  state.lrcLines = [];
  state.lrcToken++;
  state.retryCount = tierOverride ? state.retryCount || 0 : 0;
  updateTrackUI(track);
  setPlayingUI(false);
  el.qualityBtn.textContent = "\u2026";
  el.qualityBtn.classList.add("busy");
  if (el.miniLyric && !state.lrcLines.length) el.miniLyric.textContent = "\u89E3\u6790\u4E2D\u2026";
  markPlayingRow();
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: track.artist,
        album: track.album,
        artwork: track.pic ? [{ src: picProxy(track.pic), sizes: "300x300" }] : []
      });
    } catch (_) {
    }
  }
  loadLyric(track);
  let extra = {};
  try {
    extra = track.extra || JSON.parse(track.extra || "{}");
  } catch (_) {
  }
  extra = Object.assign({}, extra, { name: track.name || "", singer: track.artist || "" });
  const quality = tierOverride || state.quality;
  let r;
  try {
    const eng = state.engineBySource[track.source] || "";
    r = await api(`/api/url?source=${track.source}&id=${encodeURIComponent(track.id)}&quality=${quality}&engine=${encodeURIComponent(eng)}&extra=${encodeURIComponent(JSON.stringify(extra))}`);
    const manualTier2 = !!tierOverride;
  } catch (e) {
    r = { ok: false, reason: e.message };
  }
  if (seq !== loadSeq) return;
  if (!r.ok || !r.url) {
    if (seq !== loadSeq) return;
    if (manualTier || state.manualTier) {
      el.miniLyric.textContent = "\u65E0\u6CD5\u64AD\u653E";
      toast("\u8BE5\u97F3\u8D28\u65E0\u53EF\u7528\u94FE\u63A5\uFF0C\u5DF2\u4FDD\u6301\u539F\u66F2\u4E0D\u52A8", true);
      setPlayingUI(false);
      return;
    }
    try {
      console.warn("[\u53D6\u94FE\u5931\u8D25]", track.source, track.name, r.reason, r.attempts || []);
    } catch (_) {
    }
    toast(`${SRC_LABEL[track.source] || track.source}\u89E3\u6790\u5931\u8D25\uFF1A${String(r.reason || "\u65E0\u53EF\u7528\u94FE\u63A5").slice(0, 60)}`, true);
    await switchSource(track);
    return;
  }
  if (seq !== loadSeq) return;
  el.audio.dataset.seq = String(seq);
  el.audio.src = withDur(r.url, track);
  state.audioStreamUrl = el.audio.src;
  state.everPlayed = false;
  state.currentTier = r.tier || "lossless";
  state.currentQuality = r.quality;
  el.qualityBtn.textContent = r.quality;
  el.qualityBtn.title = `\u5B9E\u9645 ${r.br}kbps${r.size ? ` \xB7 ${(r.size / 1048576).toFixed(1)}MB` : ""}`;
  el.qualityNow.textContent = `\u5F53\u524D\u5B9E\u9645\u97F3\u8D28\uFF1A${r.quality}\uFF08${r.br}kbps\uFF09${r.downgraded ? " \xB7 \u5DF2\u964D\u6863" : ""}`;
  if (r.downgraded && !tierOverride) toast(`\u6240\u9009\u97F3\u8D28\u6CA1\u6709\uFF0C\u5DF2\u7528 ${r.quality} \u63A5\u7740\u653E`);
  if (el.miniLyric) el.miniLyric.textContent = "\u6B63\u5728\u7F13\u51B2\u6B4C\u66F2";
  await guardPlay();
}
const TIER_ORDER_UI = ["master", "atmos_plus", "atmos", "hires", "lossless", "high", "standard"];
async function rescuePlayback() {
  const t = state.current;
  if (!t) return;
  if (state.retryCount >= 3) {
    state.retryCount = 0;
    toast("\u8FD9\u9996\u53CD\u590D\u653E\u4E0D\u51FA\uFF0C\u6362\u6761\u7EBF\u8DEF\u8BD5\u8BD5", true);
    await switchSource(t);
    return;
  }
  state.retryCount++;
  const idx = TIER_ORDER_UI.indexOf(state.currentTier || "lossless");
  const next2 = TIER_ORDER_UI[Math.min(idx + 1, TIER_ORDER_UI.length - 1)];
  toast(`\u64AD\u653E\u5931\u8D25\uFF0C\u5148\u7528 ${Q_NAMES[next2]} \u91CD\u8BD5`, true);
  await playTrack(t, next2);
}
async function switchSource(t) {
  let alt = { ok: false };
  try {
    alt = await api(`/api/alt?name=${encodeURIComponent(t.name || "")}&singer=${encodeURIComponent(t.artist || "")}&exclude=${t.source}`);
  } catch (_) {
  }
  if (!alt.ok || !alt.url) {
    toast("\u5404\u8DEF\u97F3\u6E90\u90FD\u653E\u4E0D\u4E86\u8FD9\u9996", true);
    setPlayingUI(false);
    return;
  }
  const newTrack = Object.assign({}, alt.track, {
    pic: alt.track.pic || t.pic,
    album: alt.track.album || t.album,
    _switched: true
  });
  state.current = newTrack;
  state.currentTier = "lossless";
  if (state.idx >= 0 && state.queue[state.idx]) state.queue[state.idx] = newTrack;
  store.save();
  updateTrackUI(newTrack);
  markPlayingRow();
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: newTrack.name, artist: newTrack.artist, artwork: newTrack.pic ? [{ src: newTrack.pic, sizes: "300x300" }] : [] });
    } catch (_) {
    }
  }
  loadLyric(newTrack);
  el.audio.dataset.seq = String(loadSeq);
  el.audio.src = withDur(alt.url, newTrack);
  state.audioStreamUrl = el.audio.src;
  state.everPlayed = false;
  if (el.miniLyric) el.miniLyric.textContent = "\u6B63\u5728\u7F13\u51B2\u6B4C\u66F2";
  state.currentQuality = alt.quality;
  el.qualityBtn.textContent = alt.quality;
  el.qualityNow.textContent = `\u5F53\u524D\u5B9E\u9645\u97F3\u8D28\uFF1A${alt.quality}\uFF08\u5DF2\u6362\u81F3${SRC_LABEL[newTrack.source]}\uFF09`;
  await guardPlay();
  state.retryCount = 0;
  toast(`\u6362\u5230${SRC_LABEL[newTrack.source]} \xB7 ${alt.quality}`);
}
function setImmBg(src, hasCover) {
  if (hasCover === false) {
    el.immersive.style.removeProperty("--imm-c1");
    el.immersive.style.removeProperty("--imm-c2");
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      el.immersive.style.setProperty("--imm-c1", `rgba(${r},${g},${b},.58)`);
      el.immersive.style.setProperty("--imm-c2", `rgba(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.65)},.62)`);
    } catch (_) {
    }
  };
  img.onerror = () => {
    el.immersive.style.removeProperty("--imm-c1");
    el.immersive.style.removeProperty("--imm-c2");
  };
  img.src = src;
}
function nextIdx(dir) {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.loop === "shuffle") {
    if (n === 1) return state.idx;
    let r;
    do {
      r = Math.floor(Math.random() * n);
    } while (r === state.idx);
    return r;
  }
  return (state.idx + dir + n) % n;
}
function next() {
  if (state.loop === "one") {
    el.audio.currentTime = 0;
    el.audio.play().catch(() => {
    });
    return;
  }
  const i = nextIdx(1);
  if (i >= 0) playAt(i);
}
function prev() {
  if (el.audio.currentTime > 4) {
    el.audio.currentTime = 0;
    return;
  }
  const i = nextIdx(-1);
  if (i >= 0) playAt(i);
}
function seekUI() {
  const d = el.audio.duration || 0, c = el.audio.currentTime || 0;
  const pct = d ? c / d * 100 : 0;
  el.progressFill.style.width = pct + "%";
  el.progressThumb.style.left = pct + "%";
  el.tCur.textContent = fmtTime(c);
  el.tDur.textContent = fmtTime(d);
}
function seekFromEvent(e) {
  const rect = el.progressLine.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  el.progressFill.style.width = pct * 100 + "%";
  el.progressThumb.style.left = pct * 100 + "%";
  if (el.audio.duration) el.audio.currentTime = pct * el.audio.duration;
}
el.progressLine.addEventListener("pointerdown", (e) => {
  state.seekDragging = true;
  el.progressLine.classList.add("dragging");
  el.progressLine.setPointerCapture(e.pointerId);
  seekFromEvent(e);
});
el.progressLine.addEventListener("pointermove", (e) => {
  if (state.seekDragging) seekFromEvent(e);
});
el.progressLine.addEventListener("pointerup", (e) => {
  state.seekDragging = false;
  el.progressLine.classList.remove("dragging");
  seekFromEvent(e);
});
el.audio.addEventListener("timeupdate", () => {
  if (!state.seekDragging) seekUI();
  updateLrcActive();
});
el.audio.addEventListener("loadedmetadata", seekUI);
el.audio.addEventListener("durationchange", seekUI);
el.audio.addEventListener("ended", () => {
  next();
});
el.audio.addEventListener("playing", () => {
  state.everPlayed = true;
  if (!state.histDone && !histArm) armHistory();
  if (el.miniLyric) el.miniLyric.textContent = "\u6B63\u5728\u64AD\u653E";
});
el.audio.addEventListener("waiting", () => {
  if (!el.miniLyric) return;
  if (!state.everPlayed) {
    el.miniLyric.textContent = "\u6B63\u5728\u7F13\u51B2\u6B4C\u66F2";
    return;
  }
  if (!el.audio.paused) el.miniLyric.textContent = "\u7F13\u51B2\u4E2D\u2026";
});
el.audio.addEventListener("error", () => {
  if (!state.current || !el.audio.src || state.rescuing || state.suppressErr) return;
  if (el.audio.dataset.seq && el.audio.dataset.seq !== String(loadSeq)) return;
  state.rescuing = true;
  rescuePlayback().finally(() => {
    state.rescuing = false;
  });
});
el.audio.addEventListener("play", () => setPlayingUI(true));
el.audio.addEventListener("pause", () => {
  disarmHistory();
  setPlayingUI(false);
});
function parseLrc(text) {
  const lines = [];
  let offset = 0;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const meta = raw.match(/^\s*\[(offset)\s*:\s*(-?\d+)\s*\]/i);
    if (meta) {
      offset = -parseInt(meta[2], 10) / 1e3;
      continue;
    }
    const times = [...raw.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)];
    if (!times.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of times) {
      const t = +m[1] * 60 + +m[2] + +(m[3] || "0").padEnd(3, "0").slice(0, 3) / 1e3;
      lines.push({ t: t + offset, text: content });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.filter((l, i) => l.text || i === 0);
}
async function loadLyric(track) {
  const token = ++state.lrcToken;
  el.immLyricInner.innerHTML = '<div class="empty">\u6B4C\u8BCD\u52A0\u8F7D\u4E2D\u2026</div>';
  try {
    const extra = Object.assign({}, track.extra || {}, { name: track.name, singer: track.artist });
    const { lrc } = await api(`/api/lyric?source=${track.source}&id=${encodeURIComponent(track.id)}&extra=${encodeURIComponent(JSON.stringify(extra))}`, { timeout: 3e4 });
    if (token !== state.lrcToken) return;
    renderLrc(lrc);
  } catch (_) {
    if (token === state.lrcToken) {
      el.immLyricInner.innerHTML = '<div class="empty">\u6682\u65E0\u6B4C\u8BCD</div>';
    }
  }
}
function renderLrc(lrc) {
  state.lrcLines = parseLrc(lrc);
  if (!state.lrcLines.length) {
    el.immLyricInner.innerHTML = '<div class="empty">\u6682\u65E0\u6B4C\u8BCD</div>';
    return;
  }
  if (state.lrcLines.every((l) => l.t === 0)) {
    el.immLyricInner.innerHTML = `<div class="lrc-plain">${esc(state.lrcLines.map((l) => l.text).join("\n"))}</div>`;
  } else {
    el.immLyricInner.innerHTML = state.lrcLines.map((l) => `<div class="lrc-line" data-t="${l.t}">${esc(l.text) || "\u266A"}</div>`).join("");
    el.immLyricInner.querySelectorAll(".lrc-line").forEach((node) => {
      node.addEventListener("click", () => {
        el.audio.currentTime = +node.dataset.t;
        el.audio.play().catch(() => {
        });
      });
    });
  }
  updateLrcActive(true);
}
let coverHydrating = false;
async function hydrateCovers() {
  if (coverHydrating) return;
  const need = state.lastResults.filter((t) => !t.pic && t.source === "netease").slice(0, 24);
  if (!need.length) return;
  coverHydrating = true;
  try {
    const map = await api(`/api/ne-cover?ids=${need.map((t) => t.id).join(",")}`);
    let touched = false;
    state.lastResults = state.lastResults.map((t) => {
      if (!t.pic && map[t.id]) {
        touched = true;
        return Object.assign({}, t, { pic: map[t.id] });
      }
      return t;
    });
    if (touched && state.activeTab === "song") renderSongList(state.lastResults);
  } catch (_) {
  }
  coverHydrating = false;
}
let lrcIdx = -1;
function updateLrcActive(force = false) {
  if (!state.lrcLines.length || !state.lrcLines.some((l) => l.t > 0)) return;
  const cur = el.audio.currentTime + 0.25;
  let lo = 0, hi = state.lrcLines.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (state.lrcLines[mid].t <= cur) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx === lrcIdx && !force) return;
  lrcIdx = idx;
  const nodes = el.immLyricInner.querySelectorAll(".lrc-line");
  nodes.forEach((n) => n.classList.remove("active"));
  if (idx < 0) return;
  const node = nodes[idx];
  if (node) {
    node.classList.add("active");
    el.immLyricInner.scrollTo({ top: node.offsetTop - el.immLyricInner.clientHeight / 2 + node.clientHeight / 2, behavior: "smooth" });
  }
}
function renderQueue() {
  if (!state.queue.length) {
    el.queueList.innerHTML = '<div class="empty">\u961F\u5217\u662F\u7A7A\u7684</div>';
    return;
  }
  el.queueList.innerHTML = state.queue.map((t, i) => `<div class="row ${i === state.idx ? "playing" : ""}">${rowHTML(t, i, true)}</div>`).join("");
  bindRows(el.queueList, state.queue, (t, i) => playAt(i));
}
function updateQueueCountUI() {
  updateQueueCount();
}
el.searchBtn.addEventListener("click", doSearch);
el.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});
const CAP = { song: ["netease", "tencent", "kugou", "kuwo", "migu"], album: ["netease", "tencent", "kugou", "kuwo"], playlist: ["netease", "tencent", "kugou"], detail: {}, import: ["netease", "tencent", "kugou"] };
function srcOptions() {
  const all = ["all", "netease", "tencent", "kugou", "kuwo", "migu"];
  const t = document.body.dataset.view === "queue" ? "song" : state.activeTab || "song";
  const ok = CAP[t] || CAP.song;
  return all.filter((s) => s === "all" || ok.includes(s));
}
function renderSourceList() {
  $("#srcMenu").innerHTML = `<div class="dd-label">\u97F3\u6E90</div>` + srcOptions().map(
    (s) => `<button class="dd-opt ${state.source === s ? "on" : ""}" data-source="${s}">${s === "all" ? "\u5168\u90E8\u97F3\u6E90" : SRC_LABEL[s]}</button>`
  ).join("");
  $("#srcLab").textContent = state.source === "all" ? "\u5168\u90E8" : SRC_LABEL[state.source];
}
$("#srcMenu").addEventListener("click", (e) => {
  const opt = e.target.closest("[data-source]");
  if (!opt) return;
  state.source = opt.dataset.source;
  store.save();
  renderSourceList();
  closeDDs();
  refreshEngineBar();
  probeLatency(state.source);
  if (el.searchInput.value.trim()) doSearch();
});
function setQuality(q) {
  state.quality = q;
  store.save();
}
el.playBtn.addEventListener("click", () => {
  if (!el.audio.src && state.queue.length) return playAt(Math.max(0, state.idx));
  el.audio.paused ? el.audio.play().catch(() => {
  }) : el.audio.pause();
});
el.nextBtn.addEventListener("click", next);
el.prevBtn.addEventListener("click", prev);
el.loopBtn.addEventListener("click", () => {
  const modes = ["all", "one", "shuffle"];
  state.loop = modes[(modes.indexOf(state.loop) + 1) % 3];
  el.loopBtn.classList.toggle("on", state.loop !== "all");
  el.loopBtn.title = { all: "\u5217\u8868\u5FAA\u73AF", one: "\u5355\u66F2\u5FAA\u73AF", shuffle: "\u968F\u673A\u64AD\u653E" }[state.loop];
  toast(el.loopBtn.title);
  store.save();
});
function syncVolFill() {
  const pct = Math.round(Number(el.volSlider.value) || 0);
  el.volSlider.style.setProperty("--vol-pct", pct + "%");
}
el.volSlider.addEventListener("input", () => {
  el.audio.volume = el.volSlider.value / 100;
  syncVolFill();
  store.save();
});
el.pTrack.addEventListener("click", () => setImmersive(true));
el.bgBtn.addEventListener("click", () => {
  el.bgBtn.style.opacity = ".6";
  changeBg().finally(() => el.bgBtn.style.opacity = "");
});
el.expandBtn.addEventListener("click", toggleImmersive);
el.lyricBtn.addEventListener("click", toggleHistory);
el.immClose.addEventListener("click", () => setImmersive(false));
el.immTone.addEventListener("click", () => {
  const cur = el.immersive.dataset.tone === "light" ? "light" : "dark";
  state.immTone = cur === "light" ? "dark" : "light";
  applyTone();
  store.save();
  toast(`\u6C89\u6D78\u9875\u8272\u8C03\uFF1A${state.immTone === "light" ? "\u6D45\u8272" : "\u6DF1\u8272"}`);
});
el.immPrev.addEventListener("click", prev);
el.immNext.addEventListener("click", next);
el.immPlay.addEventListener("click", () => {
  if (!el.audio.src && state.queue.length) return playAt(Math.max(0, state.idx));
  el.audio.paused ? el.audio.play().catch(() => {
  }) : el.audio.pause();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.immersive) setImmersive(false);
});
el.queueBtn.addEventListener("click", () => {
  if (document.body.dataset.view === "queue") {
    setView("search");
    popLayer("queue");
  } else {
    setView("queue");
    pushLayer("queue");
  }
});
el.clearQueue.addEventListener("click", () => {
  state.queue = [];
  state.idx = -1;
  state.current = null;
  el.audio.pause();
  el.audio.removeAttribute("src");
  dropAudioCache();
  el.pName.textContent = "\u6D6E\u5149\u97F3\u4E50";
  el.pArtist.textContent = "\u51C6\u5907\u5C31\u7EEA";
  setCoverImg(el.pCover, "", false);
  setCoverImg(el.immCover, "", false);
  el.immBgImg.removeAttribute("src");
  setImmBg("", false);
  el.immName.textContent = "\u672A\u5728\u64AD\u653E";
  el.immArtist.textContent = "\u70B9\u51FB\u5DE6\u4E0B\u89D2\u7BAD\u5934\u5C55\u5F00";
  el.qualityBtn.textContent = "--";
  store.save();
  renderQueue();
  updateQueueCount();
});
el.qualityBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  el.qualityPop.hidden = !el.qualityPop.hidden;
  if (!el.qualityPop.hidden) {
    const bh = Math.round(el.player ? el.player.getBoundingClientRect().height : 0) || 60;
    document.documentElement.style.setProperty("--bar-h", bh + "px");
  }
  if (!el.qualityPop.hidden && keepInView) keepInView(el.qualityPop);
  if (!el.qualityPop.hidden && state.current) {
    el.qualityNow.textContent = el.qualityNow.textContent || "\u5C1A\u672A\u64AD\u653E";
    $$(".ctx-opt", el.qualityPop).forEach((o) => o.classList.toggle("on", o.dataset.q === state.quality));
  }
});
el.qualityPop.addEventListener("click", async (e) => {
  const opt = e.target.closest(".ctx-opt");
  if (!opt) return;
  el.qualityPop.hidden = true;
  setQuality(opt.dataset.q);
  if (state.current) {
    const pos = el.audio.currentTime;
    await playTrack(state.current);
    el.audio.addEventListener("loadedmetadata", () => {
      el.audio.currentTime = pos;
    }, { once: true });
    toast(`\u5DF2\u6362\u6210 ${Q_NAMES[state.quality]}\uFF0C\u8FD9\u9996\u7ACB\u523B\u751F\u6548`);
  }
});
document.addEventListener("click", (e) => {
  if (!el.qualityPop.hidden && !e.target.closest("#qualityPop")) el.qualityPop.hidden = true;
});
function renderHistory() {
  if (!hist.list.length) {
    el.historyList.innerHTML = '<div class="empty">\u8FD8\u6CA1\u6709\u64AD\u653E\u8BB0\u5F55</div>';
    return;
  }
  el.historyList.innerHTML = hist.list.map((t, i) => `<div class="row ${state.current && hist.key(state.current) === hist.key(t) ? "playing" : ""}">${rowHTML(t, i, false)}</div>`).join("");
  bindRows(el.historyList, hist.list, (t) => playFromHistory(t));
}
async function playFromHistory(t) {
  const k = hist.key(t);
  const exist = state.queue.findIndex((q) => `${q.source}:${q.id}` === k);
  if (exist >= 0) {
    await playAt(exist);
    if (!el.viewHistory.hidden) renderHistory();
    return;
  }
  if (!state.queue.length || state.idx < 0) {
    state.queue = [t];
    state.idx = 0;
    updateQueueCount();
    renderQueue();
    await playAt(0);
    store.save();
    if (!el.viewHistory.hidden) renderHistory();
    return;
  }
  state.queue.splice(state.idx + 1, 0, t);
  updateQueueCount();
  renderQueue();
  store.save();
  await playAt(state.idx + 1);
  if (!el.viewHistory.hidden) renderHistory();
}
function toggleHistory() {
  if (document.body.dataset.view === "history") setView("search");
  else setView("history");
}
el.historyClear.addEventListener("click", () => {
  hist.list = [];
  hist.save();
  renderHistory();
  toast("\u5386\u53F2\u5DF2\u6E05\u7A7A");
});
let bgToggle = false, bgLoading = false;
async function changeBg() {
  if (bgLoading) return;
  bgLoading = true;
  try {
    const { url } = await api(`/api/bg?r=${Date.now()}`);
    if (!url) return;
    const next2 = bgToggle ? el.bgPhotoA : el.bgPhotoB;
    const cur = bgToggle ? el.bgPhotoB : el.bgPhotoA;
    await new Promise((ok, err) => {
      next2.onload = ok;
      next2.onerror = err;
      next2.src = url;
      setTimeout(err, 2e4);
    });
    next2.classList.add("show");
    cur.classList.remove("show");
    bgToggle = !bgToggle;
  } catch (_) {
  } finally {
    bgLoading = false;
  }
}
function syncImportTip() {
  const tip = document.querySelector(".modal-tip");
  if (tip) tip.textContent = (CAP.import || []).map((k) => SRC_LABEL[k] || k).join(" / ");
}
el.playlistBtn.addEventListener("click", () => {
  el.playlistModal.hidden = false;
  pushLayer("modal");
  el.playlistUrl.focus();
});
el.playlistCancel.addEventListener("click", () => {
  el.playlistModal.hidden = true;
  popLayer("modal");
});
el.playlistModal.addEventListener("click", (e) => {
  if (e.target === el.playlistModal) {
    el.playlistModal.hidden = true;
    popLayer("modal");
  }
});
el.playlistGo.addEventListener("click", importPlaylist);
el.playlistUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") importPlaylist();
});
async function importPlaylist() {
  const url = el.playlistUrl.value.trim();
  if (!url) return;
  el.playlistGo.disabled = true;
  el.playlistGo.textContent = "\u5BFC\u5165\u4E2D\u2026";
  try {
    const r = await api(`/api/playlist?url=${encodeURIComponent(url)}`);
    if (r.error) {
      toast(r.error, true);
      return;
    }
    if (!r.tracks || !r.tracks.length) {
      toast("\u6B4C\u5355\u4E3A\u7A7A\u6216\u89E3\u6790\u5931\u8D25", true);
      return;
    }
    state.queue = r.tracks;
    state.idx = -1;
    store.save();
    el.playlistModal.hidden = true;
    el.playlistUrl.value = "";
    updateQueueCount();
    toast(`\u5DF2\u5BFC\u5165\u300C${r.name || "\u6B4C\u5355"}\u300D\u5171 ${r.tracks.length} \u9996`);
    await playAt(0);
  } catch (e) {
    toast(`\u5BFC\u5165\u5931\u8D25\uFF1A${e.message}`, true);
  } finally {
    el.playlistGo.disabled = false;
    el.playlistGo.textContent = "\u5BFC\u5165\u5E76\u64AD\u653E";
  }
}
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    el.playBtn.click();
  }
});
if ("mediaSession" in navigator) {
  try {
    navigator.mediaSession.setActionHandler("previoustrack", prev);
    navigator.mediaSession.setActionHandler("nexttrack", next);
  } catch (_) {
  }
}
store.load();
hist.load();
el.volSlider.value = Math.round(el.audio.volume * 100);
syncVolFill();
el.loopBtn.classList.toggle("on", state.loop !== "all");
el.loopBtn.title = { all: "\u5217\u8868\u5FAA\u73AF", one: "\u5355\u66F2\u5FAA\u73AF", shuffle: "\u968F\u673A\u64AD\u653E" }[state.loop];
function renderThemeList() {
  $("#themeMenu").innerHTML = `<div class="dd-label">\u4E3B\u9898</div>` + THEME_LIST.map((x) => `<button class="dd-opt ${state.theme === x.id ? "on" : ""}" data-pick="${x.id}">
        <span class="dd-dot" style="--a:${x.a};--b:${x.b}"></span>${x.lab}
      </button>`).join("");
  $("#themeName").textContent = (THEME_LIST.find((x) => x.id === state.theme) || THEME_LIST[1]).lab;
}
$("#themeMenu").addEventListener("click", (e) => {
  const opt = e.target.closest("[data-pick]");
  if (!opt) return;
  setTheme(opt.dataset.pick);
  renderThemeList();
  closeDDs();
  const lab = (THEME_LIST.find((x) => x.id === opt.dataset.pick) || {}).lab;
  toast(`\u4E3B\u9898\uFF1A${lab}`);
});
syncImportTip();
setTheme(state.theme);
updateQueueCount();
renderWelcome();
changeBg();
loadEngines();
api("/api/capability").then((c) => {
  Object.assign(CAP, c);
  renderSourceList();
  syncImportTip();
}).catch(() => {
});
if (state.source !== "all") probeLatency(state.source);
renderSourceList();
if (state.queue.length) {
  renderQueue();
  toast(`\u5DF2\u6062\u590D\u4E0A\u6B21\u961F\u5217\uFF08${state.queue.length} \u9996\uFF09\uFF0C\u70B9\u51FB\u64AD\u653E\u7EE7\u7EED`);
}
el.searchInput.focus();
const LX_KEY_UI = { netease: "wy", tencent: "tx", kugou: "kg", kuwo: "kw", migu: "mg" };
function enginesFor(source) {
  const key = LX_KEY_UI[source];
  return state.lxEngines.filter((e) => key && e.sources && e.sources[key]);
}
async function loadEngines() {
  try {
    const r = await api("/api/lx");
    state.lxEngines = (r.engines || []).filter((e) => e.ok);
  } catch (_) {
    state.lxEngines = [];
  }
  refreshEngineBar();
}
async function probeLatency(source, force) {
  if (!LX_KEY_UI[source] || source === "all") {
    state.lat[source] = null;
    renderEngineBarMeta();
    return;
  }
  if (state.latBusy === source && !force) return;
  state.latBusy = source;
  const msElT = $("#engineMs");
  if (msElT) msElT.classList.add("testing");
  renderEngineBarMeta();
  try {
    const r = await api(`/api/lx/latency?source=${source}${force ? "&force=1" : ""}`, { timeout: 25e3 });
    if (state.source !== source) return;
    const map = {};
    (r.rows || []).forEach((x) => {
      map[x.file] = x.ms;
    });
    state.lat[source] = map;
    state.latEngineName = {};
    (r.rows || []).forEach((x) => {
      state.latEngineName[x.file] = x.name;
    });
  } catch (_) {
    if (state.lat[source] == null) state.lat[source] = null;
  } finally {
    if (state.latBusy === source) {
      state.latBusy = null;
      const msEl = $("#engineMs");
      if (msEl) msEl.classList.remove("testing");
      renderEngineBarMeta();
      refreshEngineBar();
    }
  }
}
function renderEngineBarMeta() {
  const cur = state.engineBySource[state.source] || "";
  const lat = state.lat[state.source];
  const note = $("#probeState");
  if (note) {
    if (state.latBusy === state.source) note.textContent = "\u6D4B\u901F\u4E2D\u2026";
    else if (!lat) note.textContent = "";
    else {
      const vals = Object.values(lat);
      const alive = vals.filter((v) => v != null).length;
      const dead = vals.length - alive;
      note.textContent = vals.length ? `\u5DF2\u6D4B ${vals.length} \u6761 \xB7 ${alive} \u53EF\u7528${dead ? ` \xB7 ${dead} \u8D85\u65F6` : ""}` : "\u6D4B\u901F\u5931\u8D25\uFF0C\u53EF\u624B\u52A8\u6307\u5B9A\u7EBF\u8DEF";
    }
  }
  el.engineName.textContent = cur ? state.latEngineName[cur] || cur.replace(/\.js$/, "") : "\u81EA\u52A8";
  if (cur && lat && lat[cur] != null) {
    el.engineMs.textContent = lat[cur] + "ms";
    el.engineMs.classList.toggle("slow", lat[cur] > 2500);
  } else if (cur && lat && lat[cur] == null) {
    el.engineMs.textContent = "\u8D85\u65F6";
    el.engineMs.classList.add("slow");
  } else if (lat) {
    const vals = Object.values(lat).filter((v) => v != null).sort((x, y) => x - y);
    const cold = vals.filter((v) => v >= 60);
    const fast = cold.length ? cold[0] : vals[0] ?? null;
    const fmt = (v) => v == null ? "" : v < 1e3 ? `${v}ms` : `${(v / 1e3).toFixed(1)}s`;
    el.engineMs.textContent = vals.length ? `\u5B9E\u6D4B\u6700\u5FEB ${fmt(fast)}\uFF08${cold.length || vals.length}\u8DEF${cold.length ? "" : "\xB7\u7F13\u5B58\u547D\u4E2D"}\uFF09` : "\u5168\u90E8\u8D85\u65F6";
    el.engineMs.classList.remove("slow");
  } else el.engineMs.textContent = "";
}
function renderEngineList() {
  const list = enginesFor(state.source);
  const lat = state.lat[state.source];
  const cur = state.engineBySource[state.source] || "";
  if (!lat) {
    el.engineMenu.innerHTML = `<div class="dd-label">\u4E0A\u6E38\u7EBF\u8DEF \xB7 ${SRC_LABEL[state.source] || state.source}</div>
      <button class="dd-opt ${!cur ? "on" : ""}" data-eng="">\u81EA\u52A8<span class="dd-lat">\u9ED8\u8BA4</span></button>` + list.map((e) => `<button class="dd-opt ${cur === e.file ? "on" : ""}" data-eng="${esc(e.file)}">${esc(e.name || e.file)}<span class="dd-lat">\u672A\u6D4B</span></button>`).join("") + `<div class="dd-foot">\u6D4B\u901F\u4E0E\u641C\u7D22\u5E76\u884C\u8FDB\u884C</div>`;
    return;
  }
  const alive = list.map((e) => ({ e, ms: lat[e.file] })).filter((x) => x.ms != null).sort((a, b) => a.ms - b.ms);
  const dead = list.map((e) => ({ e, ms: lat[e.file] })).filter((x) => x.ms == null);
  el.engineMenu.innerHTML = `<div class="dd-label">\u4E0A\u6E38\u7EBF\u8DEF \xB7 ${SRC_LABEL[state.source] || state.source}</div>
    <button class="dd-opt ${!cur ? "on" : ""}" data-eng="">\u81EA\u52A8<span class="dd-lat">${alive[0] ? "\u6311\u6700\u5FEB" : "\u9ED8\u8BA4"}</span></button>
    ${alive.map(({ e, ms }) => `<button class="dd-opt ${cur === e.file ? "on" : ""}" data-eng="${esc(e.file)}">${esc(e.name || e.file)}<span class="dd-lat ${ms > 2500 ? "slow" : ""}${ms < 60 ? " cached" : ""}">${ms < 60 ? ms + "ms \u7F13\u5B58" : ms + "ms"}</span></button>`).join("")}
    ${dead.length ? `<div class="dd-foot">\u5DF2\u8FC7\u6EE4 ${dead.length} \u4E2A\u8D85\u65F6\u7EBF\u8DEF</div>` : ""}`;
}
function refreshEngineBar() {
  el.engineBar.hidden = !(state.source !== "all" && enginesFor(state.source).length);
  el.engineMenu.hidden = true;
  el.engineBtn.setAttribute("aria-expanded", "false");
  if (!el.engineBar.hidden) {
    renderEngineBarMeta();
    renderEngineList();
  }
}
el.engineBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDD(DDS.find((x) => x.id === "engineDD"));
  if (!el.engineMenu.hidden) renderEngineList();
});
el.engineMenu.addEventListener("click", (e) => {
  const opt = e.target.closest("[data-eng]");
  if (!opt) return;
  const chosen = opt.dataset.eng;
  if (chosen) {
    const ms = state.lat[state.source] && state.lat[state.source][chosen];
    if (ms == null) {
      toast("\u8BE5\u7EBF\u8DEF\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u6D4B\u901F\u540E\u518D\u6307\u5B9A", true);
      return;
    }
  }
  state.engineBySource[state.source] = chosen;
  store.save();
  closeDDs();
  renderEngineBarMeta();
  renderEngineList();
  const nm = chosen ? state.latEngineName[chosen] || chosen.replace(/\.js$/, "") : "\u81EA\u52A8";
  toast(`\u300C${SRC_LABEL[state.source]}\u300D\u4E0A\u6E38\uFF1A${nm}`);
  if (state.current && state.current.source === state.source) {
    const pos = el.audio.currentTime;
    playTrack(state.current, state.currentTier).then(() => {
      el.audio.addEventListener("loadedmetadata", () => {
        el.audio.currentTime = pos;
      }, { once: true });
    });
  }
});
const DDS = [
  { id: "srcDD", btn: "#srcBtn", menu: "#srcMenu" },
  { id: "themeDD", btn: "#themeBtn", menu: "#themeMenu" },
  { id: "engineDD", btn: "#engineBtn", menu: "#engineMenu" }
];
function closeDDs(exceptId) {
  DDS.forEach((d) => {
    if (d.id === exceptId) return;
    const menu = $(d.menu), btn = $(d.btn);
    if (menu) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });
}
function toggleDD(d) {
  const menu = $(d.menu), btn = $(d.btn);
  if (!menu || !btn) return;
  const open = menu.hidden;
  closeDDs(d.id);
  if (!open) {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    return;
  }
  btn.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  positionMenu(menu, btn);
}
function positionMenu(menu, btn) {
  const rot = document.documentElement.dataset.land === "css";
  if (!rot) {
    const br = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = Math.round(br.bottom) + 5 + "px";
    menu.style.left = Math.round(br.left) + "px";
    menu.style.right = "auto";
  } else {
    menu.style.position = "";
  }
  keepInView(menu);
}
function keepInView(menu) {
  menu.style.marginTop = "";
  menu.style.marginLeft = "";
  const rot = document.documentElement.dataset.land === "css";
  const r = menu.getBoundingClientRect();
  let mt = 0, ml = 0;
  if (rot) {
    if (r.x < 4) mt = r.x - 4;
    if (r.bottom > innerHeight - 4) ml = innerHeight - 4 - r.bottom;
    else if (r.y < 4) ml = 4 - r.y;
  } else {
    if (r.bottom > innerHeight - 8) mt = innerHeight - 8 - r.bottom;
    if (r.right > innerWidth - 8) ml = innerWidth - 8 - r.right;
  }
  if (mt) menu.style.marginTop = mt + "px";
  if (ml) menu.style.marginLeft = ml + "px";
}
window.__imgfail = function(el2) {
  if (!el2) return;
  const step = el2.dataset.imgStep || "0";
  const orig = el2.dataset.orig || "";
  if (step === "0" && orig) {
    el2.dataset.imgStep = "1";
    const via = picViaProxy(orig);
    if (via) {
      el2.src = via;
      return;
    }
  }
  el2.dataset.imgStep = "2";
  el2.classList.add("noimg");
  el2.src = BLANK_COVER.replace(/'/g, "%27");
};
document.addEventListener("error", (e) => {
  if (e.target && e.target.tagName === "IMG") window.__imgfail(e.target);
}, true);
document.addEventListener("click", (e) => {
  if (e.target.closest(".dd")) {
    const trig = e.target.closest(".dd-btn, .dd-trigger");
    if (trig) {
      const dd = trig.closest(".dd");
      const conf = DDS.find((x) => x.id === dd.id);
      if (conf) {
        const wasOpen = !$(conf.menu).hidden;
        toggleDD(conf);
        if (conf.id === "engineDD" && !$(conf.menu).hidden) renderEngineList();
        if (conf.id === "themeDD" && !$(conf.menu).hidden) renderThemeList();
        if (wasOpen) $(conf.menu).querySelectorAll(".dd-opt").forEach((o) => o.classList.toggle("chk", false));
      }
      e.stopPropagation();
      return;
    }
    return;
  }
  closeDDs();
});
(function() {
  const btn = $("#rotBtn");
  if (!btn) return;
  const store2 = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (_) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (_) {
      }
    }
  };
  const landscape = () => innerWidth >= innerHeight;
  const touchish = () => matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 760;
  const land = { mode: "off", was: "" };
  function sizeCss() {
    const vv = visualViewport || { width: innerWidth, height: innerHeight };
    const de = document.documentElement.style;
    de.setProperty("--fl-w", Math.round(vv.height) + "px");
    de.setProperty("--fl-h", Math.round(vv.width) + "px");
    const flH = Math.round(vv.width);
    if (flH && flH < 430) document.documentElement.dataset.flShort = "short";
    else delete document.documentElement.dataset.flShort;
  }
  function apply(mode) {
    land.mode = mode;
    document.documentElement.dataset.land = mode === "css" ? "css" : "";
    if (mode === "css") sizeCss();
    else {
      const de = document.documentElement.style;
      de.removeProperty("--fl-w");
      de.removeProperty("--fl-h");
      if (innerHeight && innerHeight < 430) document.documentElement.dataset.flShort = "short";
      else delete document.documentElement.dataset.flShort;
    }
    syncRotBtn();
    if (typeof refreshHints === "function") refreshHints();
  }
  apply("off");
  function syncRotBtn() {
    const inLand = land.mode === "css" || land.mode === "native" || landscape();
    btn.hidden = !(inLand || touchish() && !landscape());
    if (land.mode === "css") {
      btn.textContent = "\u9000\u51FA\u6A2A\u5C4F";
      btn.title = "\u9000\u51FA\u6A2A\u5C4F";
    } else if (land.mode === "native") {
      btn.textContent = "\u9000\u51FA\u6A2A\u5C4F";
      btn.title = "\u9000\u51FA\u6A2A\u5C4F\uFF08\u5DF2\u539F\u751F\u9501\u5B9A\uFF09";
    } else if (inLand) {
      btn.textContent = "\u9000\u51FA\u6A2A\u5C4F";
      btn.title = "\u9000\u51FA\u6A2A\u5C4F\u663E\u793A";
    } else {
      btn.textContent = "\u6A2A\u5C4F";
      btn.title = "\u6A2A\u5C4F\u663E\u793A\uFF08iPhone \u7528\u9875\u9762\u65CB\u8F6C\u5B9E\u73B0\uFF09";
    }
  }
  async function toggle() {
    if (land.mode !== "off") {
      try {
        screen.orientation.unlock();
      } catch (_) {
      }
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch (_) {
        }
      }
      apply("off");
      store2.set("fg.land", "off");
      return;
    }
    if (landscape()) {
      toast("\u5DF2\u7ECF\u662F\u6A2A\u5C4F\u4E86");
      return;
    }
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch (_) {
    }
    let locked = false;
    try {
      await screen.orientation.lock("landscape");
      locked = true;
    } catch (_) {
    }
    if (locked) {
      const reallyLandscape = await new Promise((res) => {
        let n = 0;
        const tick = () => {
          if (landscape()) return res(true);
          if (++n > 12) return res(false);
          setTimeout(tick, 50);
        };
        tick();
      });
      if (reallyLandscape) {
        apply("native");
        store2.set("fg.land", "native");
        toast("\u5DF2\u9501\u5B9A\u6A2A\u5C4F");
        return;
      }
      try {
        screen.orientation.unlock();
      } catch (_) {
      }
    }
    apply("css");
    store2.set("fg.land", "css");
    toast("\u5DF2\u5207\u6362\u6A2A\u5C4F\u663E\u793A");
  }
  btn.addEventListener("click", toggle);
  let fields = 0;
  const isField = (n) => /^(INPUT|TEXTAREA|SELECT)$/.test(n || "");
  document.addEventListener("focusin", (e) => {
    if (!isField(e.target.tagName)) return;
    fields++;
    if (land.mode === "css") apply("off");
  });
  document.addEventListener("focusout", (e) => {
    if (!isField(e.target.tagName)) return;
    fields = Math.max(0, fields - 1);
    setTimeout(() => {
      const ae = document.activeElement;
      if (fields || isField(ae && ae.tagName)) return;
      if (store2.get("fg.land") === "css" && !landscape()) apply("css");
    }, 150);
  });
  addEventListener("resize", () => {
    if (land.mode === "css") {
      if (landscape()) apply("off");
      else sizeCss();
    } else syncRotBtn();
  });
  if (visualViewport) visualViewport.addEventListener("resize", () => {
    if (land.mode === "css") sizeCss();
  });
  addEventListener("orientationchange", () => setTimeout(() => {
    if (land.mode === "css" && landscape()) apply("off");
    else syncRotBtn();
  }, 280));
  if (store2.get("fg.land") === "css") apply("css");
})();
const SHINT_ARROW = {
  "x-a": "M15 6l-6 6 6 6",
  "x-b": "M9 6l6 6-6 6",
  "y-a": "M6 15l6-6 6 6",
  "y-b": "M6 9l6 6 6-6"
};
function attachScrollHint(cfg) {
  const { host, scroller, axis } = cfg;
  if (!host || !scroller) return null;
  const hostPos = getComputedStyle(host).position;
  if (hostPos === "static") host.style.position = "relative";
  const mk = (side) => {
    const b2 = document.createElement("button");
    b2.type = "button";
    b2.className = `shint ${axis}-${side}`;
    b2.innerHTML = `<svg viewBox="0 0 24 24" class="ic"><path d="${SHINT_ARROW[axis + "-" + side]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    b2.tabIndex = -1;
    b2.setAttribute("aria-hidden", "true");
    b2.addEventListener("click", (e) => {
      e.preventDefault();
      const sz = axis === "x" ? scroller.clientWidth : scroller.clientHeight;
      scroller.scrollBy({ left: axis === "x" ? side === "a" ? -sz : sz : 0, top: axis === "y" ? side === "a" ? -sz : sz : 0, behavior: "smooth" });
    });
    host.appendChild(b2);
    return b2;
  };
  const a = mk("a"), b = mk("b");
  const rel = (el2) => {
    let l = 0, t = 0, n = el2;
    while (n && n !== host) {
      l += n.offsetLeft;
      t += n.offsetTop;
      n = n.offsetParent;
    }
    const cs = getComputedStyle(host);
    return { l: l - (parseFloat(cs.borderLeftWidth) || 0), t: t - (parseFloat(cs.borderTopWidth) || 0), w: el2.offsetWidth, h: el2.offsetHeight };
  };
  function update() {
    const hostHidden = host.hidden || host.offsetWidth === 0 || host.offsetHeight === 0 || getComputedStyle(host).display === "none";
    if (hostHidden) {
      a.classList.remove("on");
      b.classList.remove("on");
      a.style.display = "none";
      b.style.display = "none";
      return;
    }
    const r = rel(scroller);
    const horiz = axis === "x";
    a.style.left = (horiz ? r.l + 5 : r.l + r.w / 2 - 13) + "px";
    a.style.top = (horiz ? r.t + r.h / 2 - 13 : r.t + 5) + "px";
    b.style.left = (horiz ? r.l + r.w - 31 : r.l + r.w / 2 - 13) + "px";
    b.style.top = (horiz ? r.t + r.h / 2 - 13 : r.t + r.h - 31) + "px";
    const max = horiz ? scroller.scrollWidth - scroller.clientWidth : scroller.scrollHeight - scroller.clientHeight;
    const pos = horiz ? scroller.scrollLeft : scroller.scrollTop;
    a.classList.toggle("on", max > 8 && pos > 4);
    b.classList.toggle("on", max > 8 && pos < max - 4);
    if (max <= 8) {
      a.style.display = "none";
      b.style.display = "none";
    } else {
      a.style.display = "";
      b.style.display = "";
    }
  }
  scroller.addEventListener("scroll", update, { passive: true });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
  }
  return { update, scroller };
}
function initHints() {
  HINTS.push(attachScrollHint({ host: $("#player"), scroller: $(".player-grid"), axis: "x" }));
  HINTS.push(attachScrollHint({ host: $("#immersive"), scroller: $(".imm-lrc-inner"), axis: "y" }));
  HINTS.push(attachScrollHint({ host: document.body, scroller: $("#sidebar"), axis: "y" }));
  HINTS.push(attachScrollHint({ host: $(".side-sec") || document.body, scroller: $(".side-btns"), axis: "x" }));
  for (const sc of document.querySelectorAll("#sidebar .dd-menu")) {
    HINTS.push(attachScrollHint({ host: sc.closest(".dd") || sc.parentElement, scroller: sc, axis: "y" }));
  }
  refreshHints();
}
var hintQueued = false;
var HINTS = [];
function applyLayoutMark() {
  const de = document.documentElement;
  const next2 = de.dataset.land === "css" || innerWidth >= innerHeight ? "wide" : "tall";
  if (de.dataset.layout !== next2) de.dataset.layout = next2;
}
function updateHints() {
  (HINTS || []).forEach((h) => {
    try {
      h && h.update();
    } catch (_) {
    }
  });
}
function refreshHints(now) {
  applyLayoutMark();
  if (!now) {
    if (hintQueued) return;
    hintQueued = true;
    requestAnimationFrame(() => {
      hintQueued = false;
      updateHints();
    });
    return;
  }
  updateHints();
}
addEventListener("resize", () => refreshHints());
addEventListener("orientationchange", () => setTimeout(refreshHints, 300));
new MutationObserver(() => refreshHints()).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style"] });
initHints();
(async () => {
  const txt = $("#hitokoto"), from = $("#hitokotoFrom"), btn = $("#hitokotoBtn");
  async function roll() {
    txt.textContent = "\u6362\u4E00\u53E5\u2026";
    try {
      const { text, from: f, who } = await api("/api/hitokoto");
      txt.textContent = text || "\u613F\u4ECA\u5929\u7684\u4F60\uFF0C\u6709\u6B4C\u53EF\u542C\u3002";
      from.textContent = f ? `\u2014\u2014 ${f}` : "";
    } catch (_) {
      txt.textContent = "\u613F\u4ECA\u5929\u7684\u4F60\uFF0C\u6709\u597D\u6B4C\u53EF\u542C\u3002";
      from.textContent = "";
    }
  }
  btn.addEventListener("click", roll);
  roll();
})();
