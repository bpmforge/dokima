# Fixture for rules/sast-baseline/py-command-injection.yaml. Deliberately unsafe; never run.
import os
import subprocess


def run(name):
    # ruleid: py-os-system-dynamic
    os.system("tar -xf " + name)
    # ruleid: py-os-system-dynamic
    os.popen(f"ls {name}")
    # ok: py-os-system-dynamic
    os.system("make clean")

    # ruleid: py-subprocess-shell-dynamic
    subprocess.run(f"grep {name} /var/log/app.log", shell=True)
    # ruleid: py-subprocess-shell-dynamic
    subprocess.check_output("cat " + name, shell=True)
    # ok: py-subprocess-shell-dynamic
    subprocess.run(["grep", name, "/var/log/app.log"])
    # ok: py-subprocess-shell-dynamic
    subprocess.run("make test", shell=True)
