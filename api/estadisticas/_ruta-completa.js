const { obtenerVuelosRutaCompleta } = require('../../lib/jetsmart');

module.exports = async function(req, res) {
  try {
    const vuelos = await obtenerVuelosRutaCompleta();
    res.json(vuelos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
