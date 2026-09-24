# Fixture for rules/sast-baseline/py-deserialization.yaml. Deliberately unsafe; never run.
import json
import pickle

import yaml


def load(blob, text):
    # ruleid: py-unsafe-deserialization
    a = pickle.loads(blob)
    # ok: py-unsafe-deserialization
    b = json.loads(text)

    # ruleid: py-yaml-unsafe-load
    c = yaml.load(text, Loader=yaml.Loader)
    # ruleid: py-yaml-unsafe-load
    d = yaml.unsafe_load(text)
    # ok: py-yaml-unsafe-load
    e = yaml.safe_load(text)
    # ok: py-yaml-unsafe-load
    f = yaml.load(text, Loader=yaml.SafeLoader)
    return [a, b, c, d, e, f]
