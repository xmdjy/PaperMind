#!/usr/bin/env bash
set -euo pipefail
# Run as root after installing Ubuntu's nginx package.
# Usage: bash install-nginx.sh /secure/server.pem /secure/server.key /secure/root-ca.pem
if [[ $EUID -ne 0 || $# -ne 3 ]]; then
  echo 'Run as root: bash install-nginx.sh SERVER_CERT SERVER_KEY ROOT_CA_CERT' >&2
  exit 1
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
openssl verify -CAfile "$3" -verify_ip 101.76.222.224 "$1"
# Fail before changing configuration if key and certificate do not match.
cert_public=$(openssl x509 -in "$1" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
key_public=$(openssl pkey -in "$2" -pubout -outform DER | sha256sum)
[[ "$cert_public" == "$key_public" ]]
backup_dir=$(mktemp -d /root/papermind-nginx-backup-XXXXXXXX)
chmod 700 "$backup_dir"
for path in /etc/nginx/sites-available/papermind-docling /etc/nginx/sites-enabled/papermind-docling /etc/nginx/sites-enabled/default /etc/papermind/docling /etc/systemd/system/nginx.service.d/papermind.conf; do
  if [[ -e "$path" || -L "$path" ]]; then cp -a --parents "$path" "$backup_dir"; fi
done
install -d -m 700 /etc/papermind/docling
install -m 644 "$1" /etc/papermind/docling/server.pem
install -m 600 "$2" /etc/papermind/docling/server.key
install -m 644 "$3" /etc/papermind/docling/root-ca.pem
install -m 644 "$script_dir/nginx.conf" /etc/nginx/sites-available/papermind-docling
ln -sfn /etc/nginx/sites-available/papermind-docling /etc/nginx/sites-enabled/papermind-docling
# This dedicated server had no nginx sites before this deployment.
rm -f /etc/nginx/sites-enabled/default
if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/papermind-docling /etc/nginx/sites-available/papermind-docling
  if [[ -d "$backup_dir/etc" ]]; then cp -a "$backup_dir/etc/." /etc/; fi
  echo "Configuration check failed; restored prior config from $backup_dir" >&2
  exit 1
fi
install -d -m 755 /etc/systemd/system/nginx.service.d
install -m 644 "$script_dir/nginx-systemd.conf" /etc/systemd/system/nginx.service.d/papermind.conf
systemctl daemon-reload
systemctl enable nginx
systemctl reload-or-restart nginx
loginctl enable-linger ubuntu
if LC_ALL=C ufw status | grep -q '^Status: active'; then
  ufw allow in on enp0s31f6 to 101.76.222.224 port 443 proto tcp comment 'PaperMind Docling HTTPS'
fi
systemctl is-active nginx
printf 'Backup: %s\n' "$backup_dir"
