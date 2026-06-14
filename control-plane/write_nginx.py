cfg = open('/etc/nginx/sites-enabled/bizopease.robifel.in', 'w')
cfg.write("""server {
    server_name bizopease.robifel.in;
    client_max_body_size 50m;

    # Control plane API
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # APK download
    location /download/ {
        alias /var/www/robifel-download/;
        index index.html;
        types { application/vnd.android.package-archive apk; text/html html; }
    }
    location = /download { return 302 /download/; }

    # Superadmin panel (served from control plane dir)
    location = /superadmin {
        root /var/www/bizopease-saas;
        try_files /superadmin.html =404;
    }
    location = /superadmin.html {
        root /var/www/bizopease-saas;
        try_files /superadmin.html =404;
    }

    # Everything else -> React SPA (handles /login, /robifel, / etc via React Router)
    location /web/ {
        proxy_pass http://127.0.0.1:8069;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 720s;
    }

    location / {
        root /var/www/bizopease;
        try_files $uri $uri/ /index.html;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/bizopease.robifel.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bizopease.robifel.in/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
server {
    if ($host = bizopease.robifel.in) { return 301 https://$host$request_uri; }
    listen 80;
    server_name bizopease.robifel.in;
    return 404;
}
""")
cfg.close()
print("Done")
