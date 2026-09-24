# Fixture for rules/sast-baseline/py-path-traversal.yaml. Deliberately unsafe; never run.
import os

from flask import Flask, request, send_file
from werkzeug.utils import secure_filename

app = Flask(__name__)


@app.route("/read")
def read():
    name = request.args.get("name")
    # ruleid: py-request-path-traversal
    with open(os.path.join("/srv/files", name)) as fh:
        return fh.read()


@app.route("/download")
def download():
    # ruleid: py-request-path-traversal
    return send_file(request.args["file"])


@app.route("/safe")
def safe():
    name = secure_filename(request.args.get("name"))
    # ok: py-request-path-traversal
    with open(os.path.join("/srv/files", name)) as fh:
        return fh.read()


@app.route("/static")
def static_page():
    # ok: py-request-path-traversal
    return send_file("/srv/files/index.html")
