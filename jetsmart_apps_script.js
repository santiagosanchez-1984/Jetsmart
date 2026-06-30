// ============================================================
// JetSMART Verificador de Horarios — Google Apps Script
// Pegar en: Planilla → Extensiones → Apps Script
// ============================================================

const MAIN_SHEET   = 'Vuelos JetSMART';
const RESULT_SHEET = 'Verificación';
const SEARCH_SHEET = 'Buscar Vuelos';
const SEARCH_RESULT_SHEET = 'Resultados Búsqueda';
const NOTIFY_EMAIL = 'santiago.hector.sanchez@gmail.com';

const IATA_TO_CITY = {
  'AEP': 'Buenos Aires (AEP)',
  'EZE': 'Buenos Aires (EZE)',
  'RES': 'Resistencia',
  'COR': 'Córdoba',
  'NQN': 'Neuquén',
  'BRC': 'Bariloche',
  'USH': 'Ushuaia',
  'MDZ': 'Mendoza',
  'FLN': 'Florianópolis',
  'GIG': 'Rio de Janeiro',
  'ASU': 'Asunción',
  'SCL': 'Santiago de Chile',
  'IGR': 'Puerto Iguazú',
  'FTE': 'El Calafate',
  'TUC': 'Tucumán',
};

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

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

function toIATA(city) {
  return CITY_TO_IATA[String(city).trim()] || String(city).trim();
}

function fromIATA(code) {
  return IATA_TO_CITY[String(code).trim()] || String(code).trim();
}

// DD/MM/YYYY → YYYY-MM-DD
function parseDMY(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}

// YYYY-MM-DD → DD/MM/YYYY
function isoToDMY(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function getToday() {
  return Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
}

// Normaliza hora a HH:MM — acepta "9:30" o "09:30"
function normalizeTime(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (/^\d:\d{2}$/.test(s)) return '0' + s;
  return s;
}

function minuteDiff(stored, current) {
  const [sh, sm] = stored.split(':').map(Number);
  const [ch, cm] = current.split(':').map(Number);
  return (ch * 60 + cm) - (sh * 60 + sm);
}

function formatDiff(mins) {
  const abs  = Math.abs(mins);
  const sign = mins > 0 ? '+' : '-';
  const label = mins > 0 ? 'se atrasó' : 'se adelantó';
  if (abs === 0) return '0 min';
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const timeStr = h > 0
    ? h + 'h' + (m > 0 ? ' ' + m + 'min' : '')
    : m + 'min';
  return sign + timeStr + ' (' + label + ')';
}

// ── API JetSMART ─────────────────────────────────────────────
const availCache_ = {};

function fetchAvailability(depCode) {
  if (availCache_[depCode]) return availCache_[depCode];

  const today  = getToday();
  const future = Utilities.formatDate(
    new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
    'America/Argentina/Buenos_Aires', 'yyyy-MM-dd'
  );
  const url =
    'https://origin.jsrtff.it.jetsm.art/availability/plain' +
    '?_agg=&_meta=' +
    '&bt_date=' + encodeURIComponent(today  + ' 00:00:00') +
    '&bt_date=' + encodeURIComponent(future + ' 24:00:00') +
    '&pov_c=AR&dep=' + depCode;

  try {
    const resp = UrlFetchApp.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        'Referer': 'https://jetsmart.com/',
      },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) { availCache_[depCode] = []; return []; }
    const flights = (JSON.parse(resp.getContentText()).availability || []).map(f => ({
      fn:   f.cc + f.fn,
      dep:  f.dep,
      arr:  f.arr,
      date: f.date.substring(0, 10),
      time: f.date.substring(11, 16),
    }));
    availCache_[depCode] = flights;
    return flights;
  } catch (e) {
    Logger.log('Error fetching ' + depCode + ': ' + e.message);
    availCache_[depCode] = [];
    return [];
  }
}

function findFlight(flights, fn, date) {
  return flights.find(f => f.fn === fn && f.date === date) || null;
}

// Llamada desde el trigger diario — igual que verificarHorarios pero manda email
function verificarHorariosTrigger() {
  verificarHorarios_(true);
}

// ── Función principal ────────────────────────────────────────
function verificarHorarios() {
  verificarHorarios_(false);
}

function verificarHorarios_(sendEmail) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const main  = ss.getSheetByName(MAIN_SHEET);
  const today = getToday();

  // getDisplayValues() devuelve el texto exacto de cada celda (sin objetos Date)
  const data = main.getRange('A1:U200').getDisplayValues();
  const rows = data.slice(1).filter(r => r[0] && /^[A-Z0-9]{6}$/.test(r[0].trim()));

  // Columnas (0-indexed):
  // A=0 Código | B=1 ESTADO | C=2 ¿Reprog? | D=3 Titular | E=4 Año | F=5 Mes
  // G=6 FechaIda | H=7 VueloIda | I=8 OrigenIda | J=9 SalidaIda | K=10 DestinoIda | L=11 LlegadaIda
  // M=12 FechaVuelta | N=13 VueloVuelta | O=14 OrigenVuelta | P=15 SalidaVuelta | Q=16 DestinoVuelta

  const toCheck = [];
  for (const row of rows) {
    const estado = row[1].trim();
    if (estado !== 'Pendiente') continue;

    const codigo    = row[0].trim();
    const anio      = row[4].trim();
    const mes       = row[5].trim();
    const idaDate   = parseDMY(row[6]);    // col G
    const vueltaDate = parseDMY(row[12]); // col M

    // IDA — salida en columna J (índice 9)
    if (idaDate && idaDate >= today && row[7].trim()) {
      toCheck.push({
        codigo, leg: 'IDA', anio, mes,
        flightNum:  row[7].trim(),
        origin:     toIATA(row[8]),
        dest:       toIATA(row[10]),
        date:       idaDate,
        storedTime: normalizeTime(row[9]),   // col J
      });
    }

    // VUELTA — salida en columna P (índice 15)
    if (vueltaDate && vueltaDate >= today && row[13].trim()) {
      toCheck.push({
        codigo, leg: 'VUELTA', anio, mes,
        flightNum:  row[13].trim(),
        origin:     toIATA(row[14]),
        dest:       toIATA(row[16]),
        date:       vueltaDate,
        storedTime: normalizeTime(row[15]),  // col P
      });
    }
  }

  if (toCheck.length === 0) {
    SpreadsheetApp.getUi().alert('No hay vuelos futuros Pendiente/Abierto para verificar.');
    return;
  }

  // Traer disponibilidad de JetSMART por aeropuerto de origen
  const origins = [...new Set(toCheck.map(c => c.origin))];
  const availMap = {};
  for (const orig of origins) {
    availMap[orig] = fetchAvailability(orig);
  }

  // Comparar horario guardado vs horario actual en JetSMART
  const changed = [];
  for (const item of toCheck) {
    const flights = availMap[item.origin] || [];
    const found   = findFlight(flights, item.flightNum, item.date);
    if (found && found.time !== item.storedTime) {
      const diff = minuteDiff(item.storedTime, found.time);
      const reclamable = (diff > 59 || diff <= -15) ? 'Abierto' : 'NO ABIERTO';
      changed.push({
        codigo:      item.codigo,
        anio:        item.anio,
        mes:         item.mes,
        leg:         item.leg,
        flightNum:   item.flightNum,
        route:       item.origin + '→' + item.dest,
        date:        item.date,
        stored:      item.storedTime,
        current:     found.time,
        diff:        diff,
        diffLabel:   formatDiff(diff),
        reclamable:  reclamable,
      });
    }
  }

  // Actualizar columna B (ESTADO) en Vuelos JetSMART para los que son Abierto
  const codigosAbiertos = new Set(
    changed.filter(c => c.reclamable === 'Abierto').map(c => c.codigo)
  );
  if (codigosAbiertos.size > 0) {
    actualizarEstados_(main, rows, codigosAbiertos);
  }

  writeResults_(ss, changed, today);
  if (sendEmail && changed.length > 0) sendAlert_(changed, today);
}

// ── Actualizar ESTADO en hoja principal ──────────────────────
function actualizarEstados_(sheet, rows, codigosAbiertos) {
  // rows viene de getDisplayValues(), índice 0 = fila 2 de la hoja (fila 1 es header)
  for (let i = 0; i < rows.length; i++) {
    const codigo = rows[i][0].trim();
    if (codigosAbiertos.has(codigo)) {
      sheet.getRange(i + 2, 2).setValue('Abierto'); // columna B
    }
  }
}

// ── Escribir hoja Verificación ───────────────────────────────
function writeResults_(ss, changed, today) {
  let sheet = ss.getSheetByName(RESULT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RESULT_SHEET);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  const totalCols = 10;

  // Título
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('✈  JetSMART — Cambios de Horario')
    .setBackground('#0A3560').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 40);

  // Subtítulo
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setValue('Última verificación: ' + today)
    .setHorizontalAlignment('center').setFontColor('#666666');

  if (changed.length === 0) {
    sheet.getRange(4, 1, 1, totalCols).merge()
      .setValue('✅  Ningún vuelo cambió de horario.')
      .setBackground('#F0F9F0').setFontWeight('bold').setFontSize(12)
      .setHorizontalAlignment('center');
    ss.setActiveSheet(sheet);
    SpreadsheetApp.getUi().alert('✅ Ningún vuelo cambió de horario. Todo OK.');
    return;
  }

  // Ordenar de más nuevo a más antiguo
  changed.sort((a, b) => b.date.localeCompare(a.date));

  // Encabezado
  const headers = ['Código', 'Año', 'Mes', 'Tramo', 'Vuelo', 'Ruta', 'Fecha', 'Hora original  →  Nueva', 'Diferencia', 'Estado'];
  sheet.getRange(4, 1, 1, totalCols).setValues([headers])
    .setBackground('#345D8B').setFontColor('#FFFFFF')
    .setFontWeight('bold').setHorizontalAlignment('center');

  // Datos
  const rows = changed.map(c => [
    c.codigo,
    c.anio,
    c.mes,
    c.leg,
    c.flightNum,
    c.route,
    isoToDMY(c.date),
    c.stored + '  →  ' + c.current,
    c.diffLabel,
    c.reclamable,
  ]);
  sheet.getRange(5, 1, rows.length, totalCols).setValues(rows)
    .setBackground('#FDE8E8');

  // Columna Diferencia en negrita
  sheet.getRange(5, 9, rows.length, 1).setFontWeight('bold');

  // Columna Estado: color por fila según valor
  for (let i = 0; i < changed.length; i++) {
    const cell = sheet.getRange(5 + i, 10);
    cell.setFontWeight('bold').setHorizontalAlignment('center').setFontColor('#FFFFFF');
    if (changed[i].reclamable === 'Abierto') {
      cell.setBackground('#1565C0'); // azul
    } else {
      cell.setBackground('#2E7D32'); // verde
    }
  }

  [90, 50, 90, 70, 80, 110, 100, 160, 180, 100].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert('🔴 Se detectaron ' + changed.length + ' cambio(s) de horario.\n\nRevisá la hoja "' + RESULT_SHEET + '".');
}

// ── Email de alerta ──────────────────────────────────────────
function sendAlert_(changed, today) {
  const rows = changed.map(c =>
    '• ' + c.codigo + ' (' + c.leg + ') — ' + c.flightNum + ' ' + c.route +
    ' — ' + isoToDMY(c.date) + ': ' + c.stored + ' → ' + c.current + '  (' + c.diffLabel + ')'
  ).join('\n');
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    '✈ JetSMART — ' + changed.length + ' cambio(s) de horario detectado(s) [' + today + ']',
    'Hola,\n\nSe detectaron los siguientes cambios de horario:\n\n' + rows +
    '\n\nAbrí la planilla para ver el detalle completo.\n\nhttps://docs.google.com/spreadsheets/d/1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE'
  );
}

// ── Menú ─────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('✈ JetSMART')
    .addItem('Verificar horarios ahora', 'verificarHorarios')
    .addSeparator()
    .addItem('Importar desde Gmail', 'revisarGmail')
    .addSeparator()
    .addItem('Configurar buscador de vuelos', 'setupBuscarVuelos')
    .addSeparator()
    .addItem('Activar revisión diaria (8am)', 'setupDailyTrigger')
    .addItem('Desactivar revisión automática', 'removeTrigger')
    .addToUi();
}

// ── Triggers automáticos ─────────────────────────────────────
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'verificarHorarios' || t.getHandlerFunction() === 'verificarHorariosTrigger')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verificarHorariosTrigger')
    .timeBased().everyDays(1).atHour(8)
    .inTimezone('America/Argentina/Buenos_Aires')
    .create();
  SpreadsheetApp.getUi().alert(
    '✅ Revisión automática activada.\nCorre todos los días a las 8:00am (Argentina).\nSi detecta cambios, te manda un email a ' + NOTIFY_EMAIL + '.'
  );
}

function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'verificarHorarios' || t.getHandlerFunction() === 'verificarHorariosTrigger');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  SpreadsheetApp.getUi().alert(
    triggers.length > 0 ? '✅ Revisión automática desactivada.' : 'No había revisión automática activa.'
  );
}

// ── Gmail: función principal ──────────────────────────────────
function revisarGmail() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const main = ss.getSheetByName(MAIN_SHEET);

  const data = main.getRange('A1:U200').getDisplayValues();
  const rows = data.slice(1).filter(r => r[0]);
  const existingCodigos = new Set(rows.map(r => r[0].trim()));

  const added   = importarReservas_(main, rows, existingCodigos);
  const updated = procesarReprogramaciones_(main, rows);

  const msg = [];
  if (added   > 0) msg.push('✅ ' + added   + ' reserva(s) nueva(s) importada(s).');
  if (updated > 0) msg.push('🔴 ' + updated + ' vuelo(s) marcado(s) como Abierto por reprogramación.');
  if (msg.length === 0) msg.push('Sin novedades en el correo.');

  SpreadsheetApp.getUi().alert(msg.join('\n'));
}

// ── Importar nuevas reservas desde Gmail ─────────────────────
function importarReservas_(main, rows, existingCodigos) {
  const threads = GmailApp.search(
    'from:jetsmart@mg.jetsmart.com subject:"Confirmación Itinerario" newer_than:365d',
    0, 50
  );

  let added = 0;
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const body   = msg.getBody();
      const parsed = parseConfirmacion_(body);
      if (!parsed || existingCodigos.has(parsed.codigo)) continue;

      main.appendRow(buildRow_(parsed));
      existingCodigos.add(parsed.codigo);
      added++;
    }
  }
  return added;
}

// ── Parser: email de confirmación ────────────────────────────
function parseConfirmacion_(body) {
  const codeM = body.match(/Confirmaci.n\s+Reserva[^A-Z0-9]*([A-Z0-9]{6})/);
  if (!codeM) return null;
  const codigo = codeM[1];

  const fechas    = allMatches_(body, /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/g);
  const depTimes  = allMatches_(body, /Hora de salida:<\/span>(\d{2}:\d{2})/g);
  const arrTimes  = allMatches_(body, /Hora de llegada:<\/span>(\d{2}:\d{2})/g);
  const iatas     = allMatches_(body, /font-size:19px;font-weight:bold[^>]+>([A-Z]{3})<\/td>/g);
  const flights   = allMatches_(body, /\*Vuelo <\/span>JA<span><\/span>(\d+)/g).map(n => 'JA' + n);

  // Passenger names: strip title (MR / MRS / MS / MISS / DR), deduplicate
  const paxRaw  = allMatches_(body, />\s*(?:MR|MRS|MS|MISS|DR)\s+([A-Z][A-Z ]+?)\s*<\/td>/g);
  const paxUniq = [];
  paxRaw.forEach(n => { if (paxUniq.indexOf(n) < 0) paxUniq.push(n.trim()); });
  const titular = paxUniq.join(' / ');

  if (fechas.length === 0 || depTimes.length === 0 || iatas.length < 2) return null;

  const ida = {
    fecha:   fechas[0],
    origin:  iatas[0],
    dest:    iatas[1],
    depTime: depTimes[0],
    arrTime: arrTimes[0] || '',
    flight:  flights[0]  || '',
  };

  let vuelta = null;
  if (fechas.length > 1 && fechas[1] !== fechas[0] && iatas.length > 3) {
    vuelta = {
      fecha:   fechas[1],
      origin:  iatas[2],
      dest:    iatas[3],
      depTime: depTimes[1] || '',
      arrTime: arrTimes[1] || '',
      flight:  flights[1]  || '',
    };
  }

  return { codigo, titular, ida, vuelta };
}

// ── Construir fila nueva ──────────────────────────────────────
function buildRow_(parsed) {
  const idaDate  = parsed.ida ? parsed.ida.fecha : '';           // DD/MM/YYYY
  const parts    = idaDate ? idaDate.split('/') : [];
  const year     = parts[2] || '';
  const monthIdx = parts[1] ? parseInt(parts[1]) - 1 : -1;
  const mes      = monthIdx >= 0 ? MONTHS_ES[monthIdx] : '';

  return [
    parsed.codigo,                                          // A
    'Pendiente',                                            // B
    '',                                                     // C ¿Reprog?
    parsed.titular,                                         // D
    year,                                                   // E
    mes,                                                    // F
    idaDate,                                                // G FechaIda
    parsed.ida ? parsed.ida.flight  : '',                   // H VueloIda
    parsed.ida ? fromIATA(parsed.ida.origin) : '',          // I OrigenIda
    parsed.ida ? parsed.ida.depTime : '',                   // J SalidaIda
    parsed.ida ? fromIATA(parsed.ida.dest)   : '',          // K DestinoIda
    parsed.ida ? parsed.ida.arrTime : '',                   // L LlegadaIda
    parsed.vuelta ? parsed.vuelta.fecha   : '',             // M FechaVuelta
    parsed.vuelta ? parsed.vuelta.flight  : '',             // N VueloVuelta
    parsed.vuelta ? fromIATA(parsed.vuelta.origin) : '',    // O OrigenVuelta
    parsed.vuelta ? parsed.vuelta.depTime : '',             // P SalidaVuelta
    parsed.vuelta ? fromIATA(parsed.vuelta.dest)   : '',    // Q DestinoVuelta
    parsed.vuelta ? parsed.vuelta.arrTime : '',             // R LlegadaVuelta
  ];
}

// ── Procesar emails de reprogramación ────────────────────────
function procesarReprogramaciones_(main, rows) {
  const q1 = 'from:contacto@ai.jetsmart.com subject:"Modificación de Itinerario" newer_than:365d';
  const q2 = 'from:contacto@ai.jetsmart.com subject:"Modificacion de Itinerario" newer_than:365d';
  const threads = GmailApp.search(q1, 0, 50).concat(GmailApp.search(q2, 0, 50));

  let updated = 0;
  const processed = new Set();

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const body  = msg.getBody();
      const plain = msg.getPlainBody();
      const rep   = parseReprogramacion_(body, plain);
      if (!rep || !rep.codigo || processed.has(rep.codigo)) continue;
      processed.add(rep.codigo);

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0].trim() === rep.codigo) {
          const rowNum = i + 2;
          main.getRange(rowNum, 2).setValue('Abierto'); // col B ESTADO
          main.getRange(rowNum, 3).setValue('Sí');      // col C ¿Reprog?
          updated++;
          break;
        }
      }
    }
  }
  return updated;
}

// ── Parser: email de reprogramación ──────────────────────────
function parseReprogramacion_(body, plain) {
  // Prefer plaintext custom fields (reliable, no HTML parsing needed)
  if (plain) {
    const codeM = plain.match(/custom6:\s*([A-Z0-9]{6})/);
    if (codeM) {
      const flightM = plain.match(/custom2:\s*(\d+)/);
      const origM   = plain.match(/custom3:\s*([A-Z]{3})/);
      const destM   = plain.match(/custom4:\s*([A-Z]{3})/);
      const dateM   = plain.match(/custom11:\s*(\d{4}-\d{2}-\d{2})/);
      const timeM   = plain.match(/custom12:\s*(\d{2}:\d{2})/);
      return {
        codigo:  codeM[1],
        flight:  flightM ? 'JA' + flightM[1] : '',
        origin:  origM   ? origM[1]           : '',
        dest:    destM   ? destM[1]           : '',
        newDate: dateM   ? dateM[1]           : '',
        newTime: timeM   ? timeM[1]           : '',
      };
    }
  }

  // Fallback: parse HTML
  const codeM = body.match(/c.digo de reserva[^<]*<strong><span[^>]*>([A-Z0-9]{6})<\/span><\/strong>/);
  if (!codeM) return null;
  const dateM = body.match(/<strong><span[^>]*>(\d{4}-\d{2}-\d{2})<\/span>\s*<span[^>]*>(\d{2}:\d{2})<\/span>/);
  return {
    codigo:  codeM[1],
    flight:  '',
    origin:  '',
    dest:    '',
    newDate: dateM ? dateM[1] : '',
    newTime: dateM ? dateM[2] : '',
  };
}

// ── Helper: todas las capturas de un regex global ─────────────
function allMatches_(str, regex) {
  const result = [];
  let m;
  while ((m = regex.exec(str)) !== null) result.push(m[1]);
  return result;
}

// ════════════════════════════════════════════════════════════════
// BUSCADOR DE VUELOS
// ════════════════════════════════════════════════════════════════

// ── Crear hoja de búsqueda ────────────────────────────────────
function setupBuscarVuelos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(SEARCH_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SEARCH_SHEET);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
    sheet.clearNotes();
  }

  // ── Contenido ─────────────────────────────────────────────
  sheet.getRange('A1').setValue('✈  Buscador de Vuelos — JetSMART');
  sheet.getRange('A3').setValue('Origen');
  sheet.getRange('A4').setValue('Destino');
  sheet.getRange('A5').setValue('Fecha IDA (DD/MM/YYYY)');
  sheet.getRange('A6').setValue('Fecha Vuelta (DD/MM/YYYY)');
  sheet.getRange('A8').setValue('Tildar para buscar →');
  sheet.getRange('B8').insertCheckboxes();
  sheet.getRange('A10').setValue('Estado:');
  sheet.getRange('B10').setValue('Completá los campos y tildá el casillero.');

  // Valores por defecto
  sheet.getRange('B3').setValue('Resistencia');
  sheet.getRange('B4').setValue('Buenos Aires (AEP)');
  sheet.getRange('B5').setValue(
    Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy')
  );
  sheet.getRange('B6').setValue(''); // vacío = solo ida

  // ── Validaciones dropdown ──────────────────────────────────
  const cities = Object.keys(CITY_TO_IATA);
  const dropdownRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(cities, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('B3').setDataValidation(dropdownRule);
  sheet.getRange('B4').setDataValidation(dropdownRule);

  // ── Formato ────────────────────────────────────────────────
  const DARK  = '#0A3560';
  const MID   = '#345D8B';
  const LIGHT = '#E8F4FD';
  const GREEN = '#2E7D32';
  const WHITE = '#FFFFFF';

  // Título A1:C1
  sheet.getRange('A1:C1').merge()
    .setBackground(DARK).setFontColor(WHITE)
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 45);

  // Etiquetas A3:A6
  sheet.getRange('A3:A6')
    .setBackground(MID).setFontColor(WHITE)
    .setFontWeight('bold').setFontSize(11)
    .setHorizontalAlignment('right').setVerticalAlignment('middle');
  [3,4,5,6].forEach(r => sheet.setRowHeight(r, 32));

  // Inputs B3:B6
  sheet.getRange('B3:B6')
    .setBackground(LIGHT).setFontSize(11).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
               MID, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Nota en B6: opcional
  sheet.getRange('B6').setNote('Dejá vacío para buscar solo ida');

  // Fila 8: etiqueta del checkbox
  sheet.getRange('A8')
    .setBackground(GREEN).setFontColor(WHITE)
    .setFontWeight('bold').setFontSize(12)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.getRange('B8')
    .setBackground(GREEN).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sheet.setRowHeight(8, 38);

  // Fila 10: estado
  sheet.getRange('A10').setFontWeight('bold').setFontColor(MID);
  sheet.getRange('B10').setFontColor('#555555').setFontStyle('italic');
  sheet.setRowHeight(10, 24);

  // Anchos de columna
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 20);

  // ── Trigger installable ────────────────────────────────────
  setupBuscarTrigger_();

  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert(
    '✅ Hoja "Buscar Vuelos" lista.\n\n' +
    '1. Elegí Origen y Destino del desplegable\n' +
    '2. Escribí la Fecha IDA en formato DD/MM/YYYY\n' +
    '3. (Opcional) Fecha Vuelta para buscar ida y vuelta\n' +
    '4. Tildá el casillero verde → busca automáticamente'
  );
}

// ── Instalar trigger de edición ───────────────────────────────
function setupBuscarTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onEditBuscar')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEditBuscar')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
}

// ── Trigger: detectar cuando se tilda el casillero ────────────
function onEditBuscar(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== SEARCH_SHEET) return;
  if (e.range.getA1Notation() !== 'B7') return;
  if (e.value !== 'TRUE') return;

  // Destildar inmediatamente para que quede como botón
  e.range.setValue(false);

  const search = e.range.getSheet();
  search.getRange('B9').setValue('🔍 Buscando... por favor esperá.');
  SpreadsheetApp.flush();

  buscarVuelosDesdeSheet_();
}

// ── Función principal de búsqueda ─────────────────────────────
function buscarVuelosDesdeSheet_() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const search = ss.getSheetByName(SEARCH_SHEET);
  if (!search) return;

  const origCity = String(search.getRange('B3').getValue()).trim();
  const destCity = String(search.getRange('B4').getValue()).trim();
  const dateRaw  = String(search.getRange('B5').getValue()).trim();

  const orig = toIATA(origCity);
  const dest = toIATA(destCity);

  // Validar fecha
  const date = parseDMY(dateRaw);
  if (!date) {
    search.getRange('B9').setValue('⚠️ Fecha inválida. Usar formato DD/MM/YYYY');
    return;
  }
  if (!orig || orig === destCity || !dest || dest === origCity) {
    search.getRange('B9').setValue('⚠️ Origen o destino no reconocido.');
    return;
  }
  if (orig === dest) {
    search.getRange('B9').setValue('⚠️ Origen y destino no pueden ser iguales.');
    return;
  }

  // Llamar a la API de JetSMART
  const flights = searchJetSmartFlights_(orig, dest, date);

  writeSearchResults_(ss, flights, origCity, destCity, date);

  if (flights.length === 0) {
    search.getRange('B9').setValue('Sin vuelos JetSMART para ' + origCity + ' → ' + destCity + ' el ' + dateRaw);
  } else {
    const best = flights[0];
    const p    = best.priceTotal != null ? '$' + formatARS_(best.priceTotal) + ' ARS' : '(ver planilla)';
    search.getRange('B9').setValue(
      '✅ ' + flights.length + ' vuelo(s) encontrado(s). Mejor precio: ' + p
    );
    ss.setActiveSheet(ss.getSheetByName(SEARCH_RESULT_SHEET));
  }
}

// ── Llamada a la API de JetSMART ──────────────────────────────
function searchJetSmartFlights_(orig, dest, date) {
  const today  = getToday();
  const future = Utilities.formatDate(
    new Date(Date.now() + 400*24*60*60*1000),
    'America/Argentina/Buenos_Aires', 'yyyy-MM-dd'
  );
  const url =
    'https://origin.jsrtff.it.jetsm.art/availability/plain' +
    '?_agg=&_meta=' +
    '&bt_date=' + encodeURIComponent(today  + ' 00:00:00') +
    '&bt_date=' + encodeURIComponent(future + ' 24:00:00') +
    '&pov_c=AR&dep=' + orig;

  try {
    const resp = UrlFetchApp.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept':     'application/json',
        'Referer':    'https://jetsmart.com/',
      },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) return [];

    return (JSON.parse(resp.getContentText()).availability || [])
      .filter(f => f.arr === dest && f.date.substring(0, 10) === date)
      .map(f => ({
        flight:     (f.cc || 'JA') + f.fn,
        depTime:    f.date.substring(11, 16),
        priceBase:  f.p  && f.p.ars  ? Math.round(f.p.ars)  : null,
        taxes:      f.i  && f.i.ars  ? Math.round(f.i.ars)  : null,
        priceTotal: f.pi && f.pi.ars ? Math.round(f.pi.ars) : null,
        seats:      f.s  || null,
      }))
      .sort((a, b) => (a.priceTotal || 999999) - (b.priceTotal || 999999));
  } catch (e) {
    Logger.log('searchJetSmartFlights_ error: ' + e.message);
    return [];
  }
}

// ── Escribir resultados ───────────────────────────────────────
function writeSearchResults_(ss, flights, origCity, destCity, date) {
  let sheet = ss.getSheetByName(SEARCH_RESULT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SEARCH_RESULT_SHEET);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  const COLS    = 6;
  const DARK    = '#0A3560';
  const MID     = '#345D8B';
  const BEST_BG = '#E8F5E9'; // verde claro para el mejor precio
  const ALT_BG  = '#F5F5F5';

  // Título
  sheet.getRange(1, 1, 1, COLS).merge()
    .setValue('✈  ' + origCity + '  →  ' + destCity + '  |  ' + isoToDMY(date))
    .setBackground(DARK).setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 42);

  sheet.getRange(2, 1, 1, COLS).merge()
    .setValue('JetSMART  |  ' + getToday() + '  |  ' + flights.length + ' vuelo(s) disponibles')
    .setFontColor('#666666').setHorizontalAlignment('center');

  if (flights.length === 0) {
    sheet.getRange(4, 1, 1, COLS).merge()
      .setValue('Sin vuelos disponibles para esa ruta y fecha.')
      .setBackground('#FFF3CD').setFontWeight('bold')
      .setHorizontalAlignment('center').setFontSize(12);
    return;
  }

  // Encabezado
  const headers = ['Vuelo', 'Salida', 'Precio base', 'Impuestos', 'TOTAL ARS', 'Asientos'];
  sheet.getRange(4, 1, 1, COLS).setValues([headers])
    .setBackground(MID).setFontColor('#FFFFFF')
    .setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setRowHeight(4, 28);

  // Filas de datos
  const rows = flights.map(f => [
    f.flight,
    f.depTime,
    f.priceBase  != null ? formatARS_(f.priceBase)  : '',
    f.taxes      != null ? formatARS_(f.taxes)      : '',
    f.priceTotal != null ? formatARS_(f.priceTotal) : '',
    f.seats      != null ? f.seats                  : '',
  ]);
  sheet.getRange(5, 1, rows.length, COLS).setValues(rows);

  // Estilo por fila
  for (let i = 0; i < rows.length; i++) {
    const row  = sheet.getRange(5 + i, 1, 1, COLS);
    const bg   = i === 0 ? BEST_BG : (i % 2 === 0 ? '#FFFFFF' : ALT_BG);
    row.setBackground(bg).setVerticalAlignment('middle');
    sheet.setRowHeight(5 + i, 26);

    // Total en negrita azul
    sheet.getRange(5 + i, 5).setFontWeight('bold').setFontColor('#1565C0');

    // Mejor precio con borde destacado
    if (i === 0) {
      row.setBorder(true, true, true, true, false, false, '#2E7D32', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
  }

  // Anchos de columna
  [80, 70, 110, 100, 120, 75].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

// ── Formatear número como ARS ─────────────────────────────────
function formatARS_(n) {
  // Formato: 1.234.567
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
