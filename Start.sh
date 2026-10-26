#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -f config.local.json ]; then node scripts/init.mjs --defaults; fi
node scripts/doctor.mjs
exec node src/main.mjs
