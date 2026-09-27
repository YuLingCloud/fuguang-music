# 浮光音乐

一个自托管的在线音乐播放站：`node server.js` 起一个服务，浏览器打开即用。五平台聚合搜索，七档音质，逐行歌词、歌单导入、队列持久化、四套主题

## 快速开始

```bash
node server.js          # 或 npm start，端口取 PORT，默认 3000
# 打开 http://localhost:3000
bash watchdog.sh        # 可选：后台守护，进程退出每 5 秒自动拉起
```

---

## 一、这个项目是干嘛的

把各音乐平台的搜索、解析、歌词、封面收拢到一个网页里：站内直连各平台搜索接口拿结果，播放链接由洛雪社区音源脚本竞速解析，服务端统一代理音频流。数据不落库、缓存播完即删，仅供学习研究。

## 二、功能怎么用

| 功能 | 操作 |
|---|---|
| 搜索 | 顶部搜索框输入关键词；左侧下拉切音源（全部 / 网易 / QQ / 酷狗 / 酷我 / 咪咕）；结果分「单曲 / 专辑 / 歌单」三个标签 |
| 播放 | 点列表行即播；底部播放条控制上一首 / 播放 / 下一首 / 循环模式；顶边进度条可拖拽 |
| 音质 | 点底部徽章弹七档（Master / Atmos+ / Atmos / Hires / Flac / 320K / 128K），取不到时自动降档并提示 |
| 歌词 | 底部栏内嵌当前句；点歌词按钮进沉浸页（逐行滚动，点歌词行跳转进度） |
| 歌单导入 | 侧栏「导入歌单」粘贴网易云 / QQ / 酷狗 / 酷我歌单链接，加入队列 |
| 队列 | 侧栏「队列」查看 / 清空；单曲 / 列表循环 / 随机；刷新页面队列仍存在 |
| 主题 | 侧栏「主题设置」四主题：浅·极简 / 浅·清新 / 深·通透 / 深·沉浸 |
| 背景 / 横屏 | 侧栏「换背景」换背景图；移动端「横屏」调整方向，沉浸页可切换明暗 |
| 快捷键 | `空格` 播放/暂停，`Esc` 收起沉浸页 |

## 三、功能是怎么实现的

**搜索（五平台直连）**
`lxweb-native-search.js` 按洛雪官方 musicSdk移植：网易走 `cloudsearch/pc`（eapi加密）、QQ `musics.fcg`（zzcSign签名）、酷狗 `song_search_v2` 直连、酷我 `search.kuwo.cn/r.s` 直连、咪咕 `jadeite.migu.cn` v3（header MD5签名）+ APP端点 `search_all.do`（专辑/歌单）。聚合结果合并，同时支持按源筛选

**取链（社区音源脚本竞速）**
`lxweb-engine.js` 是 LX 音源脚本运行时垫片（`globalThis.lx` 全API响应兼容），加载 `sources/` 下24个社区脚本。按 `config.json` 的 `lxPriority` 每平台顺序竞速，失败接力下一个引擎；musicInfo从extra透传真实匹配字段（按平台各取所需）；解析结果先经Range GET 2KB可达性校验，死链自动跳过；成功缓存10分钟、失败负缓存30秒。

**音频流（服务端代理 + 缓存分块）**
所有平台音频统一走 `/api/stream`：防 mixed content（http链拦截）、防 vkey 绑IP（用户 IP 不参与直链）。磁盘缓存到 `/tmp/fuguang-audio-cache/`，响应头一到即发首块1/6，之后自适应补发（缓冲水位只增不减，）；Range透传支持拖进度；播完即删（单曲循环保留）、40 分钟TTL+1GB LRU；内网地址黑名单防SSRF、content-type白名单防滥用。

**歌词 / 封面 / 详情**
歌词三级接力：本源 LX 脚本 `getLyric` → 本源直连接口 → 跨源同名歌歌词。封面：酷狗强制走 `/api/pic` 服务端代理（`{size}` 占位符取 480），酷我 `web_albumpic_short` 拼500尺寸。歌单/专辑详情：直连可用则直连；酷我歌单与咪咕专辑/歌单按名回查本平台近似（见问题区，未实现解析）

**前端与守护**
原生JS无框架，四主题CSS变量切换；`watchdog.sh` 每5秒探活拉起。横竖屏：非旋转态菜单fixed定位防裁剪防点透，退出沉浸不释放横屏锁

**历史排障结论（备查）**
社区音源脚本绝大多数只实现取链不实现search（官方Huibq源码实锤），洛雪能搜是客户端自带搜索——本站架构与其一致：直连搜索 + 社区源取链兜底

## 四、用到的接口与文件

### 本站 HTTP API（可直接用）

| 接口 | 说明 |
|---|---|
| `GET /api/search?kw=关键词&source=all\|netease\|tencent\|kugou\|kuwo\|migu&type=song\|album\|playlist` | 聚合搜索 |
| `GET /api/url?source=&id=&quality=master\|hires\|lossless\|high\|standard&extra=` | 取播放直链，返回 `{ok,url,br,quality}` |
| `GET /api/alt?name=&singer=&exclude=` | 同名歌跨源兜底取链 |
| `GET /api/lyric?source=&id=` | 取LRC歌词 |
| `GET /api/album?source=&id=` / `GET /api/playlist?url=` / `GET /api/playlist-detail?source=&id=` | 专辑详情 / 歌单导入 / 歌单详情 |
| `GET /api/stream?u=` | 音频流代理 |
| `GET /api/pic?u=` | 封面图片代理 |
| `GET /api/lx` / `POST /api/lx/reload` / `GET /api/lx/latency` | 引擎状态 / 重载音源 / 线路测速 |
| `GET /api/diag?kw=关键词` | 一键自检：五源搜索连通性 + 文件系统 + 引擎就绪数 |
| `GET /healthz` / `GET /api/capability` / `GET /api/config` | 健康检查 / 能力表 / 运行配置 |
| `GET /api/bg` / `GET /api/hitokoto` / `GET /api/ne-cover?=` | 背景图 / 一言 / 网易封面兜底 |

curl 示例：

```bash
curl "http://localhost:3000/api/search?kw=晴天&source=netease"
curl "http://localhost:3000/api/url?source=tencent&id=0039MnYb0qxYhV&quality=lossless"
curl "http://localhost:3000/api/lyric?source=tencent&id=0039MnYb0qxYhV"
curl "http://localhost:3000/api/diag?kw=周杰伦"
```

### 上游平台端点（代码直连）

| 平台 | 搜索端点 | 鉴权 |
|---|---|---|
| 网易云 | `music.163.com/api/cloudsearch/pc` | cookie+Referer |
| QQ | `u.y.qq.com/cgi-bin/musics.fcg` | zzcSign |
| 酷狗 | `songsearch.kugou.com/song_search_v2` | 无 |
| 酷我 | `search.kuwo.cn/r.s` | 无 |
| 咪咕 | `jadeite.migu.cn/music_search/v3/search/searchAll`；专辑/歌单 `c.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do` | header MD5签名（固定deviceId+salt） |

### 音源脚本与垫片

压缩包 **`浮光.zip`**（31 个文件），分类目录：

| 目录 | 内容 |
|---|---|
| `01-音源脚本/` | `sources/` |
| `02-引擎与搜索垫片/` | `lxweb-engine.js`、`lxweb-native-search.js` |
| `03-配置模板/` | `config.example.json` |

- 下载链接：`【待回填：你把压缩包传到网盘后，把链接发我，我补到这里】`
- 此包的使用详见包内 `说明.txt`

## 五、问题区（尚未实现 / 已知BUG）

- **咪咕专辑 / 歌单详情**：官方详情路由已下线，现按「专辑名 / 歌单名」回查本平台歌曲做最佳近似，非原始歌单内容
- **酷我歌单详情**：官方接口需CSRF token（服务端拿不到），同样按歌单名回查近似
- **酷狗取链**：官方直连接口全线风控（m3c不通、gateway 404、wwwapi返err 30020骨架），取链完全依赖社区音源脚本
- **咪咕搜索**关键词最佳匹配，非精确分页结果

---

仅供学习研究；内容均来自公开接口，版权归原平台/权利人所有，请支持正版
