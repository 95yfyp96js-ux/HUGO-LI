#!/usr/bin/env bash
# 一鍵對外網址：本機起伺服器 + cloudflared 快速通道，印出一個 https 網址。
#
# 這只是把「你這台電腦」暫時開一個對外入口，**不是把系統搬到雲端**：
# 電腦關機、睡眠、換 Wi-Fi，網址就死了。每次重跑網址都不一樣。
#
#   ./bin/serve-public.sh
#   PORT=9000 DB_PATH=/path/ledger.db ./bin/serve-public.sh
set -euo pipefail

PORT="${PORT:-8080}"
DB_PATH="${DB_PATH:-ledger.db}"
CF_LOG="$(mktemp -t cloudflared.XXXXXX)"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "找不到 cloudflared。先裝它："
  echo "  macOS：  brew install cloudflared"
  echo "  Windows：winget install --id Cloudflare.cloudflared"
  echo "  Linux：  https://github.com/cloudflare/cloudflared/releases"
  exit 1
fi
if ! command -v dart >/dev/null 2>&1; then
  echo "找不到 dart。先照 docs/WEB-RUN.md 第 1 步裝 Dart SDK。"
  exit 1
fi

cleanup() { kill "${SERVER_PID:-}" "${TUNNEL_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "→ 啟動伺服器（port $PORT，資料庫 $DB_PATH）…"
PORT="$PORT" DB_PATH="$DB_PATH" SECURE_COOKIES=1 dart run bin/server.dart &
SERVER_PID=$!
sleep 3

echo "→ 開對外通道…"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >"$CF_LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "通道沒開起來。cloudflared 的訊息："
  tail -20 "$CF_LOG"
  exit 1
fi

echo
echo "================================================================"
echo "  手機開這個網址：$URL"
echo "  帳號密碼看上面伺服器啟動時印的那幾行（只會印一次）。"
echo "  這個視窗關掉、電腦睡著，網址就沒了。"
echo "================================================================"
echo
wait "$SERVER_PID"
