const cors = require('../lib/cors');
const checkAuth = require('../lib/basicAuth');
const { ciudadAIata, buscarCalendarioAPI } = require('../lib/jetsmart');

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req, res)) return;

  try {
    const { origen, destino } = req.query;
    const orig = ciudadAIata(origen);
    const dest = ciudadAIata(destino);
    const dias = await buscarCalendarioAPI(orig, dest);
    res.json(dias);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
