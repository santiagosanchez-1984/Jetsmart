const cors = require('../lib/cors');
const { isAuthenticated } = require('../lib/auth');
const { getSheetsClient, SHEET_ID } = require('../lib/sheets');

const SHEET_VUELOS = 'Vuelos JetSMART';

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  try {
    const { codigo, campo, valor } = req.body;
    const col = campo === 'estado' ? 2 : 3; // B=Estado, C=Rep

    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A2:A500`,
    });

    const data = resp.data.values || [];
    const idx = data.findIndex(r => r[0] && r[0].trim() === codigo);
    if (idx < 0) return res.json({ ok: false, msg: 'Código no encontrado' });

    const letra = col === 2 ? 'B' : 'C';
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!${letra}${idx + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[valor]] },
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, msg: e.message });
  }
};
