const cors = require('../../lib/cors');
const { obtenerVuelosRutaCompleta } = require('../../lib/jetsmart');

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const vuelos = await obtenerVuelosRutaCompleta();
    res.json(vuelos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
