#!/bin/sh
set -e
cd "$(dirname "$0")"
node build.js
soffice --headless --convert-to pdf --outdir .. ../Android_Lab_Report.docx >/dev/null
python3 pages.py ../Android_Lab_Report.pdf keys.json pages.json
node build.js
soffice --headless --convert-to pdf --outdir .. ../Android_Lab_Report.docx >/dev/null
