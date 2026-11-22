#!/bin/sh
set -e
cd "$(dirname "$0")"
F=$(node -e "console.log({android:'Android_Lab_Report',iot:'IoT_Analytics_Report'}['$1'])")
for i in 1 2; do
  node "$1.js" "$1"
  soffice --headless --convert-to pdf --outdir .. "../$F.docx" >/dev/null
  [ $i = 2 ] || python3 pages.py "../$F.pdf" "keys-$1.json" "pages-$1.json"
done
