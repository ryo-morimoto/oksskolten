#!/usr/bin/env bash
# One-off backfill: download external og_image URLs to R2.
# Run from worker/ directory.
#
# Usage: bash scripts/backfill-og-images.sh
#
# Rate limiting: 1s between each image download, 5s between batches.
# Processes 20 images per batch. Re-run if interrupted — idempotent.

set -euo pipefail

BATCH_SIZE=20
DOWNLOAD_DELAY=1   # seconds between each image download
BATCH_DELAY=5       # seconds between batches
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

total=0
migrated=0
failed=0

while true; do
  # Fetch batch of articles with external og_image URLs
  rows=$(npx wrangler d1 execute oksskolten --remote --json \
    --command "SELECT id, og_image FROM articles WHERE og_image IS NOT NULL AND og_image NOT LIKE 'og/%' ORDER BY id ASC LIMIT $BATCH_SIZE" \
    2>/dev/null | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      for (const r of d[0].results) console.log(r.id + '\t' + r.og_image);
    ")

  if [ -z "$rows" ]; then
    echo "Done. total=$total migrated=$migrated failed=$failed"
    break
  fi

  while IFS=$'\t' read -r id url; do
    total=$((total + 1))
    imgfile="$TMPDIR/$id"

    # Download image
    http_code=$(curl -sS -o "$imgfile" -w '%{http_code}' \
      -L --max-time 10 --max-filesize 2097152 \
      -A 'oksskolten-backfill/1.0' \
      "$url" 2>/dev/null || echo "000")

    if [ "$http_code" != "200" ] || [ ! -s "$imgfile" ]; then
      echo "FAIL id=$id url=$url (HTTP $http_code)"
      npx wrangler d1 execute oksskolten --remote \
        --command "UPDATE articles SET og_image = NULL WHERE id = $id" \
        >/dev/null 2>&1
      failed=$((failed + 1))
      rm -f "$imgfile"
      sleep "$DOWNLOAD_DELAY"
      continue
    fi

    # Detect content type and extension
    content_type=$(file -b --mime-type "$imgfile")
    case "$content_type" in
      image/jpeg) ext="jpg" ;;
      image/png)  ext="png" ;;
      image/gif)  ext="gif" ;;
      image/webp) ext="webp" ;;
      image/svg+xml) ext="svg" ;;
      *)
        echo "SKIP id=$id (not an image: $content_type)"
        npx wrangler d1 execute oksskolten --remote \
          --command "UPDATE articles SET og_image = NULL WHERE id = $id" \
          >/dev/null 2>&1
        failed=$((failed + 1))
        rm -f "$imgfile"
        sleep "$DOWNLOAD_DELAY"
        continue
        ;;
    esac

    key="og/${id}.${ext}"

    # Upload to R2
    if npx wrangler r2 object put "oksskolten/$key" \
      --file "$imgfile" \
      --content-type "$content_type" \
      >/dev/null 2>&1; then

      # Update DB
      npx wrangler d1 execute oksskolten --remote \
        --command "UPDATE articles SET og_image = '$key' WHERE id = $id" \
        >/dev/null 2>&1
      echo "OK   id=$id -> $key"
      migrated=$((migrated + 1))
    else
      echo "FAIL id=$id (R2 upload failed)"
      failed=$((failed + 1))
    fi

    rm -f "$imgfile"
    sleep "$DOWNLOAD_DELAY"
  done <<< "$rows"

  echo "Batch done. total=$total migrated=$migrated failed=$failed"
  sleep "$BATCH_DELAY"
done
