#!/usr/bin/env python3
"""Fix nginx /download location block."""

CONFIG = '/etc/nginx/sites-enabled/odoo'

with open(CONFIG, 'r') as f:
    content = f.read()

# Remove any existing broken download block
import re
content = re.sub(
    r'\s*# APK Download page\n\s*location \^\~ /download \{[^}]*\}\n',
    '\n',
    content,
    flags=re.DOTALL
)

# The correct block with literal $uri (no shell expansion needed - Python string)
BLOCK = '''
    # APK Download page
    location ^~ /download {
        alias /var/www/robifel-download;
        index index.html;
        try_files $uri $uri/ =404;
        types { application/vnd.android.package-archive apk; text/html html; }
    }
'''

# Insert before "location = /"
content = content.replace(
    '    location = / {',
    BLOCK + '    location = / {'
)

with open(CONFIG, 'w') as f:
    f.write(content)

print('Done. Config written.')
print('Verifying download block:')
for i, line in enumerate(content.split('\n')):
    if 'download' in line or 'alias /var/www/robifel' in line or 'try_files' in line:
        print(f'  {i+1}: {line}')
