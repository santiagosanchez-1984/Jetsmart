const cors = require('../../lib/cors');
const { isAuthenticated } = require('../../lib/auth');
const { obtenerVuelosRutaCompleta } = require('../../lib/jetsmart');

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });

  try {
    const vuelos = await obtenerVuelosRutaCompleta();
    res.json(vuelos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
