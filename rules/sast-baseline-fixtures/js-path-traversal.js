// Fixture for rules/sast-baseline/js-path-traversal.yaml. Deliberately unsafe; never run.
const fs = require('fs');
const path = require('path');

function routes(app) {
  app.get('/files/:name', (req, res) => {
    const target = path.join('/srv/files', req.params.name);
    // ruleid: js-request-path-traversal
    fs.readFile(target, (err, data) => res.send(data));
  });
  app.get('/download', (req, res) => {
    // ruleid: js-request-path-traversal
    res.sendFile(req.query.file);
  });
  app.get('/safe/:name', (req, res) => {
    const target = path.join('/srv/files', path.basename(req.params.name));
    // ok: js-request-path-traversal
    fs.readFile(target, (err, data) => res.send(data));
  });
  app.get('/static', (req, res) => {
    // ok: js-request-path-traversal
    fs.readFile('/srv/files/index.html', (err, data) => res.send(data));
  });
}
module.exports = routes;
