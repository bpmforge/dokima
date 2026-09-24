# Fixture for rules/sast-baseline/py-tls.yaml. Deliberately unsafe; never run.
import ssl

import requests


def fetch(url):
    # ruleid: py-tls-verification-disabled
    requests.get(url, verify=False)
    # ruleid: py-tls-verification-disabled
    ctx = ssl._create_unverified_context()
    # ruleid: py-tls-verification-disabled
    ctx.verify_mode = ssl.CERT_NONE
    # ok: py-tls-verification-disabled
    requests.get(url, verify="/etc/ssl/certs/internal-ca.pem")
    # ok: py-tls-verification-disabled
    good = ssl.create_default_context()
    return good
