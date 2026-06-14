# -*- coding: utf-8 -*-
import base64
import logging
import os

from odoo import http
from odoo.http import request, Response

_logger = logging.getLogger(__name__)

PRIVATE_KEY_PATH = "/etc/odoo/qz_private.key"


class QZSignController(http.Controller):
    """
    Signs QZ Tray print requests with the private RSA key so that QZ Tray
    permanently trusts odoo.robifel.in without prompting the user each time.
    """

    @http.route("/qz/sign", type="http", auth="public", methods=["POST"], csrf=False)
    def sign_message(self, **kwargs):
        """
        Receives the raw message string from QZ Tray's signaturePromise,
        signs it with SHA-512 + RSA, and returns the base64 signature.
        """
        _logger.info("QZ Signing request received for message: %s", kwargs.get("message"))
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import padding

            message = (kwargs.get("message") or "").encode("utf-8")

            if not os.path.exists(PRIVATE_KEY_PATH):
                _logger.error("QZ private key not found at %s", PRIVATE_KEY_PATH)
                return Response("Private key not found. Run generate_qz_cert.py first.", status=500)

            with open(PRIVATE_KEY_PATH, "rb") as f:
                private_key = serialization.load_pem_private_key(f.read(), password=None)

            signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())
            sig_b64 = base64.b64encode(signature).decode("ascii")
            _logger.info("QZ Signing successful. Signature: %s...", sig_b64[:20])
            return Response(
                sig_b64,
                content_type="text/plain",
                status=200,
            )
        except Exception as e:
            _logger.exception("QZ signing failed: %s", e)
            return Response("Signing error: %s" % str(e), status=500)

    @http.route("/qz/cert", type="http", auth="public", methods=["GET"])
    def get_certificate(self, **kwargs):
        """
        Serves the public certificate PEM so QZ Tray JS can fetch it
        dynamically (alternative to serving from /static/).
        """
        cert_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "static", "src", "cert", "qz-cert.pem",
        )
        if not os.path.exists(cert_path):
            return Response("Certificate not found. Run generate_qz_cert.py first.", status=404)

        with open(cert_path, "r") as f:
            cert_pem = f.read()

        return Response(cert_pem, content_type="text/plain", status=200)
