// Dry-run de verificar-cambios-vuelos: NO escribe nada, solo reporta.
require('dotenv').config({ quiet: true });
const { getSheetsClient, SHEET_ID } = require('./lib/sheets');
const { getGmailClient, buscarEmailPorCodigo, mapConcurrencia } = require('./lib/gmail');
const { parsearConfirmacion, iataACiudad, padHora } = require('./lib/jetsmart');

const SHEET_VUELOS = 'Vuelos JetSMART';
const COL_IDA    = { fecha: 6,  vuelo: 7,  origen: 8,  salida: 9,  destino: 10, llegada: 11 };
const COL_VUELTA = { fecha: 12, vuelo: 13, origen: 14, salida: 15, destino: 16, llegada: 17 };

function normalizarCiudad(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function compararTramo(nombre, tramo, row, col, diffs) {
  const fechaGuardada = (row[col.fecha] || '').trim();
  if (!tramo) {
    if (fechaGuardada) diffs.push({ campo: nombre + ' fecha', antes: fechaGuardada, ahora: '(sin tramo)' });
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
  const NORMALIZAR = { origen: normalizarCiudad, destino: normalizarCiudad, salida: padHora, llegada: padHora };
  Object.keys(nuevo).forEach(campo => {
    const antesRaw = (row[col[campo]] || '').trim();
    const ahora = nuevo[campo];
    if (!ahora) return;
    const normalizar = NORMALIZAR[campo];
    const sonIguales = normalizar ? normalizar(antesRaw) === normalizar(ahora) : antesRaw === ahora;
    if (!sonIguales) diffs.push({ campo: nombre + ' ' + campo, antes: antesRaw || '(vacío)', ahora });
  });
}

(async () => {
  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SHEET_VUELOS}!A1:R500` });
  const filas = (resp.data.values || []).slice(1);
  const porCodigo = {};
  filas.forEach((f, i) => { if (f[0]) porCodigo[f[0].trim()] = { fila: i + 2, row: f }; });
  const codigos = Object.keys(porCodigo);

  const gmail = getGmailClient();
  const bodies = await mapConcurrencia(codigos, 8, c => buscarEmailPorCodigo(gmail, c));

  let sinCambios = 0, conCambios = 0, sinEmail = 0;
  codigos.forEach((codigo, i) => {
    const body = bodies[i];
    if (!body) { sinEmail++; return; }
    const parsed = parsearConfirmacion(body);
    if (!parsed || parsed.codigo !== codigo) { console.log(codigo, '-> PARSEO FALLO'); return; }

    const existente = porCodigo[codigo];
    const diffs = [];
    compararTramo('IDA', parsed.ida, existente.row, COL_IDA, diffs);
    compararTramo('VUELTA', parsed.vuelta, existente.row, COL_VUELTA, diffs);

    if (diffs.length === 0) { sinCambios++; return; }
    conCambios++;
    console.log('\n=== ' + codigo + ' (' + parsed.titular + ') ===');
    diffs.forEach(d => console.log('  CAMBIO', d.campo + ':', d.antes, '->', d.ahora));
  });
  console.log('\n---RESUMEN---');
  console.log('Sin email:', sinEmail, '| Sin cambios:', sinCambios, '| Con cambios:', conCambios);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
