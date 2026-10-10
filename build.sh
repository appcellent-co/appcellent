#!/bin/sh
# Cloudflare Pages çıktısını public/ altında toplar (functions/ ayrıca deploy edilir).
set -e
rm -rf public
mkdir -p public
cp -r main public/main
cp -r limify public/limify
cp -r getby public/getby
cp -r styles public/styles
cp 404.html public/404.html
for dir in public/main public/limify public/getby; do
  [ -f "$dir/index.html" ] && mv "$dir/index.html" "$dir/home.html"
done
