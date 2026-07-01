const cors = require('../lib/cors');

const SMILES_SEARCH_URL = 'https://api-air-flightsearch-blue.smiles.com.ar/v1/airlines/search';

function smilesHeaders() {
  return {
    'accept':          'application/json, text/plain, */*',
    'accept-language': 'es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'channel':         'Mobile',
    'language':        'es-ES',
    'origin':          'https://www.smiles.com.ar',
    'referer':         'https://www.smiles.com.ar/',
    'region':          'ARGENTINA',
    'x-api-key':       process.env.SMILES_API_KEY,
    'user-agent':      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  };
}

function buildUrl(orig, dest, fecha) {
  return SMILES_SEARCH_URL +
    '?adults=1&cabinType=all&children=0&currencyCode=ARS' +
    '&departureDate=' + fecha +
    '&destinationAirportCode=' + dest +
    '&infants=0&isFlexibleDateChecked=false' +
    '&originAirportCode=' + orig +
    '&tripType=1&forceCongener=false' +
    '&memberNumber=' + process.env.SMILES_MEMBER + '&r=ar';
}

// Reemplaza al proxy local smiles-proxy.js: pasa la respuesta de Smiles tal cual.
module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orig, dest, fecha } = req.query;
  if (!orig || !dest || !fecha) {
    return res.status(400).json({ error: 'Params necesarios: orig, dest, fecha' });
  }

  try {
    const r = await fetch(buildUrl(orig, dest, fecha), { headers: smilesHeaders() });
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
