#!/bin/bash
# Publish the Refinement Batch 1 PREVIEW (additive files only) + hub card.
# Runs on omarchy inside the site clone, serialized with publish.lock so
# it never races the data fetcher. NEVER commits data/*.json or live files.
set -euo pipefail
cd "$(dirname "$0")"
exec 9>publish.lock
if ! flock -n 9; then echo "lock held (fd 9)"; exit 1; fi
echo "lock held (fd 9)"
git fetch -q origin
git merge -q --ff-only origin/main
for f in preview-refinements.html preview-refinements-app.js preview-refinements-style.css; do
  cp -f ~/refinements-src/$f ./$f
  echo "$f staged ($(wc -c < ./$f) bytes)"
done
cp -f ~/refinements-src/preview-nomad-updates.html ./preview-nomad-updates.html
echo "hub staged"
# sanity: the preview must carry the batch-1 markers and no live wiring
grep -q "view-emergency" preview-refinements.html
grep -q "em-coords-btn" preview-refinements.html
grep -q "register('sw.js')" preview-refinements-app.js && { echo "SW NOT STUBBED"; exit 1; } || true
grep -q "Make it yours" preview-refinements.html preview-refinements-app.js && { echo "MAKE IT YOURS PRESENT"; exit 1; } || true
git add preview-refinements.html preview-refinements-app.js preview-refinements-style.css preview-nomad-updates.html
if git diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
git commit -q -m "preview: CCL refinement batch 1 — drawer from the left with utility block at the bottom, 'Make it yours' replaced by the Your town panel, new Emergency view (incident map, county status board, contacts, tucked-in quick coords); hub card added"
git push -q origin main
echo "PUSHED $(git rev-parse HEAD)"
