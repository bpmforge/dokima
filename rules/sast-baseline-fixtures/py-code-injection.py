# Fixture for rules/sast-baseline/py-code-injection.yaml. Deliberately unsafe; never run.
import ast


def handle(request):
    # ruleid: py-eval-exec-dynamic
    eval(request.args["expr"])
    # ruleid: py-eval-exec-dynamic
    exec("x = " + request.form["value"])
    # ok: py-eval-exec-dynamic
    eval("1 + 1")
    # ok: py-eval-exec-dynamic
    return ast.literal_eval(request.args["expr"])
