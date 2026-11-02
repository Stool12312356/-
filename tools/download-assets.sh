#!/usr/bin/env bash
# Скачивание ассетов из Google Drive в assets/models (раздел 2 ТЗ). Нужен: pip install gdown
set -e
mkdir -p assets/models
gdown --folder "https://drive.google.com/drive/folders/16bUDSprbcVa8LK6XvUVTvexYXqhx45wG?usp=sharing" -O assets/models \
 || echo "⚠ Скачивание не удалось — игра запустится на процедурных заглушках (placeholder:true). Положите файлы вручную в assets/models и выполните: npm run assets"
