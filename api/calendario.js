const cors = require('../lib/cors');
const { isAuthenticated } = require('../lib/auth');
const { ciudadAIata, buscarCalendarioAPI } = require('../lib/jetsmart');

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });

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
