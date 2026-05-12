# Claudio PWA 前端设计

**日期：** 2026-05-12
**目标：** 为 Claudio AI 电台构建移动端 PWA 前端，包含播放器+聊天界面
**技术栈：** 原生 ES 模块、CSS 动画、Canvas、Service Worker、Express 静态托管

---

## 架构

单页应用（SPA），无框架，原生 ES 模块。Express 托管 `public/` 目录为静态文件。前端通过现有 API 和后端交互，聊天 SSE 流式渲染。播放器和聊天共享同一个 `app.js` 入口协调。

### 文件结构

```
claudio/
├── public/                    ← 新建
│   ├── index.html             SPA 入口（mobile-first, dark theme）
│   ├── manifest.json          PWA 配置
│   ├── sw.js                  Service Worker（cache-first）
│   ├── css/
│   │   └── app.css            全局样式
│   ├── js/
│   │   ├── app.js             入口：初始化各模块
│   │   ├── api.js             fetch 封装（chat/now/search/history）
│   │   ├── player.js          播放器：波动条/进度/控件
│   │   ├── chat.js            聊天：消息渲染/输入/头像
│   │   └── profile.js         AI 资料页
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── src/
│   └── server.js              ← 修改：加 express.static('public')
```

---

## 页面布局（单屏）

```
┌─────────────────────────┐
│  ☀ 南京 18°C     日期   │  天气行
│                         │
│  ▏▎▍▌▋▊▉█▉▊▋▌▍▎▏    │  CSS/Canvas 波动条
│  ━━━━━━━━━━━━━━━━━     │  进度条
│   1:32       4:17       │  时间戳
│                         │
│       2:45              │  大号倒计时
│       晴天               │  歌名
│    周杰伦 · 叶惠美       │  歌手/专辑
│                         │
│  ⏮   ▶   ⏭    🔊━━━   │  播放控件 + 音量
│                         │
│ 🤖 Claudio  你好...    │  WeChat 风聊天
│       我 😊  来首...    │
│ 🤖 Claudio  🎵 晴天    │
│                         │
│  💬 和 DJ 说点什么... ↑ │  输入栏
└─────────────────────────┘
```

---

## 数据流

```
用户输入文本
  → chat.send(text)
  → api.chat(text) → POST /api/chat (SSE)
  → Claude 返回文本 + 指令
  → chat.render(msg) 渲染气泡
  → 若有播放指令 → player.update(song)
  → player.tick() 每 250ms 更新进度
```

聊天驱动一切，不新增独立 API 路由。

---

## 模块职责

### `api.js` — API 封装

| 函数 | 请求 | 返回 |
|------|------|------|
| `chat(text)` | POST `/api/chat` | SSE 流 |
| `getNow()` | GET `/api/now` | 当前播放状态 |
| `getHistory()` | GET `/api/history` | 历史记录 |
| `getTaste()` | GET `/api/taste` | 听歌偏好数据 |
| `searchSong(kw)` | 走 `/api/chat` | 通过对话搜索 |

### `player.js` — 播放器

- `update(song)` — 新歌更新全部 UI（歌名/歌手/封面）
- `tick()` — requestAnimationFrame 循环：更新进度条 + 大时间 + 波动条
- `setVisualizer(data)` — 波形数据输入（初期 CSS 动画模拟，后期 Web Audio API）
- `controls.play()` / `controls.pause()` / `controls.prev()` / `controls.next()`
- `controls.setVolume(v)` — 音量调节

### `chat.js` — 聊天

- `send(text)` — 发送消息 → 调 api.chat() → SSE 流式渲染
- `render(msg)` — 渲染单条消息（type: ai | user，含发送者名+时间戳）
- `scrollBottom()` — 新消息自动滚底
- `onAvatarClick(type)` — `ai` 切资料页，`user` 换头像（localStorage base64）

### `profile.js` — AI 资料页

- 展示：大头像、在线状态、个性签名、个人简介、听歌风格标签、统计数据
- 用户可编辑 AI 头像（上传/替换）
- 返回按钮回到播放器主页

---

## 错误处理

- **网络断开**：Service Worker 返回缓存页面，API 调用失败显示 toast "网络异常，请稍后"
- **SSE 中断**：自动重连（最多 3 次），失败提示 "Claudio 走神了，重试一下？"
- **音频加载失败**：跳过当前歌曲，AI 自动推荐下一首
- **头像存储超限**：localStorage 单条 >5MB 时压缩为缩略图

---

## 测试策略

- `test/api.test.js` — mock fetch，验证各 API 函数请求格式
- `test/chat.test.js` — 消息渲染、头像切换、localStorage 读写
- `test/player.test.js` — tick 逻辑、控件状态切换
- 测试框架：vitest（已有）

---

## PWA 配置

- **manifest.json**：name=Claudio, short_name=Claudio, theme_color=#0a0a0c, background_color=#0a0a0c, display=standalone
- **Service Worker**：cache-first 策略，预缓存 index.html/app.css/app.js，运行时缓存 API 响应
- **图标**：192×192 + 512×512 PNG

---

## 阶段划分

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| Phase 3a | 布局骨架 + 天气行 + 波动条 + 时间 + 播放控件 | P0 |
| Phase 3b | 聊天模块 + 输入栏 + SSE 流式渲染 | P0 |
| Phase 3c | AI 资料页 + 头像编辑 | P1 |
| Phase 3d | PWA 离线 + 安装提示 | P1 |
| Phase 3e | Web Audio 真实频谱 + 粒子效果 | P2 |
