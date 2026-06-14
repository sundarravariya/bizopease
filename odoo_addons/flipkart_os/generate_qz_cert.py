#!/usr/bin/env python3
"""
Run once on the server to generate the QZ Tray RSA key pair.

Usage:
    python3 /opt/odoo/custom_addons/flipkart_os/generate_qz_cert.py

Outputs:
    /etc/odoo/qz_private.key        <- private key (keep secure, not web-accessible)
    /opt/odoo/custom_addons/flipkart_os/static/src/cert/qz-cert.pem  <- public cert
"""
import os
import datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# ── Paths ──────────────────────────────────────────────────────────────
PRIVATE_KEY_PATH = "/etc/odoo/qz_private.key"
CERT_DIR = os.path.join(os.path.dirname(__file__), "static", "src", "cert")
CERT_PATH = os.path.join(CERT_DIR, "qz-cert.pem")

os.makedirs(CERT_DIR, exist_ok=True)

# ── Generate RSA 2048 private key ──────────────────────────────────────
print("Generating RSA 2048 key pair...")
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
)

# ── Build self-signed certificate ──────────────────────────────────────
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
    x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Maharashtra"),
    x509.NameAttribute(NameOID.LOCALITY_NAME, "Mumbai"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Robifel"),
    x509.NameAttribute(NameOID.COMMON_NAME, "odoo.robifel.in"),
])

cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(private_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.utcnow())
    .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))  # 10 years
    .add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("odoo.robifel.in"),
            x509.DNSName("localhost"),
        ]),
        critical=False,
    )
    .sign(private_key, hashes.SHA256())
)

# ── Save private key ────────────────────────────────────────────────────
with open(PRIVATE_KEY_PATH, "wb") as f:
    f.write(private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))
os.chmod(PRIVATE_KEY_PATH, 0o640)
print(f"Private key saved → {PRIVATE_KEY_PATH}")

# ── Save public certificate ─────────────────────────────────────────────
with open(CERT_PATH, "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))
print(f"Public cert saved → {CERT_PATH}")

print("\nDone! Now restart Odoo and deploy the updated module.")
print("QZ Tray will trust odoo.robifel.in permanently after this.")
