// buscar_vuelos.js
// Uso: node buscar_vuelos.js <ORIGEN> <DESTINO> <FECHA>
// Ej:  node buscar_vuelos.js RES AEP 15/07/2026

const puppeteer = require('puppeteer');
const https     = require('https');
const { authenticate } = require('./auth');
const { google }       = require('googleapis');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const RESULT_SHEET   = 'Búsqueda Vuelos';

// ── Helpers de fecha ──────────────────────────────────────────
function parseDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error('Fecha inválida. Usar DD/MM/YYYY o YYYY-MM-DD');
}
function toDisplay(d) { const [y,m,dd]=d.split('-'); return `${dd}/${m}/${y}`; }
function toYMD(d)     { return d.replace(/-/g,''); }  // YYYYMMDD para URLs

// ── Fetch JSON simple ─────────────────────────────────────────
function fetchJSON(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        ...extraHeaders,
      },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Browser compartido ────────────────────────────────────────
let _browser = null;
async function getBrowser() {
  if (!_browser) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return _browser;
}

async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 800 });
  return page;
}

// ── 1. JetSMART ───────────────────────────────────────────────
// La API ya devuelve precios en f.p.ars (base) y f.pi.ars (total con impuestos)
async function fetchJetSmart(orig, dest, date) {
  console.log('\n[JetSMART] Consultando...');
  const today  = new Date().toISOString().split('T')[0];
  const future = new Date(Date.now() + 400*24*60*60*1000).toISOString().split('T')[0];

  const apiUrl =
    'https://origin.jsrtff.it.jetsm.art/availability/plain' +
    '?_agg=&_meta=' +
    '&bt_date=' + encodeURIComponent(today  + ' 00:00:00') +
    '&bt_date=' + encodeURIComponent(future + ' 24:00:00') +
    '&pov_c=AR&dep=' + orig;

  try {
    const json = await fetchJSON(apiUrl, { Referer: 'https://jetsmart.com/' });
    const flights = (json.availability || [])
      .filter(f => f.arr === dest && f.date.startsWith(date))
      .map(f => ({
        platform:    'JetSMART',
        flight:      (f.cc || 'JA') + f.fn,
        origin:      f.dep,
        dest:        f.arr,
        date:        f.date.substring(0, 10),
        depTime:     f.date.substring(11, 16),
        arrTime:     '',
        price:       f.p  && f.p.ars  ? Math.round(f.p.ars)  : null, // precio base
        priceTotal:  f.pi && f.pi.ars ? Math.round(f.pi.ars) : null, // con impuestos
        taxes:       f.i  && f.i.ars  ? Math.round(f.i.ars)  : null,
        seats:       f.s  || null,
        currency:    'ARS',
        airline:     'JetSMART',
      }));
    console.log(`[JetSMART] ${flights.length} vuelo(s) encontrado(s).`);
    return flights;
  } catch (e) {
    console.log('[JetSMART] Error:', e.message);
    return [];
  }
}

// ── 2. Aerolíneas Argentinas ──────────────────────────────────
async function fetchAerolineas(orig, dest, date) {
  console.log('\n[Aerolíneas] Consultando...');
  const page = await newPage();
  const results = [];

  try {
    const captured = [];
    page.on('response', async res => {
      const ct  = res.headers()['content-type'] || '';
      const url = res.url();
      if (!ct.includes('json')) return;
      // Filtrar solo llamadas relevantes
      if (!/flight|fare|availability|search|segment/i.test(url)) return;
      try {
        const body = await res.text();
        if (body.length > 100) captured.push({ url, body });
      } catch {}
    });

    const searchUrl =
      `https://www.aerolineas.com.ar/es-ar/vuelos/buscar` +
      `?tipodeviaje=ida&clase=Y&origen=${orig}&destino=${dest}` +
      `&ida=${date}&adultos=1&ninios=0&bebes=0`;

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 50000 });
    await new Promise(r => setTimeout(r, 6000));

    // Parsear respuestas JSON capturadas
    for (const { url, body } of captured) {
      try {
        const json = JSON.parse(body);
        const extracted = parseARFlights(json, orig, dest, date);
        if (extracted.length > 0) { results.push(...extracted); break; }
      } catch {}
    }

    // Fallback: DOM
    if (results.length === 0) {
      const domData = await page.evaluate((o, d, dt) => {
        const found = [];
        const cards = document.querySelectorAll(
          '[class*="result-item"], [class*="flight-card"], [class*="vuelo"], [data-test*="flight"]'
        );
        cards.forEach(card => {
          const priceEl = card.querySelector('[class*="price"], [class*="precio"], [class*="amount"], [class*="fare"]');
          const depEl   = card.querySelector('[class*="departure"], [class*="salida"], [class*="dep-time"]');
          const arrEl   = card.querySelector('[class*="arrival"],   [class*="llegada"], [class*="arr-time"]');
          if (priceEl) {
            const rawPrice = priceEl.textContent.replace(/[^0-9]/g, '');
            found.push({
              platform: 'Aerolíneas Argentinas',
              flight:   '',
              origin:   o, dest: d, date: dt,
              depTime:  depEl ? depEl.textContent.trim().substring(0, 5) : '',
              arrTime:  arrEl ? arrEl.textContent.trim().substring(0, 5) : '',
              price:    rawPrice ? parseInt(rawPrice, 10) : null,
              currency: 'ARS',
              airline:  'Aerolíneas Argentinas',
            });
          }
        });
        return found;
      }, orig, dest, date);
      results.push(...domData);
    }
  } catch (e) {
    console.log('[Aerolíneas] Error:', e.message.substring(0, 100));
  } finally {
    await page.close();
  }

  console.log(`[Aerolíneas] ${results.length} resultado(s).`);
  return results;
}

function parseARFlights(json, orig, dest, date) {
  const results = [];
  // Formato Sabre/NDC o propio de AR
  const lists = [
    json.flights, json.Flights,
    json.availabilityFlights, json.data?.flights,
    json.itineraries, json.results,
  ].filter(Boolean);

  for (const list of lists) {
    if (!Array.isArray(list) || list.length === 0) continue;
    list.forEach(f => {
      const dep  = extractTime(f.departureDateTime || f.departure || f.dep || f.departureTime);
      const arr  = extractTime(f.arrivalDateTime   || f.arrival   || f.arr || f.arrivalTime);
      const num  = f.flightNumber || f.number || f.flightDesignator || '';
      const fare = f.price || f.fare || f.lowestFare || f.amount ||
                   f.fares?.[0]?.amount || f.fares?.[0]?.price;
      results.push({
        platform:  'Aerolíneas Argentinas',
        flight:    num ? ('AR' + num) : '',
        origin:    orig, dest, date,
        depTime:   dep, arrTime: arr,
        price:     fare != null ? Math.round(Number(fare)) : null,
        currency:  'ARS',
        airline:   'Aerolíneas Argentinas',
      });
    });
    if (results.length > 0) break;
  }
  return results;
}

// ── 3. TurismoCity ────────────────────────────────────────────
async function fetchTurismoCity(orig, dest, date) {
  console.log('\n[TurismoCity] Consultando...');
  const page = await newPage();
  const results = [];

  try {
    const captured = [];
    page.on('response', async res => {
      const ct  = res.headers()['content-type'] || '';
      const url = res.url();
      if (!ct.includes('json')) return;
      if (!/flight|fare|result|search|itinerar/i.test(url)) return;
      try {
        const body = await res.text();
        if (body.length > 100) captured.push({ url, body });
      } catch {}
    });

    // TurismoCity URLs a probar
    const candidates = [
      `https://www.turismocity.com.ar/vuelos/resultado?origen=${orig}&destino=${dest}&ida=${date}&adultos=1&clase=economy&tipoDeViaje=ida&moneda=ARS`,
      `https://www.turismocity.com.ar/vuelos/${orig}/${dest}/${date}?pasajeros=1&moneda=ARS&idioma=es-AR`,
    ];

    for (const url of candidates) {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
        await new Promise(r => setTimeout(r, 6000));
        if (captured.length > 0) break;
      } catch {}
    }

    // Parsear respuestas capturadas
    for (const { url, body } of captured) {
      try {
        const json = JSON.parse(body);
        const extracted = parseTCFlights(json, orig, dest, date);
        if (extracted.length > 0) { results.push(...extracted); break; }
      } catch {}
    }

    // Fallback DOM
    if (results.length === 0) {
      const domData = await page.evaluate((o, d, dt) => {
        const found = [];
        const cards = document.querySelectorAll(
          '[class*="result"], [class*="flight"], [class*="vuelo"], [class*="itinerary"]'
        );
        cards.forEach(card => {
          const priceEl = card.querySelector('[class*="price"], [class*="precio"], [class*="amount"]');
          const depEl   = card.querySelector('[class*="departure"], [class*="salida"]');
          const airEl   = card.querySelector('[class*="airline"], [class*="aerolinea"], [class*="carrier"]');
          if (priceEl) {
            const rawPrice = priceEl.textContent.replace(/[^0-9]/g, '');
            found.push({
              platform:  'TurismoCity',
              flight:    '',
              origin:    o, dest: d, date: dt,
              depTime:   depEl ? depEl.textContent.trim().substring(0, 5) : '',
              arrTime:   '',
              price:     rawPrice ? parseInt(rawPrice, 10) : null,
              currency:  'ARS',
              airline:   airEl ? airEl.textContent.trim() : 'TurismoCity',
            });
          }
        });
        return found;
      }, orig, dest, date);
      results.push(...domData);
    }
  } catch (e) {
    console.log('[TurismoCity] Error:', e.message.substring(0, 100));
  } finally {
    await page.close();
  }

  console.log(`[TurismoCity] ${results.length} resultado(s).`);
  return results;
}

function parseTCFlights(json, orig, dest, date) {
  const results = [];
  const lists = [
    json.flights, json.results, json.data,
    json.itineraries, json.options,
  ].filter(v => Array.isArray(v) && v.length > 0);

  for (const list of lists) {
    list.forEach(f => {
      const price = f.price ?? f.fare ?? f.amount ?? f.totalFare ??
                    f.fares?.[0]?.price ?? f.pricing?.total;
      results.push({
        platform: 'TurismoCity',
        flight:   f.flightNumber || f.flight || '',
        origin:   orig, dest, date,
        depTime:  extractTime(f.departureTime || f.departure),
        arrTime:  extractTime(f.arrivalTime   || f.arrival),
        price:    price != null ? Math.round(Number(price)) : null,
        currency: 'ARS',
        airline:  f.airline || f.carrier || f.airlineName || '',
      });
    });
    if (results.length > 0) break;
  }
  return results;
}

// ── Helpers ───────────────────────────────────────────────────
function extractTime(val) {
  if (!val) return '';
  const m = String(val).match(/(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function formatPrice(p) {
  if (p == null) return '';
  return Number(p).toLocaleString('es-AR');
}

// ── Escribir en Google Sheets ─────────────────────────────────
async function writeToSheets(allResults, orig, dest, date) {
  console.log('\nEscribiendo en Google Sheets...');
  const auth   = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  // Obtener o crear la hoja
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const existing = meta.data.sheets.find(s => s.properties.title === RESULT_SHEET);
  let sheetId;

  if (!existing) {
    const r = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: RESULT_SHEET } } }] },
    });
    sheetId = r.data.replies[0].addSheet.properties.sheetId;
  } else {
    sheetId = existing.properties.sheetId;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${RESULT_SHEET}!A1:Z300`,
    });
  }

  // Ordenar: primero los que tienen precio (de menor a mayor), luego los sin precio
  const withPrice    = allResults.filter(r => r.price != null).sort((a, b) => a.price - b.price);
  const withoutPrice = allResults.filter(r => r.price == null);
  const sorted = [...withPrice, ...withoutPrice];

  const headers   = ['Plataforma', 'Aerolínea', 'Vuelo', 'Salida', 'Llegada', 'Precio base', 'Impuestos', 'TOTAL ARS', 'Asientos', 'Origen', 'Destino', 'Fecha'];
  const COLS = headers.length;
  const dataRows  = sorted.map(r => [
    r.platform,
    r.airline      || r.platform,
    r.flight       || '',
    r.depTime      || '',
    r.arrTime      || '',
    r.price      != null ? formatPrice(r.price)      : '',
    r.taxes      != null ? formatPrice(r.taxes)      : '',
    r.priceTotal != null ? formatPrice(r.priceTotal) : (r.price != null ? formatPrice(r.price) : '(ver sitio)'),
    r.seats      != null ? r.seats                   : '',
    r.origin       || orig,
    r.dest         || dest,
    toDisplay(r.date || date),
  ]);

  const now     = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const values  = [
    [`✈  ${orig} → ${dest}  |  ${toDisplay(date)}`],
    [`Actualizado: ${now}   |   ${sorted.length} resultado(s)`],
    [],
    headers,
    ...dataRows,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${RESULT_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  // ── Formato ──────────────────────────────────────────────────
  const white    = { red:1, green:1, blue:1 };
  const darkBlue = { red:0.039, green:0.208, blue:0.369 };
  const midBlue  = { red:0.204, green:0.357, blue:0.541 };

  const platformBg = {
    'JetSMART':               { red:0.878, green:0.937, blue:0.988 }, // celeste
    'Aerolíneas Argentinas':  { red:0.984, green:0.937, blue:0.878 }, // naranja claro
    'TurismoCity':            { red:0.902, green:0.957, blue:0.878 }, // verde claro
  };

  const requests = [
    // Merge título y subtítulo
    { mergeCells: { range:{ sheetId, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex:COLS }, mergeType:'MERGE_ALL' } },
    { mergeCells: { range:{ sheetId, startRowIndex:1, endRowIndex:2, startColumnIndex:0, endColumnIndex:COLS }, mergeType:'MERGE_ALL' } },
    // Estilos título
    { repeatCell: { range:{ sheetId, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex:COLS },
      cell:{ userEnteredFormat:{ backgroundColor:darkBlue, horizontalAlignment:'CENTER', verticalAlignment:'MIDDLE',
        textFormat:{ foregroundColor:white, bold:true, fontSize:14 } } },
      fields:'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)' } },
    // Estilos subtítulo
    { repeatCell: { range:{ sheetId, startRowIndex:1, endRowIndex:2, startColumnIndex:0, endColumnIndex:COLS },
      cell:{ userEnteredFormat:{ backgroundColor:midBlue, horizontalAlignment:'CENTER',
        textFormat:{ foregroundColor:white, fontSize:10 } } },
      fields:'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)' } },
    // Estilos encabezado (fila 4)
    { repeatCell: { range:{ sheetId, startRowIndex:3, endRowIndex:4, startColumnIndex:0, endColumnIndex:COLS },
      cell:{ userEnteredFormat:{ backgroundColor:midBlue, horizontalAlignment:'CENTER',
        textFormat:{ foregroundColor:white, bold:true, fontSize:10 } } },
      fields:'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)' } },
    // Altura filas
    { updateDimensionProperties: { range:{ sheetId, dimension:'ROWS', startIndex:0, endIndex:1 }, properties:{ pixelSize:42 }, fields:'pixelSize' } },
    { updateDimensionProperties: { range:{ sheetId, dimension:'ROWS', startIndex:1, endIndex:2 }, properties:{ pixelSize:24 }, fields:'pixelSize' } },
    // Anchos: Plataforma, Aerolínea, Vuelo, Salida, Llegada, PrecioBase, Impuestos, Total, Asientos, Origen, Destino, Fecha
    ...[120, 160, 70, 65, 65, 100, 90, 110, 70, 70, 70, 90].map((w, i) => ({
      updateDimensionProperties: { range:{ sheetId, dimension:'COLUMNS', startIndex:i, endIndex:i+1 }, properties:{ pixelSize:w }, fields:'pixelSize' },
    })),
    // Congelar filas de encabezado
    { updateSheetProperties: { properties:{ sheetId, gridProperties:{ frozenRowCount:4 } }, fields:'gridProperties.frozenRowCount' } },
  ];

  // Color de fondo por plataforma + precio en negrita
  sorted.forEach((r, i) => {
    const rowIdx = 4 + i;
    const bg = platformBg[r.platform] || white;
    requests.push({
      repeatCell: { range:{ sheetId, startRowIndex:rowIdx, endRowIndex:rowIdx+1, startColumnIndex:0, endColumnIndex:COLS },
        cell:{ userEnteredFormat:{ backgroundColor:bg } },
        fields:'userEnteredFormat(backgroundColor)' },
    });
    // Precio en negrita (columna F = índice 5)
    requests.push({
      repeatCell: { range:{ sheetId, startRowIndex:rowIdx, endRowIndex:rowIdx+1, startColumnIndex:5, endColumnIndex:6 },
        cell:{ userEnteredFormat:{ textFormat:{ bold:true } } },
        fields:'userEnteredFormat(textFormat)' },
    });
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  console.log(`✅ Resultados escritos en la hoja "${RESULT_SHEET}"`);
}

// ── Resumen en consola ────────────────────────────────────────
function printSummary(allResults, orig, dest, date) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${orig} → ${dest}  |  ${toDisplay(date)}`);
  console.log(`${'─'.repeat(70)}`);

  if (allResults.length === 0) {
    console.log('  Sin resultados en ninguna plataforma.');
    return;
  }

  const withPrice = allResults.filter(r => r.price != null).sort((a, b) => a.price - b.price);
  const noPrice   = allResults.filter(r => r.price == null);

  [...withPrice, ...noPrice].forEach(r => {
    const base     = r.price      != null ? `base $${formatPrice(r.price)}` : '';
    const total    = r.priceTotal != null ? `  total $${formatPrice(r.priceTotal)} ARS` : (r.price == null ? '(sin precio)' : '');
    const seats    = r.seats      != null ? `  [${r.seats} asientos]` : '';
    const timeStr  = r.depTime ? `${r.depTime}` : '';
    const flight   = r.flight ? `${r.flight}` : '';
    console.log(`  ${flight.padEnd(8)} ${timeStr.padEnd(6)} ${(r.airline||r.platform).padEnd(26)} ${base.padEnd(18)} ${total}${seats}`);
  });
  console.log(`${'─'.repeat(70)}\n`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Uso: node buscar_vuelos.js <ORIGEN> <DESTINO> <FECHA>');
    console.log('Ej:  node buscar_vuelos.js RES AEP 15/07/2026');
    process.exit(1);
  }

  const orig = args[0].toUpperCase();
  const dest = args[1].toUpperCase();
  const date = parseDate(args[2]);

  console.log(`\n🔍 Buscando vuelos ${orig} → ${dest} para el ${toDisplay(date)}`);
  console.log('(Aerolíneas y TurismoCity usan Puppeteer — puede tardar ~30 seg)\n');

  const allResults = [];

  const js = await fetchJetSmart(orig, dest, date);
  allResults.push(...js);

  const ar = await fetchAerolineas(orig, dest, date);
  allResults.push(...ar);

  const tc = await fetchTurismoCity(orig, dest, date);
  allResults.push(...tc);

  if (_browser) { await _browser.close(); _browser = null; }

  printSummary(allResults, orig, dest, date);

  if (allResults.length > 0) {
    await writeToSheets(allResults, orig, dest, date);
  } else {
    console.log('No se encontraron resultados. Verificá los códigos IATA y la fecha.');
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
  if (_browser) _browser.close();
  process.exit(1);
});
