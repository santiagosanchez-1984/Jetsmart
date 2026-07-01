function checkAuth(req, res) {
  var header = req.headers.authorization || '';
  var match  = header.match(/^Basic\s+(.+)$/i);
  var ok     = false;

  if (match) {
    var decoded = Buffer.from(match[1], 'base64').toString('utf8');
    var idx     = decoded.indexOf(':');
    var user    = idx >= 0 ? decoded.slice(0, idx) : decoded;
    var pass    = idx >= 0 ? decoded.slice(idx + 1) : '';
    ok = user === process.env.AUTH_USER && pass === process.env.AUTH_PASS;
  }

  if (!ok) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Mis Vuelos"');
    res.status(401).send('Autenticación requerida');
    return false;
  }
  return true;
}

module.exports = checkAuth;
