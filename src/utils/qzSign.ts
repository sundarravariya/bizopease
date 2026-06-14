// QZ Tray request signing.
//
// We present a self-signed certificate and sign every QZ request with the
// matching RSA private key (RSASSA-PKCS1-v1_5 / SHA-512) using the browser's
// built-in Web Crypto — no external crypto library required.
//
// Effect: QZ Tray treats the connection as SIGNED, so "Remember this decision"
// + Allow becomes clickable (one click per PC, then silent). If the public
// certificate (qz-cert/digital-certificate.txt) is additionally installed into
// QZ Tray's trust store, there is NO prompt at all.
//
// This is an internal, authenticated admin tool, so the private key is embedded
// for in-browser signing. Worst-case exposure is the ability to send print jobs
// to a trusting QZ Tray instance.

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDeTCCAmGgAwIBAgIUVkwAwSpSZFfdpboMQVNbVAa8/zUwDQYJKoZIhvcNAQEL
BQAwTDEXMBUGA1UEAwwOUm9iaWZlbCBQb3J0YWwxEjAQBgNVBAsMCVdhcmVob3Vz
ZTEQMA4GA1UECgwHUm9iaWZlbDELMAkGA1UEBhMCSU4wHhcNMjYwNjEzMTk1MjUy
WhcNNDYwNjA4MTk1MjUyWjBMMRcwFQYDVQQDDA5Sb2JpZmVsIFBvcnRhbDESMBAG
A1UECwwJV2FyZWhvdXNlMRAwDgYDVQQKDAdSb2JpZmVsMQswCQYDVQQGEwJJTjCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKY4IDXDmZ7KRjMHHgid+pv5
Es8WyhXpbxCJros0AqID3FbjOV1xJtMahzjOXEsuQKJEn0tL8jNW5t/1N7c+Ft3x
xCgPexA0gq3p2cBdWUp5w0ucy2vRnrMMmuc2XGhhPRqJa1OPOGoItw4uC0fmGW7t
rngQoa73/d/KLWq1sUMzOvm8DdEGTZC+o1jg+zQdBIMvro2y32wwPMvCG0hYikxd
Q6gcz6gAgv556cVrFVq3vjOP8c253Beeni727NVGiVesXAyTs3Dzkr/2uvR77t1W
gzWveK0kci/o//N3VuPebDZZ8VRrAmSKpPr4YekRVnzCIJpwerBha663xIzELDkC
AwEAAaNTMFEwHQYDVR0OBBYEFKilona8uRBPBulOGIbh4/N/PvoeMB8GA1UdIwQY
MBaAFKilona8uRBPBulOGIbh4/N/PvoeMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBACnTAVurwUqCNN9UY4Thk7MLgkRJiplI2AnkO4Kqp6m1fxdG
mwlkVN+dovNHzQtbuqe95/djml9cZhV/6lTH8+udiqTQqn+6/c91ZF5K8TDo1Z1W
I88WfX+8sFOFl3cK4E8h0cvHwKk60HEuDoQ6pbDjbhbBPGgb5VenPquq+engQHhQ
hR7sTc6fZ0uH9ywfKWz59jC8XaTyoYEgLTYFqERChOtN27lOvIF7t36poViMGgcb
uSQAV92sS29nHz36z78n9E14YtCeQa1uRaArSWUQNN0zF4ipSID4IeFLlPlIm2Gf
Z5hFqzYlfeTB0ve/kbd9ZGApWDlq6ZfF7FWyQHE=
-----END CERTIFICATE-----`;

// PKCS#8 (DER, base64) private key matching the certificate above.
// Loaded from the build env (VITE_QZ_PRIVATE_KEY in .env) so the secret is NOT
// committed to source control. The compiled dist still embeds it for signing.
const PRIVATE_KEY_PK8_B64: string = import.meta.env.VITE_QZ_PRIVATE_KEY || '';

const SIGN_ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' } as const;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

let keyPromise: Promise<CryptoKey> | null = null;
function getPrivateKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'pkcs8',
      b64ToBytes(PRIVATE_KEY_PK8_B64),
      SIGN_ALGO,
      false,
      ['sign'],
    );
  }
  return keyPromise;
}

/** Wire QZ Tray's certificate + signature promises for signed (trusted) requests. */
export function configureQzSecurity(qz: any): void {
  qz.security.setCertificatePromise((resolve: (cert: string) => void) => resolve(CERT_PEM));
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) => {
    return (resolve: (sig: string) => void, reject: (err: any) => void) => {
      getPrivateKey()
        .then(key => crypto.subtle.sign(SIGN_ALGO, key, new TextEncoder().encode(toSign)))
        .then(sig => resolve(bytesToB64(sig)))
        .catch(reject);
    };
  });
}
