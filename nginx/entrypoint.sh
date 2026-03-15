#!/bin/sh
set -e

touch /shared_nginx/waf.conf

watch() {
  while inotifywait -e close_write,move,create /shared_nginx/waf.conf >/dev/null 2>&1; do
    nginx -s reload >/dev/null 2>&1
  done
}

watch &
exec nginx -g 'daemon off;' -c /etc/nginx/nginx.conf
