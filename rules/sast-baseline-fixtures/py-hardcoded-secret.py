# Fixture for rules/sast-baseline/py-hardcoded-secret.yaml. Deliberately unsafe; never run.
# The values are made up and match no real credential format.
import os

import psycopg2

# ruleid: py-hardcoded-credential
DB_PASSWORD = "Tr0ub4dor&3.horse"
# ruleid: py-hardcoded-credential
conn = psycopg2.connect(host="db", password="q8Zr2xLm.fixture.9Kp")
# ruleid: py-hardcoded-credential
settings = {"client_secret": "fixture-0c7e1b5a9d"}

# ok: py-hardcoded-credential
password = os.environ["DB_PASSWORD"]
# ok: py-hardcoded-credential
PASSWORD_ENV = "APP_DB_PASSWORD"
# ok: py-hardcoded-credential
api_key = "<your-api-key>"
# ok: py-hardcoded-credential
secret = "short"
# ok: py-hardcoded-credential
local_client = psycopg2.connect(host="localhost", api_key="not-needed")
