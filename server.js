"use strict";
process.on("uncaughtException", (err) => {
  console.error("[guard] uncaught:", (err && err.message ? err.message : err).toString().slice(0, 200));
});
process.on("unhandledRejection", (err) => {
  console.error("[guard] unhandled:", (err && err.message ? err.message : err).toString().slice(0, 200));
});
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const PORT = process.env.PORT || 3e3;
const APP_ROOT = process.env.APP_ROOT || getRoot();
function getRoot() {
  try {
    if (fs.existsSync(path.join(APP_ROOT, "config.json"))) return __dirname;
    const up = path.resolve(__dirname, "..");
    if (fs.existsSync(path.join(up, "config.json"))) return up;
  } catch (_) {
  }
  return __dirname;
}
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const GD_API = "https://music-api.gdstudio.xyz/api.php";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
let RESOLVERS = { tencent: [], kugou: [] };
let BG_API = "";
let CFG = {};
try {
  CFG = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "config.json"), "utf8"));
  if (CFG.resolvers) RESOLVERS = Object.assign(RESOLVERS, CFG.resolvers);
  if (CFG.background && CFG.background.api) BG_API = CFG.background.api;
} catch (_) {
}
if (process.env.QQ_RESOLVERS) RESOLVERS.tencent = process.env.QQ_RESOLVERS.split(",");
if (process.env.KUGOU_RESOLVERS) RESOLVERS.kugou = process.env.KUGOU_RESOLVERS.split(",");
if (process.env.BG_API) BG_API = process.env.BG_API;
async function resolveBg(u) {
  if (u.startsWith("bing:")) {
    const { data } = await fetchJSON(`https://cn.bing.com/HPImageArchive.aspx?format=js&idx=${u.split(":")[1]}&n=1`, {}, 8e3);
    const img = data && data.images && data.images[0];
    return img && img.url ? `https://cn.bing.com${img.url}` : null;
  }
  if (u.startsWith("picsum:")) return `https://picsum.photos/seed/${u.split(":")[1]}/1920/1080`;
  let cur = u;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(cur, { redirect: "manual", signal: AbortSignal.timeout(9e3), headers: { "User-Agent": UA } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return null;
      cur = new URL(loc, cur).href;
      continue;
    }
    return r.ok ? cur : null;
  }
  return cur;
}
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
};
async function fetchText(url, opts = {}, timeout = 1e4) {
  const headers = Object.assign({ "User-Agent": UA }, opts.headers || {});
  const r = await fetch(url, { method: opts.method || "GET", headers, body: opts.body, signal: AbortSignal.timeout(timeout) });
  return { status: r.status, text: await r.text() };
}
async function fetchJSON(url, opts = {}, timeout = 1e4) {
  const r = await fetchText(url, opts, timeout);
  try {
    return { status: r.status, data: JSON.parse(r.text) };
  } catch (_) {
    return { status: r.status, data: null, raw: r.text.slice(0, 200) };
  }
}
function neteaseEncryptId(id) {
  const key = "3go8&$8*3*3h0k(2)2";
  const xored = Buffer.from(String(id)).map((b, i) => b ^ key.charCodeAt(i % key.length));
  const md5 = crypto.createHash("md5").update(xored).digest();
  return md5.toString("base64").replace(/\//g, "_").replace(/\+/g, "-");
}
const QUALITY_LEVELS = { lossless: [999, 320, 128], high: [320, 128], standard: [128] };
const TIER_ORDER = ["master", "atmos_plus", "atmos", "hires", "lossless", "high", "standard"];
const CHAINS = {
  master: { lx: ["master"], gd: [999, 320, 128] },
  atmos_plus: { lx: ["atmos_plus"], gd: [999, 320, 128] },
  atmos: { lx: ["atmos"], gd: [999, 320, 128] },
  hires: { lx: ["hires", "flac24bit"], gd: [999, 320, 128] },
  lossless: { lx: ["flac"], gd: [999, 320, 128] },
  high: { lx: ["320k"], gd: [320, 128] },
  standard: { lx: ["128k"], gd: [128] }
};
const Q_LABEL = { master: "Master", flac24bit: "Hires", atmos_plus: "Atmos+", atmos: "Atmos", hires: "Hires", flac: "FLAC", "320k": "320K", "128k": "128K" };
function brLabel(br) {
  if (!br || br < 0) return "\u672A\u77E5";
  if (br >= 900) return "FLAC";
  if (br >= 320) return "320K";
  if (br >= 192) return "192K";
  if (br > 0) return "128K";
  return String(br);
}
const searchCache = new Map();
const searchFlight = new Map();
const nePicCache = new Map();
function cachedSearch(key, producer, ttl = 12e4) {
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.value);
  if (searchFlight.has(key)) return searchFlight.get(key);
  const pr = Promise.resolve().then(producer).then((v) => {
    const empty = !v || (Array.isArray(v) ? v.length === 0 : Array.isArray(v.tracks) ? v.tracks.length === 0 : Array.isArray(v.albums) ? v.albums.length === 0 : Array.isArray(v.playlists) ? v.playlists.length === 0 : false);
    if (!empty) {
      searchCache.set(key, { ts: Date.now(), value: v });
      if (searchCache.size > 200) {
        [...searchCache.keys()].slice(0, 80).forEach((k) => searchCache.delete(k));
      }
    }
    return v;
  }).catch((e) => {
    searchFlight.delete(key);
    throw e;
  }).finally(() => searchFlight.delete(key));
  searchFlight.set(key, pr);
  return pr;
}
function withDeadline(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((res) => setTimeout(() => res(fallback), ms))
  ]);
}
async function firstNonEmpty(fns, budget = 8500) {
  const t0 = Date.now();
  for (const fn of fns) {
    if (Date.now() - t0 > budget) break;
    try {
      const r = await fn();
      if (Array.isArray(r) && r.length) return r;
    } catch (_) {
    }
  }
  return [];
}
async function normalizeWithPics(list, fill) {
  if (fill !== "1" && fill !== 1) return list;
  if (!list.length || list.every((t) => t.pic)) return list;
  try {
    const ids = list.slice(0, 40).map((t) => t.id);
    const c = JSON.stringify(ids.map((i) => ({ id: +i || i })));
    const { data } = await fetchJSON("https://music.163.com/api/v3/song/detail", {
      method: "POST",
      headers: { Referer: "https://music.163.com", Cookie: "os=pc", "Content-Type": "application/x-www-form-urlencoded" },
      body: `c=${encodeURIComponent(c)}&id=${ids[0]}`
    }, 4e3);
    const arr = data && (data.songs || data.list) || [];
    const byId = new Map(arr.map((x) => [String(x.songId || x.id), x]));
    return list.map((t) => {
      const d = byId.get(String(t.id));
      const al = d && (d.al || d.album);
      const picId = al && (al.pic_str || al.picId || al.pic);
      const pic = al && (al.picUrl || (picId ? `https://p3.music.126.net/${neteaseEncryptId(picId)}/${picId}.jpg?param=300y300` : ""));
      return pic ? Object.assign({}, t, { pic, album: t.album || al && al.name || "" }) : t;
    });
  } catch (_) {
    return list;
  }
}
function normNe(t) {
  return {
    source: "netease",
    id: String(t.id),
    name: t.name,
    artist: (t.ar || t.artists || (typeof t.artist === "string" ? [{ name: t.artist }] : t.artist) || []).map((a) => a && (a.name || a.songName || a.alias) || a).filter(Boolean).join(" / "),
    album: t.album && (t.album.name || t.album.title) || t.al && t.al.name || (typeof t.album === "string" ? t.album : ""),
    pic: t.album && t.album.picUrl || (t.pic_id ? `https://p3.music.126.net/${neteaseEncryptId(t.pic_id)}/${t.pic_id}.jpg?param=300y300` : "") || (t.album && t.album.picId ? `https://p3.music.126.net/${neteaseEncryptId(t.album.picId)}/${t.album.picId}.jpg?param=300y300` : "") || t.al && t.al.picUrl || "",
    duration: normDuration(t.dt ?? t.songTimeLength ?? t.duration),
    extra: {}
  };
}
const netease = {
  HD() {
    return { Referer: "https://music.163.com", Cookie: "os=pc; Device-Id=", "Content-Type": "application/x-www-form-urlencoded" };
  },
  async search(kw, page, fill) {
    const offset = (Math.max(1, page) - 1) * 30;
    const forms = [
      () => fetchJSON("https://music.163.com/api/cloudsearch/pc", { method: "POST", headers: this.HD(), body: `s=${encodeURIComponent(kw)}&type=1&offset=${offset}&limit=30&total=true&pcver=8.9.75&appver=8.9.75` }, 6e3).then((r) => {
        const l = r.data && r.data.result && r.data.result.songs;
        return Array.isArray(l) ? l.map(normNe) : [];
      }),
      () => fetchJSON("https://music.163.com/api/search/get/web", { method: "POST", headers: this.HD(), body: `s=${encodeURIComponent(kw)}&type=1&offset=${offset}&limit=30` }, 6e3).then((r) => {
        const l = r.data && r.data.result && r.data.result.songs;
        return Array.isArray(l) ? l.map(normNe) : [];
      }),
      () => fetchJSON(`https://music.163.com/api/search/get?s=${encodeURIComponent(kw)}&type=1&offset=${offset}&limit=30`, { method: "POST", headers: this.HD(), body: `s=${encodeURIComponent(kw)}&type=1&offset=${offset}&limit=30` }, 6e3).then((r) => {
        const l = r.data && r.data.result && r.data.result.songs;
        return Array.isArray(l) ? l.map(normNe) : [];
      }),
      () => fetchJSON(`${GD_API}?types=search&source=netease&name=${encodeURIComponent(kw)}&count=30&pages=${page}`, {}, 8e3).then((r) => Array.isArray(r.data) ? r.data.map(normNe) : [])
    ];
    return normalizeWithPics(await firstNonEmpty(forms), fill);
  },
  async url(id, br) {
    const { data } = await fetchJSON(`${GD_API}?types=url&source=netease&id=${encodeURIComponent(id)}&br=${br}`, {}, 15e3);
    if (!data || !data.url) return null;
    return { url: data.url, br: Number(data.br) || br, size: data.size || 0 };
  },
  async lyric(id) {
    let { data } = await fetchJSON(
      `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`,
      { headers: { Referer: "https://music.163.com", Cookie: "os=pc" } },
      8e3
    );
    if (data && data.lrc && data.lrc.lyric) return data.lrc.lyric;
    ({ data } = await fetchJSON(`${GD_API}?types=lyric&source=netease&id=${encodeURIComponent(id)}`, {}, 1e4));
    return data && data.lyric ? data.lyric : "";
  }
};
function kuwoRegexRows(text) {
  const rows = [];
  for (const chunk of String(text || "").split(/\}(?:\s*,\s*\{|\s*\])/).slice(1)) {
    const o = {};
    const re = /(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(\[[^\]]*\]|\{[^{}]*\}|[^,{}\s][^,{}]*))/g;
    let m;
    while (m = re.exec(chunk)) {
      const k = m[1] || m[2] || m[3];
      let v = m[4] ?? m[5] ?? m[6] ?? "";
      if (typeof v === "string") v = v.replace(/\\(['"\\])/g, "$1").trim();
      if (k) o[k] = v;
    }
    if (Object.keys(o).length > 6) rows.push(o);
  }
  return rows.length ? { musiclist: rows } : null;
}
function normDuration(v) {
  if (v == null || v === "") return void 0;
  if (typeof v === "string" && v.includes(":") && /^[\d:]+$/.test(v)) {
    const p = v.split(":").map(Number);
    if (p.some((n2) => !Number.isFinite(n2))) return void 0;
    return (p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]) || void 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return void 0;
  return Math.round(n > 2e3 ? n / 1e3 : n);
}
function isKuwoClip(t) {
  const n = String(t && t.name || "");
  if (/(片段|彩铃|铃声|试听|预告|\bclip\b|\bpreview\b|high\s*潮)/i.test(n)) return true;
  const d = t && t.duration;
  return !!d && d < 45;
}
const kuwo = {
  async search(kw, page) {
    const rn = 30, pn = (Math.max(1, page) - 1) * rn;
    try {
      const r = await fetchText(`http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}&ft=music&itemset=web_2013&client=kt&pn=${pn}&rn=${rn}&rformat=json&encoding=utf8`, {}, 6e3);
      let d = parseKuwoLiteral(r.text) || kuwoRegexRows(r.text);
      let arr = d && (d.musiclist || d.abslist);
      if (!Array.isArray(arr) || !arr.length) {
        d = kuwoRegexRows(r.text);
        arr = d && (d.musiclist || d.abslist);
      }
      if (Array.isArray(arr) && arr.length) {
        const out = arr.map((x) => {
          const id = String(x.RID || x.id || x.MUSICRID || "").replace(/^MUSIC_/, "");
          const pic = x.PIC || x.web_albumpic_short || "";
          const rawDur = x.DURATION ?? x.DT ?? x.duration ?? x.Web_audio_duration;
          const duration = normDuration(rawDur);
          return {
            source: "kuwo",
            id,
            name: decodeHtml(x.NAME || x.SONGNAME || ""),
            artist: decodeHtml(x.ARTIST || x.ARTISTEN || ""),
            album: decodeHtml(x.ALBUM || x.ALBUMEN || ""),
            duration,
            pic: pic ? /^https?:/.test(pic) ? pic : `https://img4.kuwo.cn/star/albumcover/${String(pic).replace(/^\d+\//, "120/")}` : "",
            extra: {}
          };
        }).filter((t) => t.id && t.name && !isKuwoClip(t));
        if (out.length) return out;
      }
    } catch (_) {
    }
    const { data } = await fetchJSON(`${GD_API}?types=search&source=kuwo&name=${encodeURIComponent(kw)}&count=30&pages=${page}`, {}, 8e3);
    if (!Array.isArray(data)) return [];
    return data.map((t) => ({
      source: "kuwo",
      id: String(t.id),
      name: t.name,
      artist: (t.artist || []).join(" / "),
      album: t.album || "",
      duration: normDuration(t.duration),
      pic: t.pic_id ? `https://img4.kuwo.cn/star/albumcover/${t.pic_id}` : "",
      extra: {}
    })).filter((t) => t.id && t.name && !isKuwoClip(t));
  },
  async url(id, br) {
    const { data } = await fetchJSON(`${GD_API}?types=url&source=kuwo&id=${encodeURIComponent(id)}&br=${br}`, {}, 15e3);
    if (!data || !data.url) return null;
    return { url: data.url, br: Number(data.br) || br, size: data.size || 0 };
  },
  async lyric(id) {
    const { data } = await fetchJSON(`${GD_API}?types=lyric&source=kuwo&id=${encodeURIComponent(id)}`, {}, 1e4);
    return data && data.lyric ? data.lyric : "";
  }
};
const tencent = {
  async search(kw, page) {
    const norm = (t) => ({
      source: "tencent",
      id: t.mid || t.songmid,
      name: t.title || t.songname,
      artist: (t.singer || []).map((s) => s.name || s).join(" / "),
      album: t.album && (t.album.title || t.album.name) || t.albumname || "",
      duration: normDuration(t.duration ?? t.interval ?? (t.file && t.file.duration) ?? (t.extend && t.extend.duration)),
      pic: t.album && t.album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${t.album.mid}.jpg` : t.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${t.albummid}.jpg` : "",
      extra: { pay: t.pay && t.pay.pay_play }
    });
    const a = await fetchJSON(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(kw)}&format=json&n=30&p=${page}&cr=1&new_json=1`,
      { headers: { Referer: "https://y.qq.com/" } },
      4500
    );
    const list = a.data && a.data.data && a.data.data.song && a.data.data.song.list;
    if (Array.isArray(list) && list.length) return list.map(norm);
    const b = await fetchJSON("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      headers: { Referer: "https://y.qq.com/", Origin: "https://y.qq.com", "Content-Type": "application/json" },
      body: JSON.stringify({ "music.search.SearchCgiService": { method: "DoSearchForQQMusicDesktop", module: "music.search.SearchCgiService", param: { num_per_page: 30, page_num: page, query: kw, search_type: 0 } } })
    }, 4500);
    const svc = b.data && b.data["music.search.SearchCgiService"];
    const bl = svc && svc.data && (svc.data.body && svc.data.body.list || svc.data.list);
    if (Array.isArray(bl)) return bl.map(norm);
    return [];
  },
  async lyric(id) {
    const { data } = await fetchJSON(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(id)}&g_tk=5381&format=json&nobase64=1`,
      { headers: { Referer: "https://y.qq.com/" } },
      8e3
    );
    return data && data.lyric ? data.lyric : "";
  },
  async officialUrl(id) {
    const guid = "9588951007695234";
    const { data } = await fetchJSON("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      headers: { Referer: "https://y.qq.com/", "Content-Type": "application/json" },
      body: JSON.stringify({ req_1: { module: "vkey.GetVkeyServerBase", method: "CgiGetVkey", param: { guid, songmid: [id], filename: [], songtype: [0], uin: "0", loginflag: 0, platform: "20" } } })
    }, 1e4);
    const info = data && data.req_1 && data.req_1.data;
    if (!info || !info.midurlinfo || !info.midurlinfo[0] || !info.midurlinfo[0].purl) return null;
    const purl = info.midurlinfo[0].purl;
    const sip = info.sip && info.sip.find((s) => s.startsWith("http")) || "http://dl.stream.qqmusic.qq.com/";
    return { url: sip + purl, br: 128, size: 0 };
  },
  async url(id, br, quality) {
    for (const tpl of RESOLVERS.tencent) {
      const u = tpl.replace("{id}", encodeURIComponent(id)).replace("{br}", String(br));
      const { data } = await fetchJSON(u, {}, 1e4);
      const got = data && (data.url || data.data && data.data.url);
      if (got) return { url: got, br: Number(data && data.br || br) || br, size: 0 };
    }
    const off = await this.officialUrl(id).catch(() => null);
    if (off) return off;
    return null;
  }
};
const kugou = {
  async search(kw, page, fill) {
    const norm = (t) => {
      const hash = String(t.FileHash || t.hash || "").toLowerCase();
      const rawPic = t.Image || t.SizableCover || t.sizableCover || t.AlbumImage || "";
      const pic = rawPic ? String(rawPic).replace(/\{size\}/g, "240").replace(/^http:/i, "https:") : "";
      return {
        source: "kugou",
        id: hash,
        name: t.SongName || t.OriSongName || t.songname || "",
        artist: (t.SingerName || t.singername || "").split("&").join(" / ").trim(),
        album: t.AlbumName || t.album_name || "",
        pic,
        duration: Number(t.Duration || t.duration) || void 0,
        _albumId: String(t.AlbumID || t.album_id || ""),
        extra: {
          sq: t.SQFileHash && t.SQPrivilege === 0 ? String(t.SQFileHash).toLowerCase() : null,
          hq: t.HQFileHash && t.HQPrivilege === 0 ? String(t.HQFileHash).toLowerCase() : null
        }
      };
    };
    const v2 = fetchJSON(
      `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(kw)}&page=${page}&pagesize=30&area_code=1`,
      { headers: { Referer: "https://music.kugou.com/", Origin: "https://music.kugou.com" } },
      5e3
    ).then((r) => {
      const l = r.data && r.data.data && r.data.data.lists;
      return Array.isArray(l) ? l.map(norm) : [];
    }).catch(() => []);
    const v3 = fetchJSON(
      `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}&page=${page}&pagesize=30`,
      { headers: { Referer: "https://m.kugou.com/" } },
      6e3
    ).then((r) => {
      const l = r.data && r.data.data && r.data.data.info;
      return Array.isArray(l) ? l.map(norm) : [];
    }).catch(() => []);
    const [a, b] = await Promise.all([v2, v3]);
    let list = a && a.length ? a : b;
    const need = fill === "1" || fill === 1 ? [...new Set(list.filter((t) => !t.pic && t._albumId).map((t) => t._albumId))].slice(0, 12) : [];
    if (need.length) {
      const infos = await Promise.all(need.map((aid) => fetchJSON(
        `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${aid}&imagestd=600`,
        { headers: { Referer: "https://m.kugou.com/" } },
        4e3
      ).then((x) => {
        const d = x.data && x.data.data;
        return d && d.imgurl ? [aid, String(d.imgurl).replace(/\{size\}/g, "600").replace(/^http:/i, "https:")] : null;
      }).catch(() => null)));
      const m = new Map(infos.filter(Boolean));
      list = list.map((t) => !t.pic && m.get(t._albumId) ? Object.assign({}, t, { pic: m.get(t._albumId) }) : t);
    }
    return list.map((t) => {
      const c = Object.assign({}, t);
      delete c._albumId;
      return c;
    }).filter((t) => t.id);
  },
  async lyric(id) {
    const kw = id;
    const s = await fetchJSON(
      `http://krcs.kugou.com/search?version=1.0&clientver=1000&keywords=${encodeURIComponent(kw)}&hash=${encodeURIComponent(id)}&timelength=`,
      { headers: { Referer: "https://www.kugou.com/" } },
      8e3
    );
    const c = s.data && s.data.candidates && s.data.candidates[0];
    if (!c) return "";
    const d = await fetchJSON(
      `http://lyrics.kugou.com/download?ver=1&client=pc&id=${c.id}&accesskey=${encodeURIComponent(c.accesskey)}&fmt=lrc&version=1.0&clientver=2000&cid=`,
      { headers: { Referer: "https://www.kugou.com/" } },
      8e3
    );
    if (d.data && d.data.status === 200 && d.data.content) {
      const lrc = Buffer.from(d.data.content, "base64").toString("utf8");
      return lrc.replace(/<[^>]*>/g, "");
    }
    return "";
  },
  async officialUrl(id) {
    const kgmid = crypto.randomBytes(16).toString("hex");
    const { data } = await fetchJSON(
      `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${encodeURIComponent(id)}`,
      { headers: { Referer: `https://www.kugou.com/song/`, Cookie: `kg_mid=${kgmid}` } },
      1e4
    );
    if (data && data.status === 1 && data.data && data.data.play_url) {
      return { url: data.data.play_url, br: Number(data.data.bitrate) || 128, size: Number(data.data.filesize) || 0 };
    }
    return null;
  },
  async url(id, br, quality, extra) {
    for (const tpl of RESOLVERS.kugou) {
      const useHash = quality === "lossless" && extra && extra.sq ? extra.sq : quality === "high" && extra && extra.hq ? extra.hq : id;
      const u = tpl.replace("{id}", encodeURIComponent(useHash)).replace("{br}", String(br));
      const { data } = await fetchJSON(u, {}, 1e4);
      const got = data && (data.url || data.data && data.data.url);
      if (got) return { url: got, br: Number(data && data.br || br) || br, size: 0 };
    }
    const off = await this.officialUrl(id).catch(() => null);
    if (off) return off;
    return null;
  }
};
const miguSearchCache = new Map();
const migu = {
  async search(kw) {
    const key = kw.trim();
    const hit = miguSearchCache.get(key);
    if (hit && Date.now() - hit.ts < 6e5) return hit.tracks;
    const idx = Array.from({ length: 8 }, (_, i) => i + 1);
    const rs = await Promise.allSettled(idx.map((n) => fetchJSON(`https://api.xcvts.cn/api/music/migu?gm=${encodeURIComponent(kw)}&n=${n}&num=1&type=json`, {}, 5500)));
    const seen = new Set();
    const tracks2 = [];
    for (const r of rs) {
      if (r.status !== "fulfilled" || !r.value.data || r.value.data.code !== 200) continue;
      const t = r.value.data;
      const sid = t.link && (t.link.match(/song\/(\d+)/) || [])[1] || `mg_${tracks2.length}`;
      if (seen.has(sid) || !t.title) continue;
      seen.add(sid);
      tracks2.push({
        source: "migu",
        id: sid,
        name: String(t.title),
        artist: String(t.singer || ""),
        album: "",
        pic: t.cover || "",
        extra: { lrc_url: t.lrc_url || "", music_url: t.music_url || "" }
      });
    }
    miguSearchCache.set(key, { ts: Date.now(), tracks: tracks2 });
    return tracks2;
  },
  async url(id, br, quality, extra) {
    const gm = extra && (extra.name || extra.singer) ? `${extra.name || ""} ${extra.singer || ""}`.trim() : "";
    if (!gm) return null;
    const { data } = await fetchJSON(`https://api.xcvts.cn/api/music/migu?gm=${encodeURIComponent(gm)}&n=1&num=1&type=json`, {}, 9e3);
    if (data && data.code === 200 && data.music_url) return { url: data.music_url, br: 320, size: 0 };
    return null;
  },
  async lyric(id, extra) {
    if (extra && extra.lrc_url) {
      const r = await fetchText(extra.lrc_url, {}, 8e3);
      if (r.status === 200 && r.text) return r.text;
    }
    return "";
  }
};
const SOURCES = { netease, tencent, kugou, kuwo, migu };
const LX_NATIVE = require("./lxweb-native-search.js");
const LX_SRC_MAP = { wy: "netease", tx: "tencent", kg: "kugou", kw: "kuwo", mg: "migu" };
function normLxNativeTrack(t) {
  return {
    source: LX_SRC_MAP[t.source] || t.source,
    id: String(t.songmid || t.songId || t.copyrightId || ""),
    name: t.name,
    artist: t.singer || "",
    album: t.albumName || "",
    pic: t.img || "",
    duration: t.interval || "",
    extra: {
      types: t.types || [],
      songmid: t.songmid,
      songId: t.songId,
      strMediaMid: t.strMediaMid,
      albumMid: t.albumMid,
      copyrightId: t.copyrightId,
      hash: t.hash,
      name: t.name,
      singer: t.singer
    }
  };
}
function lxNativeSearch(key, kw, page, limit) {
  return LX_NATIVE.search(key, kw, page || 1, limit || 30).then((r) => Array.isArray(r.list) ? r.list.map(normLxNativeTrack) : []).catch((e) => {
    console.error(`[LX-NATIVE] ${key} \u641C\u7D22\u5931\u8D25:`, e && (e.stack || e.message || e));
    return [];
  });
}
SOURCES.tencent.search = (kw, page, fill) => lxNativeSearch("tx", kw, page, typeof fill === "number" ? fill : 30);
SOURCES.kugou.search = (kw, page, fill) => lxNativeSearch("kg", kw, page, typeof fill === "number" ? fill : 30);
SOURCES.kuwo.search = (kw, page, fill) => lxNativeSearch("kw", kw, page, typeof fill === "number" ? fill : 30);
SOURCES.migu.search = (kw, page, fill) => lxNativeSearch("mg", kw, page, typeof fill === "number" ? fill : 30);
function parseKuwoLiteral(text) {
  try {
    return vm.runInNewContext(`(${text})`, {}, { timeout: 2e3 });
  } catch (_) {
    return null;
  }
}
function cleanText(list) {
  for (const x of list || []) {
    if (!x || typeof x !== "object") continue;
    for (const k of ["name", "artist", "album", "desc", "publish", "title"]) {
      if (typeof x[k] === "string" && x[k].indexOf("&") >= 0) x[k] = decodeHtml(x[k]);
    }
  }
  return list;
}
function decodeHtml(v) {
  return String(v == null ? "" : v).replace(/&(nbsp|ensp|emsp|thinsp|#\d+);/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&mdash;/g, "\u2014").replace(/&ndash;/g, "\u2013").replace(/&middot;/g, "\xB7").replace(/&hellip;/g, "\u2026").replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").trim();
}
function kuwoPicUrl(pic) {
  if (!pic) return "";
  const p = String(pic);
  return /^https?:/.test(p) ? p : `https://img4.kuwo.cn/star/albumcover/${p.replace(/^\d+\//, "300/")}`;
}
async function tencentAlbumSearch(kw) {
  for (const st of [8, 2]) {
    try {
      const { data } = await fetchJSON("https://u.y.qq.com/cgi-bin/musicu.fcg", {
        method: "POST",
        headers: { Referer: "https://y.qq.com/", Origin: "https://y.qq.com", "Content-Type": "application/json" },
        body: JSON.stringify({ comm: { ct: 24, cv: 0, v: 124 }, req_: {
          module: "music.search.SearchCgiService",
          method: "DoSearchForQQMusicDesktop",
          param: { query: kw, search_type: st, num_per_page: 20, page_num: 1, nocompress: 1 }
        } })
      }, 9e3);
      const d = data && data.req_ && data.req_.data;
      const list = d && d.body && d.body.album && d.body.album.list || [];
      if (Array.isArray(list) && list.length) {
        return list.map((a) => ({
          source: "tencent",
          id: String(a.albumMID || a.album_mid || a.mid || ""),
          name: decodeHtml(a.albumName || a.name || a.album_name || ""),
          artist: decodeHtml(a.singerName || a.singer_name || a.singer && a.singer.name || ""),
          pic: a.albumPic || a.pic || (a.albumMID ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${a.albumMID}.jpg` : ""),
          count: Number(a.songcount || a.song_count || 0) || void 0,
          publish: a.publishTime || a.publish_date || ""
        })).filter((x) => x.id && x.name);
      }
    } catch (_) {
    }
  }
  return [];
}
const MIGU_APP_H = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  Referer: "https://music.migu.cn/",
  channel: "0148957",
  OSType: "Android"
};
const SW_KEY = { album: "albumResultData", songlist: "songListResultData", song: "songResultData" };
async function miguSearchAll(text, switchKey) {
  const sw = encodeURIComponent(JSON.stringify({ [switchKey]: 1 }));
  const { data } = await fetchJSON(
    `https://c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?isCopyright=1&isPublished=1&searchSwitch=${sw}&pageSize=20&pageNo=1&text=${encodeURIComponent(text)}`,
    { headers: MIGU_APP_H },
    1e4
  );
  if (!data || data.code !== "000000") return [];
  const top = data[SW_KEY[switchKey]] || {};
  return Array.isArray(top.result) ? top.result : [];
}
const miguAlbumNames = new Map();
const miguPlaylistNames = new Map();
const albumSearchers = {
  async netease(kw) {
    const hd = { Referer: "https://music.163.com", Cookie: "os=pc", "Content-Type": "application/x-www-form-urlencoded" };
    const q = encodeURIComponent(kw);
    const forms = [
      () => fetchJSON("https://music.163.com/api/cloudsearch/pc", { method: "POST", headers: hd, body: `s=${q}&type=10&offset=0&limit=20&total=true` }, 8e3).then((r) => {
        const d = r && r.data && r.data.result || r && r.result || {};
        return d.albums || d.list || [];
      }),
      () => fetchJSON("https://music.163.com/api/search/get/web", { method: "POST", headers: hd, body: `s=${q}&type=10&offset=0&limit=20` }, 8e3).then((r) => {
        const d = r && r.data && r.data.result || r && r.result || {};
        return d.albums || [];
      })
    ];
    for (const f of forms) {
      try {
        const list = await f();
        if (Array.isArray(list) && list.length) {
          return list.map((a) => ({
            source: "netease",
            id: String(a.id),
            name: decodeHtml(a.name || ""),
            artist: decodeHtml(a.artist && a.artist.name || (a.artists || []).map((x) => x.name).join(" / ") || ""),
            pic: a.picUrl ? `${a.picUrl}${a.picUrl.includes("?") ? "&" : "?"}param=300y300` : "",
            count: Number(a.size) || void 0,
            publish: String(a.pubDate || a.publishTime || "").slice(0, 10)
          })).filter((x) => x.id && x.name);
        }
      } catch (_) {
      }
    }
    return [];
  },
  async tencent(kw) {
    const real = await tencentAlbumSearch(kw).catch(() => []);
    if (real.length) return real;
    const songs = await tencent.search(kw, 1).catch(() => []);
    const seen = new Map();
    for (const t of songs) {
      const mid = t.extra && t.extra.albummid || (t.pic || "").match(/M000([A-Za-z0-9]+)\.jpg/)?.[1];
      const name = decodeHtml(t.album || "");
      if (!name) continue;
      const key = (mid || name).toLowerCase();
      if (!seen.has(key)) seen.set(key, { source: "tencent", id: mid || name, name, artist: decodeHtml(t.artist || ""), pic: t.pic || "", count: void 0, publish: "" });
    }
    return [...seen.values()].slice(0, 20);
  },
  async kugou(kw) {
    const { data } = await fetchJSON(`http://mobilecdn.kugou.com/api/v3/search/album?keyword=${encodeURIComponent(kw)}&format=json&page=1&pagesize=12`, {}, 1e4);
    const list = data && data.data && data.data.info;
    if (!Array.isArray(list)) return [];
    return list.map((a) => ({
      source: "kugou",
      id: String(a.albumid),
      name: a.albumname || "",
      artist: a.singername || "",
      pic: a.imgurl ? String(a.imgurl).replace("{size}", "240") : "",
      count: a.songcount || 0,
      publish: String(a.publishtime || "").slice(0, 10)
    }));
  },
  async kuwo(kw) {
    const r = await fetchText(`http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}&ft=album&itemset=web_2013&client=kt&pn=0&rn=12&rformat=json&encoding=utf8`, {}, 1e4);
    const d = parseKuwoLiteral(r.text);
    const list = d && d.albumlist;
    if (!Array.isArray(list)) return [];
    return list.map((a) => {
      const id = String(a.albumid || a.id || a.DC_TARGETID);
      kuwoAlbumNames.set(id, a.name || "");
      return {
        source: "kuwo",
        id,
        name: a.name || "",
        artist: String(a.artist || a.aartist || "").replace(/&nbsp;/g, " "),
        pic: kuwoPicUrl(a.pic),
        count: a.songnum || 0,
        publish: a.pub || ""
      };
    });
  },
  async migu(kw) {
    const list = await miguSearchAll(kw, "album").catch(() => []);
    return list.map((a) => {
      const imgs = Array.isArray(a.imgItems) ? a.imgItems : [];
      const pic = (imgs.find((i) => i.imgSizeType === "03") || imgs[0] || {}).img || "";
      miguAlbumNames.set(String(a.id), a.name || "");
      return {
        source: "migu",
        id: String(a.id),
        name: a.name || "",
        artist: a.singer || "",
        pic: pic || "",
        count: Number(a.songNum || 0) || void 0,
        publish: a.publishDate || ""
      };
    }).filter((x) => x.id && x.name);
  }
};
const albumDetails = {
  async netease(id) {
    const { data } = await fetchJSON(
      `https://music.163.com/api/album/${encodeURIComponent(id)}`,
      { headers: { Referer: "https://music.163.com", Cookie: "os=pc" } },
      1e4
    );
    const a = data && data.album;
    if (!a) return null;
    return {
      name: a.name || "",
      artist: (a.artists || []).map((x) => x.name).join(" / "),
      pic: a.picUrl || "",
      publish: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : "",
      tracks: (a.songs || []).map((t) => ({
        source: "netease",
        id: String(t.id),
        name: t.name,
        artist: (t.ar || t.artists || []).map((x) => x.name).join(" / "),
        album: a.name || "",
        pic: t.al && t.al.picUrl || a.picUrl || "",
        extra: {}
      }))
    };
  },
  async tencent(id) {
    const { data } = await fetchJSON(
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(id)}&format=json`,
      { headers: { Referer: "https://y.qq.com/" } },
      1e4
    );
    const d = data && data.data;
    if (!d) return null;
    return {
      name: d.name || d.albumname || "",
      artist: (d.singername || d.singer || "").toString(),
      pic: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg`,
      publish: d.aDate || "",
      tracks: (d.list || []).map((t) => ({
        source: "tencent",
        id: t.songmid,
        name: t.songname,
        artist: (t.singer || []).map((s) => s.name).join(" / "),
        album: d.name || "",
        pic: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg`,
        extra: {}
      }))
    };
  },
  async kugou(id) {
    const info = await fetchJSON(`http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(id)}`, {}, 1e4);
    const inf = info.data && info.data.data;
    const songs = await fetchJSON(`http://mobilecdn.kugou.com/api/v3/album/song?albumid=${encodeURIComponent(id)}&page=1&pagesize=100`, {}, 1e4);
    const list = songs.data && songs.data.data && songs.data.data.info;
    if (!inf && !Array.isArray(list)) return null;
    const pic = inf && inf.imgurl ? String(inf.imgurl).replace("{size}", "240") : "";
    return {
      name: inf && inf.albumname || "",
      artist: inf && inf.singername || "",
      pic,
      publish: inf && inf.publish_time ? String(inf.publish_time).slice(0, 10) : "",
      tracks: (Array.isArray(list) ? list : []).map((t) => {
        const h = (t.hash || "").toLowerCase();
        return {
          source: "kugou",
          id: h,
          name: t.songname || t.filename || "",
          artist: t.singername || "",
          album: inf && inf.albumname || "",
          pic: h ? `https://imge.kugou.com/stdmusic/240/${h}.jpg` : pic,
          extra: { sq: t.sqhash && t.sqprivilege === 0 ? String(t.sqhash).toLowerCase() : null, hq: t.hqhash && t.hqprivilege === 0 ? String(t.hqhash).toLowerCase() : null }
        };
      })
    };
  },
  async kuwo(id, meta) {
    const name = meta && meta.name || kuwoAlbumNames.get(String(id));
    if (!name) return null;
    const rs = await kuwo.search(name, 1).catch(() => []);
    const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
    const tracks2 = rs.filter((t) => norm(t.album) === norm(name) || norm(t.name).includes(norm(name)));
    if (!tracks2.length) return null;
    return {
      name,
      artist: tracks2[0].artist.split(" / ")[0] || "",
      pic: tracks2[0].pic || "",
      publish: "",
      tracks: tracks2.map((t) => Object.assign({}, t, { album: name }))
    };
  },
  async migu(id) {
    const name = miguAlbumNames.get(String(id)) || "";
    if (!name) return null;
    const rs = await SOURCES.migu.search(name, 1).catch(() => []);
    const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
    const key = norm(name);
    let tracks2 = rs.filter((t) => norm(t.album).includes(key) || norm(t.name).includes(key));
    if (!tracks2.length) tracks2 = rs.slice(0, 50);
    if (!tracks2.length) return null;
    return {
      name,
      artist: tracks2[0].artist.split(" / ")[0] || "",
      pic: tracks2[0].pic || "",
      publish: "",
      tracks: tracks2.map((t) => Object.assign({}, t, { album: name }))
    };
  }
};
const kuwoAlbumNames = new Map();
const kuwoPlaylistNames = new Map();
function capability() {
  return {
    song: ["netease", "tencent", "kugou", "kuwo", "migu"],
    album: ["netease", "tencent", "kugou", "kuwo", "migu"],
    playlist: ["netease", "kugou", "tencent", "kuwo", "migu"],
    detail: { album: Object.keys(albumDetails), playlist: ["netease", "tencent", "kugou", "kuwo", "migu"] },
    import: ["netease", "tencent", "kugou"]
  };
}
async function albumDetail(source, id, meta) {
  const fn = albumDetails[source];
  if (!fn) {
    const e = new Error("\u8BE5\u5E73\u53F0\u6682\u65E0\u4E13\u8F91\u66F2\u76EE\u63A5\u53E3");
    e.code = 404;
    throw e;
  }
  return fn(id, meta || {});
}
const lxEngine = require("./lxweb-engine");
let LX_ENGINES = [];
let lxReady = null;
function lxEnginesReady() {
  return lxReady;
}
function waitLxEngines(ms = 8e3) {
  if (!lxReady) return Promise.resolve();
  return Promise.race([lxReady, new Promise((r) => setTimeout(r, ms))]);
}
function loadLxEngines() {
  LX_ENGINES = lxEngine.loadDir(path.join(APP_ROOT, "sources"), (m) => console.log("[lx]", m));
  lxReady = lxEngine.initEngines(LX_ENGINES).then((es) => {
    for (const e of es) console.log(`[lx] ${e.file} -> ${e.ok ? "\u5C31\u7EEA: " + Object.keys(e.sources || {}).join(",") : "\u5931\u8D25: " + e.error}`);
    return es;
  }).catch(() => []);
}
loadLxEngines();
const LX_KEY = { netease: "wy", tencent: "tx", kugou: "kg", kuwo: "kw", migu: "mg" };
const LX_BR = { flac24bit: 2419, master: 2419, atmos_plus: 2419, hires: 1536, atmos: 1536, flac: 999, "320k": 320, "128k": 128 };
const lxCache = new Map();
const lxFail = new Map();
async function lxSongSearch(source, kw, limit = 20) {
  const key = LX_KEY[source];
  if (!key) return [];
  await waitLxEngines();
  const engines = LX_ENGINES.filter((e) => e.ok && e.state && typeof e.state.handler === "function" && (!e.sources || !Object.keys(e.sources).length || e.sources[key]));
  if (!engines.length) return [];
  let out = [];
  for (const e of engines) {
    try {
      const { items } = await Promise.race([
        lxEngine.resolveSearch(e, key, kw, limit, 9e3),
        new Promise((_, rej) => setTimeout(() => rej(new Error("lx-search-timeout")), 9e3))
      ]);
      if (!items || !items.length) continue;
      const tracks2 = items.slice(0, limit).map((x) => normLxTrack(x, source)).filter(Boolean);
      if (tracks2.length) {
        out = tracks2;
        break;
      }
    } catch (_) {
    }
  }
  return out;
}
function normLxTrack(x, source) {
  if (!x || typeof x !== "object") return null;
  const meta = x.meta || {};
  const id = String(x.id || meta.kw && meta.kw.id || meta.mg && meta.mg.id || meta.wy && meta.wy.id || meta.tx && meta.tx.id || meta.kg && meta.kg.id || "");
  const name = x.name || x.song || x.title || "";
  if (!id || !name) return null;
  return {
    source: LX_SRC_MAP[x.source || source] || source,
    id,
    name: String(name),
    artist: x.singer || x.artist || meta.singer || "",
    album: x.albumName || x.album || "",
    duration: normDuration(x.interval || x.duration || x.time || 0),
    pic: x.pic || meta.picture || meta.pic || "",
    extra: {
      songmid: x.songmid || id,
      hash: x.hash || "",
      songId: x.songId || "",
      copyrightId: x.copyrightId || "",
      strMediaMid: x.strMediaMid || "",
      albumMid: x.albumMid || "",
      albumId: x.albumId || "",
      types: Array.isArray(x.types) ? x.types : [],
      name: String(name),
      singer: x.singer || x.artist || meta.singer || ""
    }
  };
}
async function validateLxUrl(url) {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-2048", "User-Agent": UA }, signal: AbortSignal.timeout(8e3) });
    if (r.body && r.body.cancel) {
      try {
        r.body.cancel();
      } catch (_) {
      }
    }
    if (r.status < 200 || r.status >= 400) return false;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct) return r.status === 206;
    return /audio|video|octet-stream|mp3|flac|mpeg|m4a|ogg|wav/.test(ct);
  } catch (_) {
    return false;
  }
}
async function tryLx(source, lxTypes, id, extra, engineHint, diag) {
  const key = LX_KEY[source];
  if (!key || !lxTypes || !lxTypes.length) return null;
  const cacheKey = `${source}:${id}:${lxTypes[0]}:${engineHint || ""}`;
  const hit = lxCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 6e5) return hit.r;
  const failRec = lxFail.get(cacheKey);
  const failTs = typeof failRec === "number" ? failRec : failRec && failRec.ts;
  if (failTs && Date.now() - failTs < 3e4) {
    if (diag && failRec && failRec.attempts) diag.attempts = failRec.attempts;
    return null;
  }
  const prio = CFG.lxPriority && CFG.lxPriority[key] || [];
  let ordered = [...LX_ENGINES.filter((e) => prio.includes(e.file)), ...LX_ENGINES.filter((e) => !prio.includes(e.file))];
  const latCached = latencyCache.get(source);
  if (!engineHint && latCached && Date.now() - latCached.ts < LAT_TTL * 3) {
    const lat = latCached.data;
    const rank = (e) => {
      if (!(e.file in lat)) return 9e8;
      const v = lat[e.file];
      if (v == null) return 9e9;
      return v < 60 ? v + 4e3 : v;
    };
    ordered = [...ordered].sort((a, b) => rank(a) - rank(b));
  }
  if (engineHint) {
    const h = ordered.find((e) => e.file === engineHint);
    if (h) ordered = [h, ...ordered.filter((e) => e !== h)];
  }
  const active = ordered.filter((e) => e.ok && e.sources && e.sources[key]);
  if (!active.length) {
    const attempts2 = ["\u6240\u6709\u97F3\u6E90\u5F15\u64CE\u5747\u672A\u5C31\u7EEA\u6216\u4E0D\u652F\u6301\u8BE5\u5E73\u53F0"];
    if (diag) diag.attempts = attempts2;
    lxFail.set(cacheKey, { ts: Date.now(), attempts: attempts2 });
    return null;
  }
  const attempt = async (e) => {
    const ex = extra || {};
    const musicInfo = {
      source: key,
      interval: 0,
      songmid: ex.songmid || id,
      hash: ex.hash || id,
      id: ex.songId || ex.songmid || id,
      songId: ex.songId || ex.songmid || id,
      rid: ex.songId || ex.songmid || id,
      copyrightId: ex.copyrightId || "",
      strMediaMid: ex.strMediaMid || "",
      albumMid: ex.albumMid || "",
      albumId: ex.albumId || "",
      types: Array.isArray(ex.types) ? ex.types : [],
      name: ex.name || "",
      singer: ex.singer || ""
    };
    const r = await Promise.race([
      lxEngine.resolveMusicUrl(e, key, lxTypes, musicInfo),
      new Promise((_, rej) => setTimeout(() => rej(new Error("\u5F15\u64CE\u8D85\u65F6")), 12e3))
    ]);
    const br = LX_BR[r.type] || 999;
    if (!await validateLxUrl(r.url)) throw new Error("\u94FE\u63A5\u4E0D\u53EF\u8FBE");
    return { ok: true, url: r.url, br, size: 0, quality: Q_LABEL[r.type] || brLabel(br), requested: lxTypes[0], from: "lx:" + e.file };
  };
  const logFail = (e) => (err) => {
    const msg = `${e.file}: ${String(err.message || err).slice(0, 120)}`;
    if (diag) {
      (diag.attempts || (diag.attempts = [])).push(msg);
    }
    throw err;
  };
  let out = null;
  const wave1 = active.filter((e) => ordered.indexOf(e) < 4).slice(0, 4);
  const rest = active.filter((e) => ordered.indexOf(e) >= 4);
  const p1 = wave1.map((e) => attempt(e).catch(logFail(e)));
  if (p1.length) {
    out = await Promise.race([
      Promise.any(p1),
      new Promise((r) => setTimeout(() => r(null), 2500))
    ]).catch(() => null);
  }
  if (!out && rest.length) {
    out = await Promise.any([...p1, ...rest.map((e) => attempt(e).catch(logFail(e)))]).catch(() => null);
  }
  if (out) {
    lxCache.set(cacheKey, { ts: Date.now(), r: out });
    return out;
  }
  const attempts = diag && diag.attempts || [];
  lxFail.set(cacheKey, { ts: Date.now(), attempts });
  return null;
}
const latencyCache = new Map();
const LAT_TTL = 12e4, LAT_TIMEOUT = 4e3;
const PROBE_POOL = {
  netease: [["5257138", "\u5C4B\u9876", "\u5468\u6770\u4F26"], ["1368754688", "\u7231\u4EBA\u9519\u8FC7", "\u544A\u4E94\u4EBA"], ["186016", "\u6674\u5929", "\u5468\u6770\u4F26"], ["2652820720", "\u6674\u5929(\u6DF1\u60C5\u7248)", "Lucky\u5C0F\u7231"]],
  tencent: [["0039MnYb0qxYhV", "\u6674\u5929", "\u5468\u6770\u4F26"], ["001Ft4SC26tJab", "\u7A3B\u9999", "\u5468\u6770\u4F26"], ["004Z3AIs05DZ5E", "\u4E03\u91CC\u9999", "\u5468\u6770\u4F26"], ["002aWr0L4mZtw9", "\u8BF4\u597D\u7684\u5E78\u798F\u5462", "\u5468\u6770\u4F26"]],
  kugou: [["b3a52a7a958bf0aed0ebfba2e9a818b7", "\u6674\u5929", "\u5468\u6770\u4F26"], ["48c685f679ffc7cf08b8a8341ca9db44", "\u6674\u5929", "\u84DD\u5FC3\u7FBD"], ["dbc0207490eb51153ef933ef5a7e98e4", "\u4EE5\u7236\u4E4B\u540D", "\u5468\u6770\u4F26"], ["4a85b4f2b2f66a4f13a41de1c1b0f2c2", "\u7A3B\u9999", "\u5468\u6770\u4F26"]],
  kuwo: [["643991494", "test", "Lenis"], ["27688664", "\u7A3B\u9999", "\u5468\u6770\u4F26"], ["598794922", "\u4EE5\u7236\u4E4B\u540D", "\u5468\u6770\u4F26"], ["12339024", "\u6674\u5929", "\u5468\u6770\u4F26"]],
  migu: [["60054701923", "\u6674\u5929", "\u5468\u6770\u4F26"], ["179472186", "\u7A3B\u9999", "\u5468\u6770\u4F26"], ["267738188", "\u9752\u82B1\u74F7", "\u5468\u6770\u4F26"], ["344537888", "\u4E03\u91CC\u9999", "\u5468\u6770\u4F26"]]
};
async function probeLatency(source, force) {
  await waitLxEngines(9e3);
  const key = LX_KEY[source];
  if (!key) return {};
  if (!force) {
    const hit = latencyCache.get(source);
    if (hit && Date.now() - hit.ts < LAT_TTL) return hit.data;
  }
  const cand = LX_ENGINES.filter((e) => e.ok && e.sources && e.sources[key]);
  const pool = PROBE_POOL[source] || [["", "", ""]];
  const rows = await Promise.all(cand.map(async (e) => {
    const [id, name, singer] = pool[Math.floor(Math.random() * pool.length)];
    const t0 = Date.now();
    try {
      const r = await Promise.race([
        lxEngine.resolveMusicUrl(e, key, ["128k"], { songmid: id, hash: id, id, copyrightId: id, name, singer, source: key }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("t")), LAT_TIMEOUT))
      ]);
      return { file: e.file, ms: r && r.url && /^https?:/i.test(r.url) ? Date.now() - t0 : null };
    } catch (_) {
      return { file: e.file, ms: null };
    }
  }));
  const data = {};
  rows.forEach((r) => {
    data[r.file] = r.ms;
  });
  latencyCache.set(source, { ts: Date.now(), data });
  return data;
}
async function resolveUrl(source, id, quality, extra, engineHint) {
  const adapter = SOURCES[source];
  await waitLxEngines(3e3);
  if (!adapter) return { ok: false, reason: "\u672A\u77E5\u97F3\u6E90" };
  const start = TIER_ORDER.includes(quality) ? quality : "lossless";
  const tiers = TIER_ORDER.slice(TIER_ORDER.indexOf(start));
  const triedLx = new Set(), triedGd = new Set();
  const failNotes = [];
  const BUDGET = 9e4;
  const t0 = Date.now();
  for (const tier of tiers) {
    if (Date.now() - t0 > BUDGET) break;
    const c = CHAINS[tier];
    const lxTypes = c.lx.filter((t) => !triedLx.has(t));
    lxTypes.forEach((t) => triedLx.add(t));
    if (lxTypes.length) {
      const diag = {};
      const lx = await tryLx(source, lxTypes, id, extra, engineHint, diag).catch(() => null);
      if (lx) return Object.assign(lx, { url: wrapStreamUrl(lx.url, source), tier, downgraded: tier !== start });
      if (diag.attempts && diag.attempts.length) failNotes.push(...diag.attempts.slice(0, 4));
    }
    for (const br of c.gd) {
      if (triedGd.has(br)) continue;
      triedGd.add(br);
      try {
        const r = await adapter.url(id, br, quality, extra);
        if (r && r.url) return { ok: true, url: wrapStreamUrl(r.url, source), br: r.br, size: r.size, quality: brLabel(r.br), tier, requested: brLabel(br), downgraded: tier !== start };
      } catch (_) {
      }
    }
  }
  const reason = failNotes.length ? `\u8BE5\u6E90\u5168\u6863\u4F4D\u5747\u65E0\u53EF\u7528\u64AD\u653E\u94FE\u63A5\uFF08${failNotes.slice(0, 5).join("\uFF1B")}\uFF09` : "\u8BE5\u6E90\u5168\u6863\u4F4D\u5747\u65E0\u53EF\u7528\u64AD\u653E\u94FE\u63A5";
  return { ok: false, reason, attempts: failNotes.slice(0, 10) };
}
async function altSource(name, singer, exclude, strict) {
  const kw = [name, singer].filter(Boolean).join(" ").trim();
  if (!kw) return { ok: false };
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s()（）\[\]【】·、,，.'’-]/g, "");
  const key = norm(name);
  const ar = norm(singer);
  const artistOk = (t) => !ar || norm(t.artist).includes(ar) || ar.includes(norm(t.artist));
  for (const s of ["netease", "tencent", "kugou", "kuwo", "migu"]) {
    if (s === exclude) continue;
    const list = await SOURCES[s].search(kw, 1).catch(() => []);
    let candidates = list.filter((t) => norm(t.name) === key && artistOk(t));
    if (!candidates.length && strict !== "1") candidates = list.filter((t) => norm(t.name).startsWith(key) && artistOk(t));
    candidates = candidates.slice(0, 3);
    for (const t of candidates) {
      const r = await resolveUrl(s, t.id, "lossless", Object.assign({}, t.extra, { name: t.name, singer: t.artist })).catch(() => null);
      if (r && r.ok) return { ok: true, track: t, url: r.url, br: r.br, quality: r.quality, from: r.from };
    }
  }
  return { ok: false };
}
function normLrcKey(s) {
  return String(s || "").toLowerCase().replace(/[\s()（）\[\]【】·、,，.'’-]/g, "");
}
async function tryLxLyric(source, extra, id) {
  const key = LX_KEY[source];
  if (!key) return null;
  await waitLxEngines(3e3);
  const engines = LX_ENGINES.filter((e) => e.ok && e.state && typeof e.state.handler === "function" && (!e.sources || !Object.keys(e.sources).length || e.sources[key]));
  if (!engines.length) return null;
  const ex = extra || {};
  const musicInfo = {
    source: key,
    interval: 0,
    songmid: ex.songmid || id,
    hash: ex.hash || id,
    id: ex.songId || ex.songmid || id,
    songId: ex.songId || ex.songmid || id,
    rid: ex.songId || ex.songmid || id,
    copyrightId: ex.copyrightId || "",
    strMediaMid: ex.strMediaMid || "",
    albumId: ex.albumId || "",
    types: Array.isArray(ex.types) ? ex.types : [],
    name: ex.name || "",
    singer: ex.singer || ""
  };
  for (const e of engines.slice(0, 6)) {
    try {
      const lrc = await Promise.race([
        lxEngine.resolveLyric(e, key, musicInfo),
        new Promise((_, rej) => setTimeout(() => rej(new Error("lyric-timeout")), 8e3))
      ]);
      if (typeof lrc === "string" && lrc.trim()) return lrc;
      if (lrc && typeof lrc === "object" && lrc.lyric && String(lrc.lyric).trim()) return String(lrc.lyric);
    } catch (_) {
    }
  }
  return null;
}
async function resolveLyricChain(source, id, extra) {
  try {
    const lrc = await tryLxLyric(source, extra, id);
    if (lrc) return lrc;
  } catch (_) {
  }
  try {
    const lrc = await SOURCES[source].lyric(id, extra);
    if (lrc && String(lrc).trim()) return lrc;
  } catch (_) {
  }
  const kw = [extra && extra.name, extra && extra.singer].filter(Boolean).join(" ").trim();
  if (!kw) return "";
  const nameKey = normLrcKey(extra && extra.name);
  for (const s of ["netease", "kuwo", "kugou", "tencent", "migu"]) {
    if (s === source) continue;
    try {
      const list = await SOURCES[s].search(kw, 1, 6).catch(() => []);
      if (!list.length) continue;
      const strict = list.filter((t) => normLrcKey(t.name) === nameKey).slice(0, 2);
      const cands = [...strict, ...list.slice(0, 1)].slice(0, 3);
      for (const t of cands) {
        try {
          const lrc = await SOURCES[s].lyric(t.id, Object.assign({}, t.extra, { name: t.name, singer: t.artist }));
          if (lrc && String(lrc).trim()) return lrc;
        } catch (_) {
        }
      }
    } catch (_) {
    }
  }
  return "";
}
async function neteasePlaylistDetail(id) {
  const HD = { Referer: "https://music.163.com", Cookie: "os=pc", "Content-Type": "application/x-www-form-urlencoded" };
  let pl = null;
  const hits = [
    () => fetchJSON("https://music.163.com/api/v6/playlist/detail", { method: "POST", headers: HD, body: `id=${id}&n=1000` }, 8e3),
    () => fetchJSON(`https://music.163.com/api/playlist/detail?id=${id}&n=1000`, { method: "POST", headers: HD, body: `id=${id}&n=1000` }, 7e3),
    () => fetchJSON("https://music.163.com/api/v3/playlist/detail", { method: "POST", headers: HD, body: `id=${id}&n=1000&t=0` }, 7e3)
  ];
  for (const h of hits) {
    try {
      const { data } = await h();
      const p = data && (data.playlist || data.r && data.r.playlist);
      if (p && (p.name || p.tracks || p.trackIds)) {
        pl = p;
        break;
      }
    } catch (_) {
    }
  }
  if (!pl) return null;
  let raw = Array.isArray(pl.tracks) && pl.tracks.length ? pl.tracks : [];
  const have = new Set(raw.map((t) => Number(t.id)));
  if (Array.isArray(pl.trackIds) && pl.trackIds.length > raw.length) {
    const ids = pl.trackIds.map((t) => typeof t === "number" ? t : t && t.id).filter((x) => x && !have.has(Number(x)));
    for (let i = 0; i < ids.length && i < 1e3; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const { data } = await fetchJSON("https://music.163.com/api/v3/song/detail", {
          method: "POST",
          headers: HD,
          body: `c=${encodeURIComponent(JSON.stringify(chunk.map((x) => ({ id: x }))))}&id=${chunk[0]}`
        }, 7e3);
        const arr = data && (data.songs || data.list);
        if (Array.isArray(arr)) raw = raw.concat(arr);
      } catch (_) {
        break;
      }
    }
  }
  const tracks2 = raw.map((t) => ({
    source: "netease",
    id: String(t.songId || t.id),
    name: t.name || t.songName || "",
    artist: (t.ar || t.artists || (t.singer ? Array.isArray(t.singer) ? t.singer : [t.singer] : [])).map((a) => a.name || a).join(" / "),
    album: t.al && (t.al.name || t.al.title) || t.album && (t.album.name || t.album.title) || "",
    pic: t.al && t.al.picUrl || t.album && t.album.picUrl || (t.id ? `https://p3.music.126.net/${neteaseEncryptId(t.id)}/${t.id}.jpg?param=300y300` : ""),
    extra: {}
  })).filter((t) => t.id && t.name);
  return { name: pl.name || "", cover: pl.coverImgUrl || pl.coverUrl || "", count: pl.trackCount || tracks2.length, tracks: tracks2 };
}
const playlistSearchers = {
  async netease(kw) {
    const hd = { Referer: "https://music.163.com", Cookie: "os=pc", "Content-Type": "application/x-www-form-urlencoded" };
    const q = encodeURIComponent(kw);
    const forms = [
      () => fetchJSON("https://music.163.com/api/cloudsearch/pc", { method: "POST", headers: hd, body: `s=${q}&type=1000&offset=0&limit=20&total=true` }, 8e3).then((r) => {
        const d = r && r.data && r.data.result || r && r.result || {};
        return d.playlists || d.list || [];
      }),
      () => fetchJSON("https://music.163.com/api/search/get/web", { method: "POST", headers: hd, body: `s=${q}&type=1000&offset=0&limit=20` }, 8e3).then((r) => {
        const d = r && r.data && r.data.result || r && r.result || {};
        return d.playlists || [];
      })
    ];
    for (const f of forms) {
      try {
        const list = await f();
        if (Array.isArray(list) && list.length) {
          return list.map((p) => ({
            source: "netease",
            id: String(p.id),
            name: decodeHtml(p.name || ""),
            artist: decodeHtml(p.creator && (p.creator.nickname || p.creator.nickName) || p.author || ""),
            pic: p.coverImgUrl ? `${p.coverImgUrl}${p.coverImgUrl.includes("?") ? "&" : "?"}param=300y300` : p.imgurl ? String(p.imgurl).replace("{size}", "300") : "",
            count: Number(p.trackCount || p.total || 0) || void 0,
            play: Number(p.playCount || 0) || void 0
          })).filter((x) => x.id && x.name);
        }
      } catch (_) {
      }
    }
    return [];
  },
  async kugou(kw) {
    const { data } = await fetchJSON(`http://mobilecdn.kugou.com/api/v3/search/special?keyword=${encodeURIComponent(kw)}&format=json&page=1&pagesize=12`, {}, 1e4);
    const list = data && data.data && data.data.info;
    if (!Array.isArray(list)) return [];
    return list.map((p) => ({
      source: "kugou",
      id: String(p.specialid),
      name: p.specialname || "",
      artist: p.nickname || "",
      pic: p.imgurl ? String(p.imgurl).replace("{size}", "240") : "",
      count: p.songcount || 0,
      play: p.playcount || 0
    }));
  },
  async tencent(kw) {
    const q = encodeURIComponent(kw);
    const url = `https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist&flag_qc=0&page_no=1&num_per_page=20&query=${q}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf8&notice=0&platform=yqq.json&needNewCode=0`;
    const { data } = await fetchJSON(url, { headers: { Referer: "https://y.qq.com/" } }, 9e3);
    const list = data && data.data && data.data.list || [];
    if (!Array.isArray(list) || !list.length) return [];
    return list.map((p) => {
      const dirid = String(p.dissid || p.base && p.base.dirid || "");
      const img = p.imgurl || p.picture && (p.picture.large || p.picture.common) || "";
      return {
        source: "tencent",
        id: dirid,
        name: decodeHtml(p.dissname || p.name || p.base && p.base.title || ""),
        artist: decodeHtml(p.creator ? p.creator.name || p.creator && p.creator.cbname || "" : p.naming || ""),
        pic: typeof img === "string" ? img.replace("{size}", "300") : "",
        count: Number(p.total || p.song_count || 0) || void 0,
        play: Number(p.visitnum || 0) || void 0
      };
    }).filter((x) => x.id && x.name);
  },
  async kuwo(kw) {
    const r = await fetchText(`http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}&ft=playlist&itemset=web_2013&client=kt&pn=0&rn=12&rformat=json&encoding=utf8`, {}, 1e4);
    const d = parseKuwoLiteral(r.text);
    const list = d && d.abslist;
    if (!Array.isArray(list)) return [];
    return list.map((a) => {
      const id = String(a.DC_TARGETID || a.playlistid || "");
      kuwoPlaylistNames.set(id, a.name || "");
      return {
        source: "kuwo",
        id,
        name: a.name || "",
        artist: a.nickname || "",
        pic: a.hts_pic || a.pic || "",
        count: Number(a.songnum || 0) || void 0,
        play: Number(a.playcnt || 0) || void 0
      };
    }).filter((x) => x.id && x.name);
  },
  async migu(kw) {
    const list = await miguSearchAll(kw, "songlist").catch(() => []);
    return list.map((p) => {
      miguPlaylistNames.set(String(p.id), p.name || "");
      return {
        source: "migu",
        id: String(p.id),
        name: p.name || "",
        artist: "",
        pic: p.musicListPicUrl || "",
        count: Number(p.musicNum || 0) || void 0,
        play: Number(p.playNum || 0) || void 0
      };
    }).filter((x) => x.id && x.name);
  }
};
async function playlistDetail(source, id) {
  if (source === "netease") return neteasePlaylistDetail(id);
  if (source === "tencent") return qqPlaylistDetail(id);
  if (source === "kuwo") return kuwoPlaylistDetail(id);
  if (source === "migu") return miguPlaylistDetail(id);
  if (source === "kugou") {
    const songs = await fetchJSON(`http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(id)}&page=1&pagesize=300`, {}, 12e3);
    const list = songs.data && songs.data.data && songs.data.data.info;
    if (!Array.isArray(list)) return null;
    const tracks2 = list.map((t) => {
      const h = (t.hash || "").toLowerCase();
      return {
        source: "kugou",
        id: h,
        name: t.songname || t.filename || "",
        artist: t.singername || "",
        album: t.remark || "",
        pic: h ? `https://imge.kugou.com/stdmusic/240/${h}.jpg` : "",
        extra: { sq: t.sqhash && t.sqprivilege === 0 ? String(t.sqhash).toLowerCase() : null }
      };
    });
    return { count: tracks2.length, tracks: tracks2 };
  }
  throw new Error("\u8BE5\u5E73\u53F0\u6682\u4E0D\u652F\u6301\u6B4C\u5355\u8BE6\u60C5");
}
async function kuwoPlaylistDetail(id) {
  const name = kuwoPlaylistNames.get(String(id)) || "";
  if (!name) return null;
  const rs = await SOURCES.kuwo.search(name, 1).catch(() => []);
  const tracks2 = rs.slice(0, 100);
  if (!tracks2.length) return null;
  return { name, cover: "", count: tracks2.length, tracks: tracks2 };
}
async function miguPlaylistDetail(id) {
  const name = miguPlaylistNames.get(String(id)) || "";
  if (!name) return null;
  const rs = await SOURCES.migu.search(name, 1).catch(() => []);
  const tracks2 = rs.slice(0, 100);
  if (!tracks2.length) return null;
  return { name, cover: "", count: tracks2.length, tracks: tracks2 };
}
async function playlistImport(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (_) {
    return { error: "\u94FE\u63A5\u683C\u5F0F\u4E0D\u6B63\u786E" };
  }
  const host = u.hostname;
  if (/163\.com$/.test(host)) {
    let id = u.searchParams.get("id");
    if (!id) {
      const m = u.pathname.match(/playlist\/(\d+)/);
      if (m) id = m[1];
    }
    if (!id) return { error: "\u672A\u80FD\u4ECE\u94FE\u63A5\u4E2D\u89E3\u6790\u6B4C\u5355 ID" };
    const d = await neteasePlaylistDetail(id);
    if (!d) return { error: "\u7F51\u6613\u4E91\u6B4C\u5355\u83B7\u53D6\u5931\u8D25\uFF08\u53EF\u80FD\u9700\u8981\u767B\u5F55\u6216\u94FE\u63A5\u6709\u8BEF\uFF09" };
    return { name: d.name, cover: d.cover, source: "netease", tracks: d.tracks };
  }
  if (/y\.qq\.com$/.test(host)) {
    let id = u.searchParams.get("id");
    if (!id) {
      const m = u.pathname.match(/playlist\/(\w+)/);
      if (m) id = m[1];
    }
    if (!id) return { error: "\u672A\u80FD\u4ECE\u94FE\u63A5\u4E2D\u89E3\u6790\u6B4C\u5355 ID" };
    const d = await qqPlaylistDetail(id);
    if (!d) return { error: "QQ \u6B4C\u5355\u83B7\u53D6\u5931\u8D25\uFF08\u53EF\u80FD\u9700\u8981\u767B\u5F55\u6216\u94FE\u63A5\u6709\u8BEF\uFF09" };
    return { name: d.name, cover: d.cover, source: "tencent", tracks: d.tracks };
    return { name: cd.dissname, cover: cd.logo || cd.picurl, source: "tencent", tracks };
  }
  if (/kugou\.com$/.test(host)) {
    let id = u.searchParams.get("specialid") || u.searchParams.get("id");
    if (!id) {
      const m = u.pathname.match(/(?:special|plist)[^\d]*(\d+)/i);
      if (m) id = m[1];
    }
    if (!id) return { error: "\u672A\u80FD\u4ECE\u94FE\u63A5\u4E2D\u89E3\u6790\u6B4C\u5355 ID" };
    const tries = [
      `http://mobiles.kugou.com/plist/list?appid=1058&srcappid=2919&clientver=20000&clienttime=${Date.now()}&uuid=${crypto.randomBytes(8).toString("hex")}&specialid=${id}&pagesize=300&page=1`,
      `https://m3ws.kugou.com/plist/list?specialid=${id}&appid=1058&clientver=20000&page=1&pagesize=300`
    ];
    for (const ep of tries) {
      const { data } = await fetchJSON(ep, { headers: { Referer: "https://m.kugou.com/" } }, 1e4).catch(() => ({ data: null }));
      const info = data && data.info && data.info[0];
      if (data && data.status === 1 && info) {
        const tracks2 = (info.songs || info.musiclist || []).map((t) => ({
          source: "kugou",
          id: (t.hash || "").toLowerCase(),
          name: t.songname || t.filename || "",
          artist: t.singername || "",
          album: t.remark || "",
          pic: t.hash ? `https://imge.kugou.com/stdmusic/240/${String(t.hash).toLowerCase()}.jpg` : "",
          extra: {}
        }));
        return { name: info.specialname || "\u9177\u72D7\u6B4C\u5355", cover: (info.imgurl || "").replace("{size}", "240"), source: "kugou", tracks: tracks2 };
      }
    }
    return { error: "\u9177\u72D7\u6B4C\u5355\u63A5\u53E3\u6682\u4E0D\u53EF\u7528\uFF0C\u5EFA\u8BAE\u6539\u7528\u7F51\u6613\u4E91\u6216 QQ \u6B4C\u5355\u94FE\u63A5" };
  }
  return { error: "\u6682\u4E0D\u652F\u6301\u8BE5\u5E73\u53F0\u7684\u6B4C\u5355\u94FE\u63A5\uFF08\u652F\u6301 music.163.com / y.qq.com / kugou.com\uFF09" };
}
async function qqPlaylistDetail(id) {
  const { data } = await fetchJSON(
    `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(id)}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`,
    { headers: { Referer: "https://y.qq.com/" } },
    12e3
  );
  const cd2 = data && data.cdlist && data.cdlist[0];
  if (!cd2) return null;
  const tracks2 = (cd2.songlist || []).map((t) => ({
    source: "tencent",
    id: t.songmid || t.mid,
    name: decodeHtml(t.songname || t.title || ""),
    artist: (t.singer || []).map((x) => x.name || x).join(" / "),
    album: t.albumname || t.album && t.album.title || "",
    duration: normDuration(t.interval ?? (t.album && t.album.interval)),
    pic: t.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${t.albummid}.jpg` : "",
    extra: { pay: t.pay && t.pay.pay_play }
  })).filter((t) => t.id && t.name);
  return { name: decodeHtml(cd2.dissname || cd2.name || ""), cover: cd2.logo || cd2.pic_url || cd2.picurl || "", count: tracks2.length, tracks: tracks2 };
}
function wrapStreamUrl(url, source) {
  if (!url) return url;
  if (!/^https?:/i.test(url)) return url;
  return `/api/stream?u=${encodeURIComponent(url)}`;
}
const STREAM_REF = { "music.126.net": "https://music.163.com/", "qq.com": "https://y.qq.com/", "kuwo.cn": "https://www.kuwo.cn/", "kugou.com": "https://www.kugou.com/", "kgimg.com": "https://www.kugou.com/", "migu.cn": "https://music.migu.cn/" };
async function passThrough(req, res, u, refH) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, Referer: refH, Range: req.headers.range || "bytes=0-" }, redirect: "follow", signal: AbortSignal.timeout(2e4) });
    if (!r.ok && r.status !== 206) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      return res.end("upstream error");
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct && !/audio|video|octet-stream|mpegurl|mp2t|mp3|flac|m4a|ogg|wav/.test(ct)) {
      res.writeHead(415, { "Content-Type": "text/plain" });
      return res.end("not audio");
    }
    let mime = "audio/mpeg";
    const pth = u.pathname.toLowerCase();
    if (/\.flac$/.test(pth)) mime = "audio/flac";
    else if (/\.m4a$|\.mp4$|\.aac$/.test(pth)) mime = "audio/mp4";
    else if (/\.ogg$|\.opus$/.test(pth)) mime = "audio/ogg";
    else if (/\.wav$/.test(pth)) mime = "audio/wav";
    else if (/audio/i.test(ct)) mime = ct;
    const h = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    const cr = r.headers.get("content-range");
    if (cr) h["Content-Range"] = cr;
    const cl = r.headers.get("content-length");
    if (cl) h["Content-Length"] = cl;
    res.writeHead(r.status, h);
    if (!r.body) return res.end();
    const { Readable } = require("stream");
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("proxy error");
    } else try {
      res.end();
    } catch (_) {
    }
  }
}
const PIC_HOST_RE = /(\.music\.126\.net|\.gtimg\.cn|\.kugou\.com|\.kuwo\.cn|\.kgimg\.com|\.musicapp\.migu\.cn|\.migu\.cn|\.nf\.migu\.cn)$/;
const picCache = new Map();
async function picProxy(res, url) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return json(res, 400, { error: "bad url" });
  }
  if (!PIC_HOST_RE.test(u.hostname)) return json(res, 403, { error: "host not allowed" });
  if (picCache.has(url)) {
    const c = picCache.get(url);
    res.writeHead(200, { "Content-Type": c.type, "Cache-Control": "public, max-age=86400" });
    return res.end(c.buf);
  }
  const REF = { "music.126.net": "https://music.163.com/", "gtimg.cn": "https://y.qq.com/", "kugou.com": "https://www.kugou.com/", "kuwo.cn": "https://www.kuwo.cn/", "migu.cn": "https://music.migu.cn/" };
  const ref = Object.entries(REF).find(([h]) => u.hostname.endsWith(h));
  const hdr = { "User-Agent": UA, Referer: ref ? ref[1] : `https://${u.hostname}/`, Accept: "image/avif,image/webp,image/*,*/*;q=.8" };
  try {
    const r = await fetch(url, { headers: hdr, redirect: "follow", signal: AbortSignal.timeout(8e3) });
    if (!r.ok) {
      res.writeHead(302, { Location: url, "Cache-Control": "no-store" });
      return res.end();
    }
    const type = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    if (picCache.size > 500) picCache.clear();
    picCache.set(url, { buf, type });
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
    res.end(buf);
  } catch (_) {
    res.writeHead(302, { Location: url, "Cache-Control": "no-store" });
    res.end();
  }
}
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(res, file) {
  const fp = path.join(PUBLIC_DIR, file === "/" ? "index.html" : file);
  if (!fp.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
  fs.readFile(fp, (err, buf) => {
    if (err) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}
async function handle(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = u.pathname;
  try {
    if (p === "/api/search") {
      const kw = (u.searchParams.get("kw") || "").trim();
      const source = u.searchParams.get("source") || "all";
      const page = Math.max(1, parseInt(u.searchParams.get("page") || "1", 10));
      const type = u.searchParams.get("type") || "song";
      if (!kw) return json(res, 200, type === "album" ? { albums: [] } : { tracks: [] });
      if (type === "album") {
        const targets2 = source === "all" ? ["netease", "kugou", "tencent", "kuwo", "migu"] : [source];
        const results2 = await Promise.allSettled(targets2.map((s) => withDeadline(
          cachedSearch(`album|${s}|${kw}`, () => albumSearchers[s](kw)),
          6e3,
          []
        )));
        const lists2 = results2.map((r) => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
        const albums = [];
        const maxLen2 = Math.max(...lists2.map((l) => l.length), 0);
        for (let i = 0; i < maxLen2; i++) for (const l of lists2) if (l[i]) albums.push(l[i]);
        cleanText(albums);
        return json(res, 200, { albums });
      }
      if (type === "playlist") {
        const targets2 = source === "all" ? ["netease", "kugou", "tencent", "kuwo", "migu"] : [source];
        const results2 = await Promise.allSettled(targets2.map((s) => withDeadline(
          cachedSearch(`pl|${s}|${kw}`, () => playlistSearchers[s](kw)),
          6e3,
          []
        )));
        const lists2 = results2.map((r) => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
        const playlists = [];
        const maxLen2 = Math.max(...lists2.map((l) => l.length), 0);
        for (let i = 0; i < maxLen2; i++) for (const l of lists2) if (l[i]) playlists.push(l[i]);
        cleanText(playlists);
        return json(res, 200, { playlists });
      }
      const targets = source === "all" ? ["netease", "tencent", "kugou", "kuwo", "migu"] : [source];
      const budget = { netease: 7e3, tencent: 8e3, kugou: 6e3, kuwo: 6e3, migu: 6500 };
      const fill = u.searchParams.get("fill");
      const results = await Promise.allSettled(targets.map((s) => withDeadline(
        cachedSearch(`song|${s}|${kw}|${page}|${fill || "0"}`, () => SOURCES[s].search(kw, page, fill)),
        budget[s] || 6500,
        []
      )));
      const lists = results.map((r) => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
      if (lists.some((l) => !l.length)) {
        const fb = await Promise.allSettled(targets.map((s, i) => lists[i].length ? [] : withDeadline(
          cachedSearch(`lxsong|${s}|${kw}|${page}`, () => lxSongSearch(s, kw, 20)),
          9e3,
          []
        )));
        fb.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value && r.value.length) lists[i] = r.value;
        });
      }
      const merged = [];
      const maxLen = Math.max(...lists.map((l) => l.length), 0);
      for (let i = 0; i < maxLen; i++) for (const l of lists) if (l[i]) merged.push(l[i]);
      cleanText(merged);
      const perSource = {};
      targets.forEach((s, i) => {
        perSource[s] = lists[i].length;
      });
      return json(res, 200, { tracks: merged, perSource, page });
    }
    if (p === "/api/alt") {
      const name = (u.searchParams.get("name") || "").trim();
      const singer = (u.searchParams.get("singer") || "").trim();
      const exclude = u.searchParams.get("exclude") || "";
      if (!name) return json(res, 400, { ok: false });
      const r = await altSource(name, singer, exclude, u.searchParams.get("strict"));
      return json(res, 200, r);
    }
    if (p === "/api/playlist-detail") {
      const source = u.searchParams.get("source");
      const id = u.searchParams.get("id");
      if (!source || !id) return json(res, 400, { error: "\u7F3A\u5C11\u53C2\u6570" });
      try {
        const d = await playlistDetail(source, id);
        if (!d || !d.tracks || !d.tracks.length) return json(res, 200, { error: "\u8BE5\u6B4C\u5355\u8BE6\u60C5\u6682\u4E0D\u53EF\u7528" });
        return json(res, 200, d);
      } catch (e) {
        return json(res, 200, { error: e.message || "\u6B4C\u5355\u8BE6\u60C5\u83B7\u53D6\u5931\u8D25" });
      }
    }
    if (p === "/api/album") {
      const source = u.searchParams.get("source");
      const id = u.searchParams.get("id");
      if (!source || !id) return json(res, 400, { error: "\u7F3A\u5C11\u53C2\u6570" });
      try {
        const d = await albumDetail(source, id, { name: u.searchParams.get("name") || "", artist: u.searchParams.get("artist") || "" });
        if (!d) return json(res, 200, { error: "\u8BE5\u4E13\u8F91\u8BE6\u60C5\u6682\u4E0D\u53EF\u7528" });
        return json(res, 200, d);
      } catch (e) {
        return json(res, 200, { error: e.message || "\u4E13\u8F91\u8BE6\u60C5\u83B7\u53D6\u5931\u8D25" });
      }
    }
    if (p === "/api/url") {
      const source = u.searchParams.get("source");
      const id = u.searchParams.get("id");
      const quality = u.searchParams.get("quality") || "lossless";
      const engine = u.searchParams.get("engine") || "";
      let extra = {};
      try {
        extra = JSON.parse(u.searchParams.get("extra") || "{}");
      } catch (_) {
      }
      if (!source || !id) return json(res, 400, { ok: false, reason: "\u7F3A\u5C11\u53C2\u6570" });
      const r = await resolveUrl(source, id, quality, extra, engine);
      return json(res, 200, r);
    }
    if (p === "/api/lyric") {
      const source = u.searchParams.get("source");
      const id = u.searchParams.get("id");
      let extra = {};
      try {
        extra = JSON.parse(u.searchParams.get("extra") || "{}");
      } catch (_) {
      }
      if (!source || !id) return json(res, 400, { lrc: "" });
      let lrc = "";
      try {
        lrc = await resolveLyricChain(source, id, extra);
      } catch (_) {
      }
      return json(res, 200, { lrc: lrc || "" });
    }
    if (p === "/api/playlist") {
      const url = u.searchParams.get("url") || "";
      if (!url) return json(res, 400, { error: "\u7F3A\u5C11\u94FE\u63A5" });
      const r = await playlistImport(url);
      return json(res, r.error ? 200 : 200, r.error ? { error: r.error } : r);
    }
    if (p === "/api/pic") {
      return picProxy(res, u.searchParams.get("u") || "");
    }
    if (p === "/api/stream") {
      return streamProxy(req, res, u.searchParams.get("u") || "");
    }
    if (p === "/api/cache/drop") {
      const dropU = u.searchParams.get("u");
      if (!dropU) return json(res, 400, { error: "need u" });
      const removed = dropAudioCacheByU(dropU);
      return json(res, 200, { ok: true, removed });
    }
    if (p === "/api/lx/latency") {
      const source = u.searchParams.get("source") || "tencent";
      const key = LX_KEY[source];
      const lat = await probeLatency(source, u.searchParams.get("force") === "1");
      const rows = LX_ENGINES.filter((e) => e.ok && e.sources && key && e.sources[key]).map((e) => ({ file: e.file, name: e.meta && e.meta.name || e.file, ms: e.file in lat ? lat[e.file] : null }));
      rows.sort((a, b) => (a.ms == null ? 9e9 : a.ms) - (b.ms == null ? 9e9 : b.ms));
      return json(res, 200, { source, rows });
    }
    if (p === "/api/capability") return json(res, 200, capability());
    if (p === "/api/lx") {
      return json(res, 200, {
        engines: LX_ENGINES.map((e) => ({
          ok: e.ok,
          file: e.file,
          name: e.meta && e.meta.name || e.file,
          author: e.meta && e.meta.author,
          sources: e.ok ? Object.fromEntries(Object.entries(e.sources || {}).map(([k, v]) => [k, { name: v.name, qualitys: v.qualitys }])) : null,
          error: e.error || null
        }))
      });
    }
    if (p === "/api/lx/reload" && req.method === "POST") {
      loadLxEngines();
      return json(res, 200, { ok: true, message: "LX \u97F3\u6E90\u91CD\u8F7D\u4E2D\uFF0C\u51E0\u79D2\u540E /api/lx \u67E5\u770B\u72B6\u6001" });
    }
    if (p === "/healthz" || p === "/api/health") {
      return json(res, 200, { status: "ok", engines: LX_ENGINES.filter((e) => e.ok).length });
    }
    if (p === "/api/config") {
      return json(res, 200, { waline: CFG.waline && CFG.waline.serverURL || "" });
    }
    if (p === "/api/ne-cover") {
      const ids = (u.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter((x) => /^\d{1,20}$/.test(x)).slice(0, 60);
      if (!ids.length) return json(res, 200, {});
      const out = {};
      const miss = [];
      for (const id of ids) {
        const c = nePicCache.get(id);
        if (c && Date.now() - c.ts < 36e5) out[id] = c.url;
        else miss.push(id);
      }
      if (miss.length) {
        try {
          const body = `c=${encodeURIComponent(JSON.stringify(miss.map((i) => ({ id: +i }))))}&id=${miss[0]}`;
          const { data } = await fetchJSON("https://music.163.com/api/v3/song/detail", {
            method: "POST",
            headers: { Referer: "https://music.163.com", Cookie: "os=pc", "Content-Type": "application/x-www-form-urlencoded" },
            body
          }, 4500);
          for (const x of data && data.songs || []) {
            const al = x.al || x.album;
            const url = al && (al.picUrl || (al.pic_str || al.picId ? `https://p3.music.126.net/${neteaseEncryptId(al.pic_str || al.picId)}/${al.pic_str || al.picId}.jpg?param=300y300` : ""));
            if (url) {
              out[String(x.id)] = url;
              nePicCache.set(String(x.id), { ts: Date.now(), url });
            }
          }
        } catch (_) {
          for (const id of miss.slice(0, 8)) {
            try {
              const { data } = await fetchJSON(`https://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`, { headers: { Referer: "https://music.163.com", Cookie: "os=pc" } }, 2500);
              const al = data && data.songs && data.songs[0] && data.songs[0].album;
              const url = al && (al.picUrl || (al.id ? `https://p2.music.126.net/${neteaseEncryptId(al.picId || al.id)}/${al.picId || al.id}.jpg?param=300y300` : ""));
              if (url) {
                out[id] = url;
                nePicCache.set(id, { ts: Date.now(), url });
              }
            } catch (__) {
              break;
            }
          }
        }
      }
      return json(res, 200, out);
    }
    if (p === "/api/hitokoto") {
      try {
        const { data } = await fetchJSON("https://v1.hitokoto.cn/?c=i&c=k&c=h&c=j&max_length=40", {}, 6e3);
        if (data && data.hitokoto) return json(res, 200, { text: data.hitokoto, from: data.from_who || data.from || "", who: data.from || "" });
        throw new Error("empty");
      } catch (_) {
        const list = ["\u97F3\u4E50\u662F\u6211\u4EEC\u5171\u540C\u7684\u8BB0\u5FC6\u4E0E\u60C5\u611F", "\u4E00\u65E5\u4E0D\u89C1\uFF0C\u5982\u4E09\u79CB\u516E", "\u6B64\u66F2\u53EA\u5E94\u5929\u4E0A\u6709", "\u5927\u97F3\u5E0C\u58F0\uFF0C\u5927\u8C61\u65E0\u5F62", "\u613F\u4ECA\u5929\u7684\u4F60\u6709\u597D\u6B4C\u53EF\u542C"];
        return json(res, 200, { text: list[Math.floor(Math.random() * list.length)], from: "", who: "" });
      }
    }
    if (p === "/api/diag") {
      const kw = (u.searchParams.get("kw") || "\u6674\u5929").slice(0, 20);
      const probe = async (name, fn) => {
        const t0 = Date.now();
        try {
          const v = await withDeadline(fn(), 9e3, null);
          if (v === null) return { name, ok: false, ms: Date.now() - t0, note: "timeout/blocked" };
          return { name, ok: true, ms: Date.now() - t0, count: Array.isArray(v) ? v.length : v && v.n };
        } catch (e) {
          return { name, ok: false, ms: Date.now() - t0, note: (e.message || "").slice(0, 60) };
        }
      };
      const [ne, tx, kg, kw_, mg, engines] = await Promise.all([
        probe("netease-\u5B98\u65B9", () => netease.search(kw, 1)),
        probe("tencent-soso+musicu", () => tencent.search(kw, 1)),
        probe("kugou", () => kugou.search(kw, 1)),
        probe("kuwo", () => kuwo.search(kw, 1)),
        probe("migu-xcvts", () => migu.search(kw, 1)),
        probe("lx-engines", async () => {
          const r = await probeLatency("netease");
          return { n: Object.values(r || {}).filter((v) => v != null).length };
        })
      ]);
      const fsOk = (rel) => {
        try {
          const abs = path.join(APP_ROOT, rel);
          return { exists: fs.existsSync(abs), dir: fs.existsSync(abs) && fs.statSync(abs).isDirectory(), n: fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? fs.readdirSync(abs).length : void 0 };
        } catch (_) {
          return { exists: false, error: true };
        }
      };
      return json(res, 200, {
        at: ( new Date()).toISOString(),
        kw,
        checks: [ne, tx, kg, kw_, mg, engines],
        fs: { root: APP_ROOT, config: fsOk("config.json"), sources: fsOk("sources"), publicIndex: fsOk("public/index.html"), styleCss: fsOk("public/style.css") },
        staticCheck: (() => {
          const abs = path.join(PUBLIC_DIR, "index.html");
          try {
            const st = fs.statSync(abs);
            return { abs, size: st.size, readable: fs.accessSync(abs, fs.constants.R_OK) === void 0 };
          } catch (e) {
            return { abs, error: e.code || String(e.message).slice(0, 60) };
          }
        })(),
        dirList: (() => {
          try {
            return fs.readdirSync(PUBLIC_DIR).slice(0, 8);
          } catch (e) {
            return ["readDir:" + (e.code || e.message)];
          }
        })(),
        cwdList: (() => {
          try {
            return fs.readdirSync(process.cwd()).slice(0, 10);
          } catch (e) {
            return ["cwd:" + (e.code || e.message)];
          }
        })(),
        lx: { total: LX_ENGINES.length, ready: LX_ENGINES.filter((e) => e.ok).length },
        hint: "ok:false+blocked/timeout \u5373\u8BE5\u51FA\u53E3 IP \u88AB\u4E0A\u6E38\u98CE\u63A7\uFF1Btencent \u5E38\u89C1\u4E8E\u673A\u623F IP \u88AB\u62C9\u9ED1"
      });
    }
    if (p === "/api/bg") {
      const chain = [];
      if (BG_API) chain.push(BG_API);
      chain.push(`bing:${Math.floor(Math.random() * 8)}`, `picsum:${crypto.randomBytes(4).toString("hex")}`);
      for (const u2 of chain) {
        try {
          const url = await resolveBg(u2);
          if (url) return json(res, 200, { url, from: u2.startsWith("bing:") ? "bing" : u2.startsWith("picsum:") ? "picsum" : "custom" });
        } catch (_) {
        }
      }
      return json(res, 200, { url: "" });
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "unknown api" });
    if (p === "/" || p.startsWith("/index.html")) return serveStatic(res, "/");
    return serveStatic(res, decodeURIComponent(p));
  } catch (e) {
    return json(res, 500, { error: e.message || "internal error" });
  }
}
function createApp() {
  const express = require("express");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.static(PUBLIC_DIR, { index: "index.html", fallthrough: true }));
  app.use((req, res, next) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: String(err && err.message || err) });
    });
  });
  return app;
}
function boot() {
  const HOST = process.env.HOST || "0.0.0.0";
  let app;
  try {
    app = createApp();
    console.log("[boot] express \u6A21\u5F0F");
  } catch (_) {
    app = null;
    console.log("[boot] node:http \u56DE\u9000\u6A21\u5F0F");
  }
  const server = http.createServer(app || ((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  }));
  server.listen(PORT, HOST, () => {
    console.log(`\u6D6E\u5149\u97F3\u4E50\u5DF2\u542F\u52A8: http://localhost:${PORT}`);
    console.log(`\u5916\u90E8\u89E3\u6790\u5668: tencent=${RESOLVERS.tencent.length}\u4E2A kugou=${RESOLVERS.kugou.length}\u4E2A | LX \u5F15\u64CE\u540E\u53F0\u521D\u59CB\u5316\u4E2D`);
  });
}
boot();
const audioCacheV2 = require("./lib/audio-cache.js");
function streamProxy(req, res, raw) {
  return audioCacheV2.streamProxy(req, res, raw);
}
function dropAudioCacheByU(raw) {
  return audioCacheV2.dropAudioCacheByU(raw);
}
