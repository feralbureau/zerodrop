#!/bin/sh
set -e

touch /shared_nginx/waf.conf

watch() {
  last_sum=""
  while true; do
    if [ -f /shared_nginx/waf.conf ]; then
      current_sum="$(sha256sum /shared_nginx/waf.conf | awk '{print $1}')"
      if [ "$current_sum" != "$last_sum" ]; then
        if [ -e /proc/1/exe ] && readlink /proc/1/exe | grep -q nginx; then
          kill -HUP 1 2>/dev/null || true
          origin_line="$(grep -m1 "proxy_pass " /shared_nginx/waf.conf | tr -d ';')"
          echo "nginx reload applied ${origin_line}"
          last_sum="$current_sum"
        fi
      fi
    fi
    sleep 2
  done
}

watch &
exec nginx -g 'daemon off;' -c /etc/nginx/nginx.conf
