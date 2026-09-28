"use strict";
const crypto = require("crypto");
function httpFetch(url, options = {}) {
  const opts = { method: "get", ...options };
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36", Accept: "application/json", ...opts.headers || {} };
  let body;
  if (opts.method.toLowerCase() === "post") {
    if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = Object.entries(opts.form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15e3);
  return fetch(url, { method: opts.method, headers, body, signal: ctrl.signal }).then((r) => r.text()).then((t) => {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }).finally(() => clearTimeout(timer));
}
const toMD5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sizeFormate = (b) => {
  if (!b) return null;
  const n = Number(b);
  if (Number.isNaN(n)) return null;
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + "KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + "MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + "GB";
};
const formatPlayTime = (s) => {
  const sec = Math.floor(Number(s) || 0);
  const m = Math.floor(sec / 60), ss = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};
function decodeName(str) {
  if (typeof str !== "string") return str;
  try {
    return str.replace(/\\u([\da-f]{4})/gi, (_, g) => String.fromCharCode(parseInt(g, 16)));
  } catch {
    return str;
  }
}
const formatSingerName = (singers, key = "name") => {
  if (!singers) return "";
  if (Array.isArray(singers)) return singers.map((s) => typeof s === "string" ? s : s[key]).filter(Boolean).join("\u3001");
  if (typeof singers === "string") return singers;
  return singers[key] || "";
};
const EAPI_KEY = Buffer.from("e82ckenh8dichen8", "utf8");
function eapi(url, object) {
  const text = typeof object === "object" ? JSON.stringify(object) : object;
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = toMD5(message);
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const S = Buffer.from(data, "utf8").toString("base64");
  let inBuf = Buffer.from(S, "utf8");
  const pad = 16 - inBuf.length % 16;
  if (pad !== 16) inBuf = Buffer.concat([inBuf, Buffer.alloc(pad, 0)]);
  const cipher = crypto.createCipheriv("aes-128-ecb", EAPI_KEY, null);
  cipher.setAutoPadding(false);
  const enc = Buffer.concat([cipher.update(inBuf), cipher.final()]);
  return { params: enc.toString("hex").toUpperCase() };
}
const PART_1 = [23, 14, 6, 36, 16, 40, 7, 19];
const PART_2 = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
function zzcSign(text) {
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  const p1 = PART_1.map((i) => hash[i]).join("");
  const p2 = PART_2.map((i) => hash[i]).join("");
  const p3 = SCRAMBLE.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const b64 = Buffer.from(p3).toString("base64").replace(/[\/+=]/g, "");
  return `zzc${p1}${b64}${p2}`.toLowerCase();
}
const MG_DEVICE = "963B7AA0D21511ED807EE5846EC87D20";
const MG_SIG_MD5 = "6cdc72a439cef99a3418d2a78aa28c73";
function mgSign(time, str) {
  const sign = toMD5(`${str}${MG_SIG_MD5}yyapp2d16148780a1dcc7408e06336b98cfd50${MG_DEVICE}${time}`);
  return { sign, deviceId: MG_DEVICE };
}
async function wySearch(str, page = 1, limit = 30) {
  const body = await httpFetch("http://interface.music.163.com/eapi/batch", {
    method: "post",
    timeout: 15e3,
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
      origin: "https://music.163.com"
    },
    form: eapi("/api/search/song/list/page", { keyword: str, needCorrect: "1", channel: "typing", offset: limit * (page - 1), scene: "normal", total: page == 1, limit })
  });
  if (!body || body.code !== 200) throw new Error("wy code " + (body && body.code));
  const raw = body.data && body.data.resources || [];
  const list = raw.map((item) => {
    item = item.baseInfo.simpleSongData;
    const types = [], _types = {};
    let size;
    if (item.privilege.maxBrLevel == "hires") {
      size = item.hr ? sizeFormate(item.hr.size) : null;
      types.push({ type: "flac24bit", size });
      _types.flac24bit = { size };
    }
    if (item.privilege.maxbr == 999e3) {
      size = item.sq ? sizeFormate(item.sq.size) : null;
      types.push({ type: "flac", size });
      _types.flac = { size };
    }
    if (item.privilege.maxbr == 32e4 || item.privilege.maxbr == 192e3 || item.privilege.maxbr == 128e3) {
      size = item.l ? sizeFormate(item.l.size) : null;
      types.push({ type: "128k", size });
      _types["128k"] = { size };
    }
    types.reverse();
    return {
      singer: (item.ar || []).map((a) => a.name).join("\u3001"),
      name: item.name,
      albumName: item.al ? item.al.name : "",
      albumId: item.al ? item.al.id : "",
      source: "wy",
      interval: formatPlayTime(item.dt / 1e3),
      songmid: String(item.id),
      img: item.al ? item.al.picUrl : "",
      types,
      _types,
      typeUrl: {}
    };
  });
  return { list, total: body.data && body.data.totalCount || 0, source: "wy" };
}
async function txSearch(str, page = 1, limit = 50) {
  const data = {
    comm: { _channelid: "0", _os_version: "6.2.9200-2", ct: "19", cv: "2151", guid: "1F70E520B2EAA7D25E11760783C53CA9", patch: "118", psrf_access_token_expiresAt: 0, psrf_qqaccess_token: "", psrf_qqopenid: "", psrf_qqunionid: "", tmeAppID: "qqmusic", tmeLoginType: 0, uin: "0", wid: "7223299733393904640" },
    "music.search.SearchCgiService": { module: "music.search.SearchCgiService", method: "DoSearchForQQMusicDesktop", param: { grp: 1, num_per_page: limit, page_num: page, query: str, remoteplace: "txt.newclient.top", search_type: 0, searchid: txSearchId() } }
  };
  const sign = zzcSign(JSON.stringify(data));
  const body = await httpFetch(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, {
    method: "post",
    timeout: 15e3,
    headers: { "User-Agent": "QQMusic 14090508(android 12)" },
    body: data
  });
  const req = body && (body["music.search.SearchCgiService"] || body.req);
  if (!req || body.code != 0 || req.code != 0) throw new Error("tx code " + (body && body.code));
  const d = req.data;
  const list = (d.body.song.list || []).map((item) => {
    if (!item.file || !item.file.media_mid) return null;
    const f = item.file;
    const types = [], _types = {};
    if (f.size_128mp3 != 0) {
      types.push({ type: "128k", size: sizeFormate(f.size_128mp3) });
      _types["128k"] = {};
    }
    if (f.size_320mp3 != 0) {
      types.push({ type: "320k", size: sizeFormate(f.size_320mp3) });
      _types["320k"] = {};
    }
    if (f.size_flac != 0) {
      types.push({ type: "flac", size: sizeFormate(f.size_flac) });
      _types.flac = {};
    }
    if (f.size_hires != 0) {
      types.push({ type: "flac24bit", size: sizeFormate(f.size_hires) });
      _types.flac24bit = {};
    }
    const albumId = item.album ? item.album.mid : "";
    return {
      singer: formatSingerName(item.singer, "name"),
      name: item.title,
      albumName: item.album ? item.album.name : "",
      albumId,
      source: "tx",
      interval: item.interval ? formatPlayTime(item.interval) : null,
      songId: String(item.id),
      albumMid: item.album ? item.album.mid : "",
      strMediaMid: item.file.media_mid,
      songmid: item.mid,
      img: albumId === "" || albumId === "\u7A7A" ? item.singer && item.singer[0] ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : "" : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
      types,
      _types,
      typeUrl: {}
    };
  }).filter(Boolean);
  return { list, total: d.meta ? d.meta.sum : list.length, source: "tx" };
}
function txSearchId() {
  let guid = "";
  for (let i = 0; i < 32; i++) guid += Math.floor(Math.random() * 16).toString(16);
  return guid.toUpperCase() + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");
}
async function kgSearch(str, page = 1, limit = 30) {
  const body = await httpFetch(`https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`);
  if (!body || body.error_code !== 0) throw new Error("kg code " + (body && body.error_code));
  const ids = new Set();
  const list = [];
  for (const item of body.data.lists || []) {
    const key = item.Audioid + item.FileHash;
    if (ids.has(key)) continue;
    ids.add(key);
    list.push(kgFilter(item));
    for (const c of item.Grp || []) {
      const k2 = item.Audioid + item.FileHash;
      if (ids.has(k2)) continue;
      ids.add(k2);
      list.push(kgFilter(c));
    }
  }
  return { list, total: body.data.total, source: "kg" };
}
function kgFilter(raw) {
  const types = [], _types = {};
  if (raw.FileSize != 0) {
    types.push({ type: "128k", size: sizeFormate(raw.FileSize), hash: raw.FileHash });
    _types["128k"] = { hash: raw.FileHash };
  }
  if (raw.HQFileSize != 0) {
    types.push({ type: "320k", size: sizeFormate(raw.HQFileSize), hash: raw.HQFileHash });
    _types["320k"] = { hash: raw.HQFileHash };
  }
  if (raw.SQFileSize != 0) {
    types.push({ type: "flac", size: sizeFormate(raw.SQFileSize), hash: raw.SQFileHash });
    _types.flac = { hash: raw.SQFileHash };
  }
  if (raw.ResFileSize != 0) {
    types.push({ type: "flac24bit", size: sizeFormate(raw.ResFileSize), hash: raw.ResFileHash });
    _types.flac24bit = { hash: raw.ResFileHash };
  }
  return {
    singer: decodeName(formatSingerName(raw.Singers, "name")),
    name: decodeName(`${raw.OriSongName}${raw.Suffix ? ` ${raw.Suffix}` : ""}`),
    albumName: decodeName(raw.AlbumName),
    albumId: raw.AlbumID,
    songmid: String(raw.Audioid),
    source: "kg",
    interval: formatPlayTime(raw.Duration),
    img: raw.Image ? raw.Image.replace("{size}", "480") : null,
    lrc: null,
    hash: raw.FileHash,
    types,
    _types,
    typeUrl: {}
  };
}
const KW_REG = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;
async function kwSearch(str, page = 1, limit = 30) {
  const body = await httpFetch(`http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`);
  if (!body || body.TOTAL !== "0" && body.SHOW === "0") throw new Error("kw empty");
  const result = [];
  for (const info of body.abslist || []) {
    const songId = String(info.MUSICRID).replace("MUSIC_", "");
    if (!info.N_MINFO) continue;
    const types = [], _types = {};
    for (const m of info.N_MINFO.split(";")) {
      const mm = m.match(KW_REG);
      if (!mm) continue;
      switch (mm[2]) {
        case "4000":
          types.push({ type: "flac24bit", size: mm[4] });
          _types.flac24bit = { size: mm[4].toUpperCase() };
          break;
        case "2000":
          types.push({ type: "flac", size: mm[4] });
          _types.flac = { size: mm[4].toUpperCase() };
          break;
        case "320":
          types.push({ type: "320k", size: mm[4] });
          _types["320k"] = { size: mm[4].toUpperCase() };
          break;
        case "128":
          types.push({ type: "128k", size: mm[4] });
          _types["128k"] = { size: mm[4].toUpperCase() };
          break;
      }
    }
    types.reverse();
    const interval = parseInt(info.DURATION);
    result.push({
      name: decodeName(info.SONGNAME),
      singer: decodeName(info.ARTIST),
      source: "kw",
      songmid: songId,
      albumId: decodeName(info.ALBUMID || ""),
      interval: Number.isNaN(interval) ? 0 : formatPlayTime(interval),
      albumName: info.ALBUM ? decodeName(info.ALBUM) : "",
      lrc: null,
      img: info.web_albumpic_short ? "https://img1.kuwo.cn/star/albumcover/" + info.web_albumpic_short.replace("120/", "500/") : null,
      types,
      _types,
      typeUrl: {}
    });
  }
  return { list: result, total: parseInt(body.TOTAL) || result.length, source: "kw" };
}
async function mgSearch(str, page = 1, limit = 20) {
  const time = Date.now().toString();
  const { sign, deviceId } = mgSign(time, str);
  const body = await httpFetch(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`, {
    headers: { uiVersion: "A_music_3.6.1", deviceId, timestamp: time, sign, channel: "0146921", "User-Agent": "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30" }
  });
  if (!body || body.code !== "000000") throw new Error("mg code " + (body && body.code) + " " + (body && body.info));
  const songData = body.songResultData || { resultList: [], totalCount: 0 };
  const ids = new Set();
  const list = [];
  for (const grp of songData.resultList || []) {
    for (const data of grp) {
      if (!data.songId || !data.copyrightId || ids.has(data.copyrightId)) continue;
      ids.add(data.copyrightId);
      const types = [], _types = {};
      for (const t of data.audioFormats || []) {
        const s = sizeFormate(t.asize ?? t.isize);
        switch (t.formatType) {
          case "PQ":
            types.push({ type: "128k", size: s });
            _types["128k"] = {};
            break;
          case "HQ":
            types.push({ type: "320k", size: s });
            _types["320k"] = {};
            break;
          case "SQ":
            types.push({ type: "flac", size: s });
            _types.flac = {};
            break;
          case "ZQ24":
            types.push({ type: "flac24bit", size: s });
            _types.flac24bit = {};
            break;
        }
      }
      let img = data.img3 || data.img2 || data.img1 || null;
      if (img && !/https?:/.test(data.img3)) img = "http://d.musicapp.migu.cn" + img;
      list.push({
        singer: formatSingerName(data.singerList),
        name: data.name,
        albumName: data.album,
        albumId: data.albumId,
        songmid: data.songId,
        copyrightId: data.copyrightId,
        source: "mg",
        interval: formatPlayTime(data.duration),
        img,
        lrc: null,
        types,
        _types,
        typeUrl: {}
      });
    }
  }
  return { list, total: parseInt(songData.totalCount) || list.length, source: "mg" };
}
const SEARCHERS = { wy: wySearch, tx: txSearch, kg: kgSearch, kw: kwSearch, mg: mgSearch };
async function search(source, keyword, page = 1, limit) {
  const fn = SEARCHERS[source];
  if (!fn) throw new Error("unknown source " + source);
  return fn(keyword, page, limit);
}
module.exports = { search, wySearch, txSearch, kgSearch, kwSearch, mgSearch };
