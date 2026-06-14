#!/usr/bin/env python3
import sys

path = '/etc/nginx/sites-enabled/bizopease.robifel.in'
with open(path, 'r') as f:
    text = f.read()

target = 'location / { try_files $uri $uri/ /index.html; }'
replacement = """location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / { try_files $uri $uri/ /index.html; }"""

if target in text:
    with open(path, 'w') as f:
        f.write(text.replace(target, replacement))
    print("SUCCESS: Nginx configuration patched with proxy pass.")
else:
    if 'location /api/' in text:
        print("INFO: Nginx configuration already patched.")
    else:
        print("ERROR: Target try_files location not found in Nginx configuration.")
        sys.exit(1)
