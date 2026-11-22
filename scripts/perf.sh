#!/usr/bin/env bash
# Time SEAL's main API calls for both hospitals: first call (cold) and the best of three warm calls.
# Usage: scripts/perf.sh [base-url]   (default http://localhost:3000)
B=${1:-http://localhost:3000}
URLS=(/api/today /api/encounters?status=open "/api/claims?status=hold,checking&limit=60&scope=live" "/api/recovery?limit=0" /api/recovery /api/clinic /api/ai-health "/api/questions?status=open" /api/rules)
printf "%-48s %8s %8s %8s\n" "call" "cold" "warm" "KB"
for t in basic apollo; do
  echo "## $t"
  for u in "${URLS[@]}"; do
    cold=$(curl -s -o /dev/null -b "seal-tenant=$t" -w "%{time_total}" --max-time 120 "$B$u")
    best=999; size=0
    for i in 1 2 3; do
      read -r tt sz < <(curl -s -o /dev/null -b "seal-tenant=$t" -w "%{time_total} %{size_download}" --max-time 120 "$B$u")
      best=$(awk -v a="$best" -v b="$tt" 'BEGIN{print (b<a)?b:a}'); size=$sz
    done
    printf "%-48s %7.0fms %7.0fms %8.0f\n" "$u" "$(awk -v x="$cold" 'BEGIN{print x*1000}')" "$(awk -v x="$best" 'BEGIN{print x*1000}')" "$(awk -v x="$size" 'BEGIN{print x/1024}')"
  done
done
