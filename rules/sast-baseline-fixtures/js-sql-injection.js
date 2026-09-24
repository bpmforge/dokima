// Fixture for rules/sast-baseline/js-sql-injection.yaml. Deliberately unsafe; never run.
async function lookup(db, pool, req) {
  // ruleid: js-sql-string-built, js-sql-request-data
  await pool.query('SELECT * FROM users WHERE name = \'' + req.query.name + '\'');
  // ruleid: js-sql-string-built, js-sql-request-data
  db.prepare(`DELETE FROM sessions WHERE owner = '${req.params.owner}'`).run();
  // ruleid: js-sql-string-built, js-sql-request-data
  await pool.query(`UPDATE accounts SET email = '${req.body.email}' WHERE id = 1`);
  // ok: js-sql-string-built
  await pool.query('SELECT * FROM users WHERE name = $1', [req.query.name]);
  // ok: js-sql-string-built
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  // ok: js-sql-string-built
  // ruleid: js-sql-request-data
  await pool.query(`Hello ${req.query.name}, welcome`);
}
module.exports = lookup;

function search(db, req, filters) {
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  // ok: js-sql-string-built
  db.prepare(`SELECT * FROM notes ${where} ORDER BY id`).all();
  // ruleid: js-sql-request-data
  db.prepare(`SELECT * FROM notes WHERE id = ${req.params.id}`).get();
  // ok: js-sql-request-data
  db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
}
module.exports.search = search;
