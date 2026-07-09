const cors = require('../lib/cors');
const { isAuthenticated } = require('../lib/auth');
const { getSheetsClient, SHEET_ID } = require('../lib/sheets');
const { getGmailClient, buscarEmailPorCodigo, mapConcurrencia } = require('../lib/gmail');
const { parsearConfirmacion, iataACiudad, padHora, MESES } = require('../lib/jetsmart');

const SHEET_VUELOS = 'Vuelos JetSMART';

// Columnas de la hoja (0-indexed) para cada tramo, en el mismo orden que construirFila().
const COL_IDA    = { fecha: 6,  vuelo: 7,  origen: 8,  salida: 9,  destino: 10, llegada: 11 };
const COL_VUELTA = { fecha: 12, vuelo: 13, origen: 14, salida: 15, destino: 16, llegada: 17 };

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_VUELOS}!A1:R500`,
    });
    const data  = resp.data.values || [];
    const filas = data.slice(1);

    const porCodigo = {};
    filas.forEach((f, i) => { if (f[0]) porCodigo[f[0].trim()] = { fila: i + 2, row: f }; });
    const codigos = Object.keys(porCodigo);

    // Busqueda dirigida por codigo (no un escaneo de los ultimos N emails):
    // asi una reserva vieja con un cambio real no se pierde solo porque hay
    // muchos emails mas nuevos de otras reservas en el medio.
    const gmail = getGmailClient();
    const bodiesPorCodigo = await mapConcurrencia(codigos, 8, codigo => buscarEmailPorCodigo(gmail, codigo));

    const cambios = [];
    const data2update = [];

    codigos.forEach((codigo, i) => {
      const body = bodiesPorCodigo[i];
      if (!body) return; // sin email de itinerario para esta reserva

      const parsed = parsearConfirmacion(body);
      if (!parsed || parsed.codigo !== codigo) return;

      const existente = porCodigo[codigo];

      const diffs = [];
      const updates = {};

      compararTramo('IDA', parsed.ida, existente.row, COL_IDA, diffs, updates);
      compararTramo('VUELTA', parsed.vuelta, existente.row, COL_VUELTA, diffs, updates);

      if (diffs.length === 0) return;

      // Si cambió la fecha de ida, recalcular Año/Mes (columnas E/F)
      if (updates[COL_IDA.fecha] !== undefined) {
        const partes = updates[COL_IDA.fecha].split('/');
        updates[4] = partes[2] || '';
        updates[5] = partes[1] ? MESES[parseInt(partes[1]) - 1] : '';
      }

      updates[1] = 'Pendiente'; // columna B: estado

      Object.keys(updates).forEach(col => {
        const letra = String.fromCharCode(65 + parseInt(col));
        data2update.push({ range: `${SHEET_VUELOS}!${letra}${existente.fila}`, values: [[updates[col]]] });
      });

      cambios.push({ codigo: parsed.codigo, titular: parsed.titular, cambios: diffs });
    });

    if (data2update.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        // RAW (no USER_ENTERED): los valores ya vienen formateados exactamente
        // como deben guardarse (dd/mm/yyyy, HH:MM) — USER_ENTERED hace que Sheets
        // los reinterprete como fecha/hora reales y a veces los reformatea
        // (ej. pierde el cero a la izquierda del dia).
        requestBody: { valueInputOption: 'RAW', data: data2update },
      });
    }

    res.json(cambios);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

function compararTramo(nombre, tramo, row, col, diffs, updates) {
  const fechaGuardada = (row[col.fecha] || '').trim();

  if (!tramo) {
    // El email ya no tiene este tramo (ej: pasó de ida y vuelta a solo ida).
    if (fechaGuardada) {
      diffs.push({ campo: nombre + ' fecha', antes: fechaGuardada, ahora: '(sin tramo)' });
      Object.keys(col).forEach(campo => { updates[col[campo]] = ''; });
    }
    return;
  }

  const nuevo = {
    fecha:   tramo.fecha || '',
    vuelo:   tramo.vuelo || '',
    origen:  tramo.origen  ? iataACiudad(tramo.origen)  : '',
    salida:  padHora(tramo.salida),
    destino: tramo.destino ? iataACiudad(tramo.destino) : '',
    llegada: padHora(tramo.llegada),
  };

  // Campos donde solo comparamos "en sustancia" (ignorando acentos/mayúsculas u
  // horas sin ceros a la izquierda) para no disparar falsos cambios de formato.
  const NORMALIZAR = { origen: normalizarCiudad, destino: normalizarCiudad, salida: padHora, llegada: padHora };

  Object.keys(nuevo).forEach(campo => {
    const antesRaw = (row[col[campo]] || '').trim();
    const ahora = nuevo[campo];
    if (!ahora) return;
    const normalizar = NORMALIZAR[campo];
    const sonIguales = normalizar ? normalizar(antesRaw) === normalizar(ahora) : antesRaw === ahora;
    if (!sonIguales) {
      diffs.push({ campo: nombre + ' ' + campo, antes: antesRaw || '(vacío)', ahora });
      updates[col[campo]] = ahora;
    }
  });
}

function normalizarCiudad(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
