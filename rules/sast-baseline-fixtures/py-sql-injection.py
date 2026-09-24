# Fixture for rules/sast-baseline/py-sql-injection.yaml. Deliberately unsafe; never run.


def lookup(cursor, name, user_id):
    # ruleid: py-sql-string-built
    cursor.execute("SELECT * FROM users WHERE name = '%s'" % name)
    # ruleid: py-sql-string-built
    cursor.execute(f"DELETE FROM sessions WHERE user_id = '{user_id}'")
    # ruleid: py-sql-string-built
    cursor.execute("SELECT * FROM users WHERE name = '{}'".format(name))
    query = "UPDATE users SET name = '%s'" % name
    # ruleid: py-sql-string-built
    cursor.execute(query)
    # ok: py-sql-string-built
    cursor.execute("SELECT * FROM users WHERE name = %s", (name,))
    # ok: py-sql-string-built
    cursor.execute("SELECT count(*) FROM users")


def search(cursor, statuses, request):
    placeholders = ",".join("?" for _ in statuses)
    # ok: py-sql-string-built
    cursor.execute(f"SELECT id FROM tickets WHERE status IN ({placeholders})", statuses)
    # ruleid: py-sql-string-built, py-sql-request-data
    cursor.execute("SELECT * FROM tickets WHERE id = '" + request.args["id"] + "'")
    # ok: py-sql-request-data
    cursor.execute("SELECT * FROM tickets WHERE id = ?", (request.args["id"],))
