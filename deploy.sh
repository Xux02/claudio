#!/usr/bin/env bash
set -euo pipefail

echo "=== Claude 云服务器部署 ==="

# 0. 检测依赖
command -v node >/dev/null 2>&1 || { echo "请先安装 Node.js: https://nodejs.org"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "请先安装 Python3"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "请先安装 ffmpeg: sudo apt install ffmpeg"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "正在安装 PM2..."; npm install -g pm2; }

# 1. 检查 .env
if [ ! -f .env ]; then
  echo ">>> 未检测到 .env，请根据 .env.example 创建:"
  echo "    cp .env.example .env"
  echo "    vim .env   # 填入你的 API Key 和 MUSIC_U cookie"
  exit 1
fi

# 2. 安装依赖
echo ">>> 安装 Node.js 依赖..."
npm install

echo ">>> 安装 Python 依赖..."
pip install edge-tts -q

# 3. 停掉旧进程
pm2 delete music-api 2>/dev/null || true
pm2 delete claudio-tts 2>/dev/null || true
pm2 delete claudio 2>/dev/null || true

# 4. 用 PM2 启动所有服务
echo ">>> 启动服务..."
pm2 start ecosystem.config.cjs

pm2 save
echo ""
echo "=== 部署完成 ==="
echo "主站: http://localhost:9876"
echo ""
echo "管理命令:"
echo "  pm2 status       查看运行状态"
echo "  pm2 logs claudio 查看日志"
echo "  pm2 restart all  重启所有服务"
echo ""
echo "如需配置 nginx 反向代理, 请参考 README 或上面的 nginx 配置"
