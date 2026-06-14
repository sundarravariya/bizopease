cfg = open('/etc/nginx/sites-enabled/dashboard.robifel.in', 'w')
cfg.write("""# dashboard.robifel.in — permanently redirects to bizopease.robifel.in
# The React SPA is now served from bizopease.robifel.in
server {
    server_name dashboard.robifel.in;

    location / {
        return 301 https://bizopease.robifel.in/login;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/dashboard.robifel.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.robifel.in/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
server {
    if ($host = dashboard.robifel.in) { return 301 https://$host$request_uri; }
    listen 80;
    server_name dashboard.robifel.in;
    return 404;
}
""")
cfg.close()
print("Done")
