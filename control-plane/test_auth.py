import urllib.request, json, urllib.error

url = 'https://bizopease.robifel.in/api/auth/find-workspace'
data = json.dumps({'email': 'robifel.com@gmail.com'}).encode()
req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
try:
    r = urllib.request.urlopen(req)
    print('Status:', r.status)
    print('Response:', r.read().decode())
except urllib.error.HTTPError as e:
    print('Error:', e.code, e.read().decode())
