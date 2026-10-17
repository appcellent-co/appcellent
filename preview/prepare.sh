#!/bin/sh
# Turns a normal build into the locked preview build — run by .github/workflows/preview.yml
# after the build, before `wrangler pages deploy`. Never runs for production (main).
#
#   sh preview/prepare.sh <build output dir>
#
# - functions/_middleware.js → preview/gate.js (password page, noindex, no analytics) in front
#   of every request; a site's own root middleware keeps running after it
# - <out>/_routes.json → every path goes through the gate (static files too)
# - <out>/robots.txt Disallow: / and X-Robots-Tag in <out>/_headers as a second line of defence
set -e
out="${1:?usage: sh preview/prepare.sh <build output dir>}"

mkdir -p functions
if [ -f functions/_middleware.js ]; then
  mv functions/_middleware.js preview/site-middleware.js
  printf "import { onRequest as gate } from '../preview/gate.js';\nimport { onRequest as site } from '../preview/site-middleware.js';\nexport const onRequest = [gate, ...[site].flat()];\n" > functions/_middleware.js
else
  printf "export { onRequest } from '../preview/gate.js';\n" > functions/_middleware.js
fi

printf '{ "version": 1, "include": ["/*"], "exclude": [] }\n' > "$out/_routes.json"
printf 'User-agent: *\nDisallow: /\n' > "$out/robots.txt"
printf '\n/*\n  X-Robots-Tag: noindex, nofollow\n' >> "$out/_headers"
echo "preview: password gate + noindex + no analytics → $out"
