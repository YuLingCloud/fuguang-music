LOG=/tmp/fuguang-server.log
while true; do
  if ! pgrep -f 'serv[e]r[.]js' >/dev/null 2>&1; then
    cd /workspace/fuguang
    echo "[watchdog] $(date '+%F %T') node 不在，拉起" >> "$LOG"
    nohup node server.js >> "$LOG" 2>&1 &
  fi
  sleep 5
done
