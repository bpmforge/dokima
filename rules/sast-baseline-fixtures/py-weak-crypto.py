# Fixture for rules/sast-baseline/py-weak-crypto.yaml. Deliberately unsafe; never run.
import hashlib

from Crypto.Cipher import AES, DES
from cryptography.hazmat.primitives.ciphers import algorithms, modes


def digest(data, key):
    # ruleid: py-weak-hash
    a = hashlib.md5(data).hexdigest()
    # ruleid: py-weak-hash
    b = hashlib.new("sha1", data).hexdigest()
    # ok: py-weak-hash
    c = hashlib.sha256(data).hexdigest()
    # ok: py-weak-hash
    d = hashlib.md5(data, usedforsecurity=False).hexdigest()

    # ruleid: py-weak-cipher
    e = DES.new(key, DES.MODE_CBC)
    # ruleid: py-weak-cipher
    f = AES.new(key, AES.MODE_ECB)
    # ruleid: py-weak-cipher
    g = modes.ECB()
    # ok: py-weak-cipher
    h = AES.new(key, AES.MODE_GCM)
    # ok: py-weak-cipher
    i = algorithms.AES(key)
    return [a, b, c, d, e, f, g, h, i]
