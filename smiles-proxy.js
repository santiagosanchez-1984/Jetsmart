'use strict';
var http  = require('http');
var https = require('https');
var zlib  = require('zlib');
var urlM  = require('url');

var API_KEY    = 'aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw';
var MEMBER_NUM = '172264702';
var PORT       = 3131;

function buildSmilesPath(orig, dest, fecha) {
  return '/v1/airlines/search' +
    '?adults=1&cabinType=all&children=0&currencyCode=ARS' +
    '&departureDate=' + fecha +
    '&destinationAirportCode=' + dest +
    '&infants=0&isFlexibleDateChecked=false' +
    '&originAirportCode=' + orig +
    '&tripType=1&forceCongener=false' +
    '&memberNumber=' + MEMBER_NUM + '&r=ar';
}

function respond(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  var q = urlM.parse(req.url, true).query;
  if (!q.orig || !q.dest || !q.fecha) {
    respond(res, 400, JSON.stringify({ error: 'Params necesarios: orig, dest, fecha' }));
    return;
  }

  var options = {
    hostname: 'api-air-flightsearch-blue.smiles.com.ar',
    port: 443,
    path: buildSmilesPath(q.orig, q.dest, q.fecha),
    method: 'GET',
    headers: {
      'accept':              'application/json, text/plain, */*',
      'accept-encoding':     'gzip, deflate, br, zstd',
      'accept-language':     'es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7,es-419;q=0.6',
      'channel':             'Mobile',
      'language':            'es-ES',
      'origin':              'https://www.smiles.com.ar',
      'priority':            'u=1, i',
      'referer':             'https://www.smiles.com.ar/',
      'region':              'ARGENTINA',
      'sec-ch-ua':           '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
      'sec-ch-ua-mobile':    '?1',
      'sec-ch-ua-platform':  '"Android"',
      'sec-fetch-dest':      'empty',
      'sec-fetch-mode':      'cors',
      'sec-fetch-site':      'same-site',
      'x-api-key':           API_KEY,
      'user-agent':          'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36'
    }
  };

  var apiReq = https.request(options, function(apiRes) {
    var chunks = [];
    apiRes.on('data', function(c) { chunks.push(c); });
    apiRes.on('end', function() {
      var buf      = Buffer.concat(chunks);
      var enc      = apiRes.headers['content-encoding'];
      var code     = apiRes.statusCode;
      var route    = q.orig + '->' + q.dest + ' ' + q.fecha;

      function finish(body) {
        console.log(route + ': HTTP ' + code + ' (' + body.length + ' bytes)');
        if (code !== 200) console.log('  body:', body.substring(0, 300));
        respond(res, code, body);
      }

      if (enc === 'gzip') {
        zlib.gunzip(buf, function(e, d) { finish(e ? buf.toString() : d.toString()); });
      } else if (enc === 'deflate') {
        zlib.inflate(buf, function(e, d) { finish(e ? buf.toString() : d.toString()); });
      } else {
        finish(buf.toString());
      }
    });
  });

  apiReq.on('error', function(e) {
    respond(res, 500, JSON.stringify({ error: e.message }));
  });

  apiReq.end();

}).listen(PORT, '127.0.0.1', function() {
  console.log('');
  console.log('=== Smiles Proxy ===');
  console.log('Corriendo en http://localhost:' + PORT);
  console.log('Dejalo abierto mientras usas el tab Smiles.');
  console.log('Ctrl+C para detener.');
  console.log('');
});
