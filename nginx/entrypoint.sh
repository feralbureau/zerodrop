#!/bin/sh
set -e

touch /shared_nginx/waf.conf
apk add --no-cache inotify-tools >/dev/null

watch() {
  while inotifywait -e close_write,move,create /shared_nginx/waf.conf >/dev/null 2>&1; do
    nginx -s reload >/dev/null 2>&1 || true
  done
}

watch &
exec nginx -g 'daemon off;' -c /etc/nginx/nginx.conf
