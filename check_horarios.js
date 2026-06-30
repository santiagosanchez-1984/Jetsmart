const { authenticate } = require('./auth');
const { google } = require('googleapis');
const https = require('https');

const SPREADSHEET_ID = '1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE';
const MAIN_SHEET = 'Vuelos JetSMART';
const TODAY = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const CITY_TO_IATA = {
  'Buenos Aires (AEP)': 'AEP',
  'Buenos Aires (EZE)': 'EZE',
  'Resistencia':        'RES',
  'Córdoba':            'COR',
  'Neuquén':            'NQN',
  'Bariloche':          'BRC',
  'Ushuaia':            'USH',
  'Mendoza':            'MDZ',
  'Florianópolis':      'FLN',
  'Rio de Janeiro':     'GIG',
  'Asunción':           'ASU',
  'Santiago de Chile':  'SCL',
  'Puerto Iguazú':      'IGR',
  'El Calafate':        'FTE',
  'Tucumán':            'TUC',
};

function toIATA(cityName) {
  return CITY_TO_IATA[cityName] || cityName;
}

// DD/MM/YYYY → YYYY-MM-DD
function parseDMY(str) {
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// HH:MM:SS or HH:MM:SS from datetime string → HH:MM
function toHHMM(datetimeStr) {
  const m = datetimeStr.match(/(\d{2}:\d{2}):\d{2}$/);
  return m ? m[1] : datetimeStr.substring(11, 16);
}

const availabilityCache = {};

function fetchAvailability(depCode) {
  if (availabilityCache[depCode]) return Promise.resolve(availabilityCache[depCode]);

  const future = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url =
    'https://origin.jsrtff.it.jetsm.art/availability/plain' +
    '?_agg=&_meta=' +
    '&bt_date=' + encodeURIComponent(TODAY + ' 00:00:00') +
    '&bt_date=' + encodeURIComponent(future + ' 24:00:00') +
    '&pov_c=AR' +
    '&dep=' + depCode;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://jetsmart.com/',
      },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const flights = (json.availability || []).map(f => ({
            fn:   f.cc + f.fn,            // e.g. "JA3063"
            dep:  f.dep,
            arr:  f.arr,
            date: f.date.substring(0, 10), // YYYY-MM-DD
            time: toHHMM(f.date),          // HH:MM
          }));
          availabilityCache[depCode] = flights;
          resolve(flights);
        } catch (e) {
          reject(new Error(`Parse error for ${depCode}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`Timeout fetching ${depCode}`)); });
  });
}

// Find a specific flight in the availability list
function findFlight(flights, flightNum, date) {
  return flights.find(f => f.fn === flightNum && f.date === date) || null;
}

// When not found exactly, look for nearby flights (same fn ±5 days, or same date same route)
function findNearby(flights, flightNum, date, dest) {
  const target = new Date(date).getTime();
  const same    = flights.filter(f => f.fn === flightNum && Math.abs(new Date(f.date) - target) <= 5 * 86400000);
  const sameDay = flights.filter(f => f.date === date && f.fn !== flightNum && f.arr === dest);
  return { sameNumber: same, sameDay };
}

async function main() {
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${MAIN_SHEET}!A1:U200`,
  });

  const rows = res.data.values || [];
  const dataRows = rows.slice(1).filter(r => r[0] && /^[A-Z0-9]{6}$/.test(r[0]));

  // Columns (0-indexed):
  // 0=Código 1=ESTADO 2=¿Reprog? 3=Titular 4=Año 5=Mes
  // 6=FechaIda 7=VueloIda 8=OrigenIda 9=SalidaIda 10=DestinoIda 11=LlegadaIda
  // 12=FechaVuelta 13=VueloVuelta 14=OrigenVuelta 15=SalidaVuelta 16=DestinoVuelta 17=LlegadaVuelta

  const toCheck = [];
  for (const row of dataRows) {
    const estado = row[1] || '';
    if (estado !== 'Pendiente' && estado !== 'Abierto') continue;

    const codigo = row[0];
    const idaDate    = parseDMY(row[6]);
    const vueltaDate = parseDMY(row[12]);

    if (idaDate && idaDate >= TODAY) {
      toCheck.push({
        codigo, leg: 'IDA',
        flightNum: (row[7] || '').trim(),
        origin: toIATA(row[8] || ''),
        dest:   toIATA(row[10] || ''),
        date:   idaDate,
        storedTime: (row[9] || '').trim(),
      });
    }

    if (vueltaDate && vueltaDate >= TODAY && row[13]) {
      toCheck.push({
        codigo, leg: 'VUELTA',
        flightNum: (row[13] || '').trim(),
        origin: toIATA(row[14] || ''),
        dest:   toIATA(row[16] || ''),
        date:   vueltaDate,
        storedTime: (row[15] || '').trim(),
      });
    }
  }

  if (toCheck.length === 0) {
    console.log('No hay vuelos futuros Pendiente/Abierto para verificar.');
    return;
  }

  console.log(`Verificando ${toCheck.length} tramo(s)...\n`);

  const uniqueOrigins = [...new Set(toCheck.map(c => c.origin))];
  const availMap = {};
  for (const orig of uniqueOrigins) {
    process.stdout.write(`  Fetching disponibilidad desde ${orig}...`);
    availMap[orig] = await fetchAvailability(orig);
    console.log(` ${availMap[orig].length} vuelos`);
  }

  console.log();

  let changes = 0, ok = 0, notFound = 0;

  for (const item of toCheck) {
    const flights = availMap[item.origin] || [];
    const found = findFlight(flights, item.flightNum, item.date);

    const label = `${item.codigo} (${item.leg}) ${item.flightNum} ${item.origin}→${item.dest} ${item.date}`;

    if (!found) {
      const nearby = findNearby(flights, item.flightNum, item.date, item.dest);
      let hint = '';
      if (nearby.sameDay.length) {
        hint = ` → mismo día: ${nearby.sameDay.map(f => `${f.fn} ${f.time}`).join(', ')}`;
      } else if (nearby.sameNumber.length) {
        hint = ` → mismo vuelo: ${nearby.sameNumber.map(f => `${f.date} ${f.time}`).join(', ')}`;
      } else {
        hint = ` → sin alternativa cercana`;
      }
      console.log(`⚠️  NO ENCONTRADO  | ${label} | guardado: ${item.storedTime}${hint}`);
      notFound++;
    } else if (found.time !== item.storedTime) {
      console.log(`🔴 CAMBIO DE HORA  | ${label} | guardado: ${item.storedTime} → actual: ${found.time}`);
      changes++;
    } else {
      console.log(`✅ Sin cambios     | ${label} | ${item.storedTime}`);
      ok++;
    }
  }

  console.log(`\n--- Resumen ---`);
  console.log(`  Sin cambios:    ${ok}`);
  console.log(`  Cambios:        ${changes}`);
  console.log(`  No encontrados: ${notFound}`);
  if (changes > 0) console.log('\n⚠️  Hay cambios de horario. Actualizar la planilla.');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
});
