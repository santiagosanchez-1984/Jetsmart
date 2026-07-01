// Utilidades portadas de jetsmart.gs (sin dependencias de Apps Script).

const TZ = 'America/Argentina/Buenos_Aires';

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

const IATA = {
  'AEP': 'Buenos Aires (AEP)',
  'EZE': 'Buenos Aires (EZE)',
  'RES': 'Resistencia',
  'COR': 'Cordoba',
  'NQN': 'Neuquen',
  'BRC': 'Bariloche',
  'USH': 'Ushuaia',
  'MDZ': 'Mendoza',
  'FLN': 'Florianopolis',
  'GIG': 'Rio de Janeiro',
  'ASU': 'Asuncion',
  'SCL': 'Santiago de Chile',
  'IGR': 'Puerto Iguazu',
  'FTE': 'El Calafate',
  'TUC': 'Tucuman'
};

const CIUDAD = {
  'Buenos Aires (AEP)': 'AEP',
  'Buenos Aires (EZE)': 'EZE',
  'Resistencia':        'RES',
  'Cordoba':            'COR',
  'Neuquen':            'NQN',
  'Bariloche':          'BRC',
  'Ushuaia':            'USH',
  'Mendoza':            'MDZ',
  'Florianopolis':      'FLN',
  'Rio de Janeiro':     'GIG',
  'Asuncion':           'ASU',
  'Santiago de Chile':  'SCL',
  'Puerto Iguazu':      'IGR',
  'El Calafate':        'FTE',
  'Tucuman':            'TUC'
};

function iataACiudad(codigo) { return IATA[String(codigo).trim()] || String(codigo).trim(); }
function ciudadAIata(ciudad) { return CIUDAD[String(ciudad).trim()] || String(ciudad).trim(); }

function dmyAiso(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}

function isoDmy(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function formatFechaTZ(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

function getHoy() {
  return formatFechaTZ(new Date());
}

function ahoraStr() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function padHora(str) {
  if (!str) return '';
  const s = String(str).trim();
  return /^\d:\d{2}$/.test(s) ? '0' + s : s;
}

function diffMinutos(h1, h2) {
  const a = h1.split(':'), b = h2.split(':');
  return (parseInt(b[0]) * 60 + parseInt(b[1])) - (parseInt(a[0]) * 60 + parseInt(a[1]));
}

function numARS(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ─── API pública de JetSMART ───────────────────────────────────

async function fetchJetsmart(origen, hasta) {
  const hoy = getHoy();
  const fin = hasta || formatFechaTZ(new Date(Date.now() + 400 * 86400000));
  const url = 'https://origin.jsrtff.it.jetsm.art/availability/plain?_agg=&_meta=' +
    '&bt_date=' + encodeURIComponent(hoy + ' 00:00:00') +
    '&bt_date=' + encodeURIComponent(fin + ' 24:00:00') +
    '&pov_c=AR&dep=' + origen;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://jetsmart.com/' }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.availability || [];
  } catch (e) {
    return [];
  }
}

async function fetchDisponibilidad(codigo) {
  const vuelos = await fetchJetsmart(codigo);
  return vuelos.map(f => ({
    fn: f.cc + f.fn,
    fecha: f.date.substring(0, 10),
    hora: f.date.substring(11, 16)
  }));
}

async function buscarVuelosAPI(orig, dest, fecha) {
  const vuelos = await fetchJetsmart(orig);
  return vuelos
    .filter(f => f.arr === dest && f.date.substring(0, 10) === fecha)
    .map(f => ({
      vuelo:    (f.cc || 'JA') + f.fn,
      hora:     f.date.substring(11, 16),
      base:     f.p && f.p.ars ? Math.round(f.p.ars) : null,
      imp:      f.i && f.i.ars ? Math.round(f.i.ars) : null,
      total:    f.pi && f.pi.ars ? Math.round(f.pi.ars) : null,
      asientos: f.s || null
    }))
    .sort((a, b) => (a.total || 999999) - (b.total || 999999));
}

async function buscarCalendarioAPI(orig, dest) {
  const vuelos = await fetchJetsmart(orig);
  const dias = {};
  vuelos
    .filter(f => f.arr === dest)
    .forEach(f => {
      const fecha = f.date.substring(0, 10);
      const total = f.pi && f.pi.ars ? Math.round(f.pi.ars) : null;
      const vuelo = {
        vuelo:    (f.cc || 'JA') + f.fn,
        hora:     f.date.substring(11, 16),
        total,
        base:     f.p && f.p.ars ? Math.round(f.p.ars) : null,
        imp:      f.i && f.i.ars ? Math.round(f.i.ars) : null,
        asientos: f.s || null
      };
      if (!dias[fecha]) dias[fecha] = { min: null, vuelos: [] };
      if (total !== null && (dias[fecha].min === null || total < dias[fecha].min)) {
        dias[fecha].min = total;
      }
      dias[fecha].vuelos.push(vuelo);
    });
  Object.keys(dias).forEach(d => {
    dias[d].vuelos.sort((a, b) => (a.total || 999999) - (b.total || 999999));
  });
  return dias;
}

async function obtenerVuelosRutaCompleta() {
  const vuelos = await fetchJetsmart('RES', '2026-12-31');
  const result = vuelos
    .filter(f => f.arr === 'AEP')
    .map(f => ({
      fecha:   f.date.substring(0, 10),
      vuelo:   (f.cc || 'JA') + f.fn,
      origen:  'RES',
      destino: 'AEP',
      salida:  f.date.substring(11, 16),
      llegada: f.arr_date ? f.arr_date.substring(11, 16) : ''
    }));
  result.sort((a, b) =>
    a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : (a.salida < b.salida ? -1 : 1));
  return result;
}

// ─── Estadísticas de cambio de horario ─────────────────────────

const DIAS_SEMANA = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// filas: [FechaRegistro, FechaVuelo, NroVuelo, SalidaAnterior, SalidaNueva, LlegadaAnterior, LlegadaNueva, MinutosCambio, Tipo]
function calcularEstadisticasHist(filas) {
  const porDia = {}, porVuelo = {};
  filas.forEach(row => {
    if (!row[1]) return;
    const p = String(row[1]).split('-');
    if (p.length === 3) {
      const dia = DIAS_SEMANA[new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
      porDia[dia] = (porDia[dia] || 0) + 1;
    }
    if (row[2]) porVuelo[row[2]] = (porVuelo[row[2]] || 0) + 1;
  });
  return { porDia, porVuelo, total: filas.filter(r => r[0]).length };
}

function cargarUltimosCambios(filas, n) {
  return filas.slice(-n).filter(r => r[0]).reverse().map(r => ({
    fechaReg: r[0], fecha: r[1], vuelo: r[2], salidaAnt: r[3], salidaNueva: r[4],
    llegadaAnt: r[5], llegadaNueva: r[6], diffMin: r[7], tipo: r[8]
  }));
}

// ─── Parser de email de confirmación (Gmail) ───────────────────

function extraerTodos(str, regex) {
  const res = [];
  let m;
  while ((m = regex.exec(str)) !== null) res.push(m[1]);
  return res;
}

function parsearConfirmacion(body) {
  let codigoM = body.match(/font-size:20px[^>]*>([A-Z0-9]{6})<\/span>/);
  if (!codigoM) codigoM = body.match(/Reserva[^A-Z0-9]{0,80}([A-Z0-9]{6})/);
  if (!codigoM) return null;
  const codigo = codigoM[1];

  const fechas   = extraerTodos(body, /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/g);
  const salidas  = extraerTodos(body, /Hora de salida:<\/span>(\d{1,2}:\d{2})/g).map(padHora);
  const llegadas = extraerTodos(body, /Hora de llegada:<\/span>(\d{1,2}:\d{2})/g).map(padHora);
  const iatas    = extraerTodos(body, /font-size:19px;font-weight:bold[^>]+>([A-Z]{3})<\/td>/g);
  const vuelos   = extraerTodos(body, /\*Vuelo <\/span>JA<span><\/span>(\d+)/g).map(n => 'JA' + n);

  const paxRaw  = extraerTodos(body, />\s*(?:MR|MRS|MS|MISS|DR)\s+([A-Z][A-Z ]+?)\s*<\/td>/g);
  const paxUniq = [];
  paxRaw.forEach(p => { const nombre = p.trim(); if (paxUniq.indexOf(nombre) < 0) paxUniq.push(nombre); });
  const titular = paxUniq.join(' / ');

  if (fechas.length === 0 || salidas.length === 0 || iatas.length < 2) return null;

  const ida = {
    fecha:   fechas[0],
    origen:  iatas[0],
    destino: iatas[1],
    salida:  salidas[0],
    llegada: llegadas[0] || '',
    vuelo:   vuelos[0]   || ''
  };

  let vuelta = null;
  if (fechas.length > 1 && fechas[1] !== fechas[0] && iatas.length > 3) {
    vuelta = {
      fecha:   fechas[1],
      origen:  iatas[2],
      destino: iatas[3],
      salida:  salidas[1]  || '',
      llegada: llegadas[1] || '',
      vuelo:   vuelos[1]   || ''
    };
  }

  return { codigo, titular, ida, vuelta };
}

function construirFila(p) {
  const fechaIda = p.ida ? p.ida.fecha : '';
  const partes   = fechaIda ? fechaIda.split('/') : [];
  const anio     = partes[2] || '';
  const mes      = partes[1] ? MESES[parseInt(partes[1]) - 1] : '';

  return [
    p.codigo,
    'Pendiente',
    '',
    p.titular,
    anio,
    mes,
    fechaIda,
    p.ida ? p.ida.vuelo : '',
    p.ida ? iataACiudad(p.ida.origen) : '',
    p.ida ? p.ida.salida : '',
    p.ida ? iataACiudad(p.ida.destino) : '',
    p.ida ? p.ida.llegada : '',
    p.vuelta ? p.vuelta.fecha : '',
    p.vuelta ? p.vuelta.vuelo : '',
    p.vuelta ? iataACiudad(p.vuelta.origen) : '',
    p.vuelta ? p.vuelta.salida : '',
    p.vuelta ? iataACiudad(p.vuelta.destino) : '',
    p.vuelta ? p.vuelta.llegada : ''
  ];
}

module.exports = {
  MESES, IATA, CIUDAD,
  iataACiudad, ciudadAIata,
  dmyAiso, isoDmy, getHoy, ahoraStr, padHora, diffMinutos, numARS,
  fetchDisponibilidad, buscarVuelosAPI, buscarCalendarioAPI, obtenerVuelosRutaCompleta,
  calcularEstadisticasHist, cargarUltimosCambios,
  parsearConfirmacion, construirFila
};
