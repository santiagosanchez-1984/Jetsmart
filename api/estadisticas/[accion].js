// Vercel Hobby limita a 12 Serverless Functions por deploy; se unifican
// las 4 rutas de estadisticas en una sola funcion dinamica ([accion].js)
// para no superar el limite. Las URLs del frontend no cambian.
const cors = require('../../lib/cors');
const { isAuthenticated } = require('../../lib/auth');

const handlers = {
  'cargar':            require('./_cargar'),
  'guardar-base':       require('./_guardar-base'),
  'ruta-completa':      require('./_ruta-completa'),
  'verificar-cambios':  require('./_verificar-cambios'),
};

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });

  const handler = handlers[req.query.accion];
  if (!handler) return res.status(404).json({ error: 'No encontrado' });
  return handler(req, res);
};
