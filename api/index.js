const fs = require('fs');
const path = require('path');
const checkAuth = require('../lib/basicAuth');

const html = fs.readFileSync(path.join(__dirname, '../views/index.html'), 'utf8');

module.exports = async function(req, res) {
  if (!checkAuth(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
};
