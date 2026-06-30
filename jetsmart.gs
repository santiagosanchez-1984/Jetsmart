// ============================================================
// JetSMART — Google Apps Script
// Pegar en: Planilla > Extensiones > Apps Script
// ============================================================

var SHEET_VUELOS  = 'Vuelos JetSMART';
var SHEET_VERIF   = 'Verificacion';
var SHEET_BUSCAR  = 'Buscar Vuelos';
var SHEET_RESULT  = 'Resultados Busqueda';
var EMAIL_DESTINO = 'santiago.hector.sanchez@gmail.com';

var MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

var IATA = {
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

var CIUDAD = {
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

// ─── Menu ────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JetSMART')
    .addItem('Importar desde Gmail',        'importarDesdeGmail')
    .addSeparator()
    .addItem('Verificar horarios ahora',    'verificarHorarios')
    .addSeparator()
    .addItem('Configurar buscador',         'setupBuscarVuelos')
    .addSeparator()
    .addItem('Activar revision diaria 8am', 'activarRevisionDiaria')
    .addItem('Desactivar revision diaria',  'desactivarRevisionDiaria')
    .addToUi();
}

// ─── Importar desde Gmail ────────────────────────────────────
//
// Busca correos de jetsmart@mg.jetsmart.com con asunto "Itinerario"
// de los ultimos 365 dias. Por cada email, extrae el codigo de reserva
// y lo compara con la columna A de la hoja. Si no existe, lo agrega
// en la posicion correcta segun la fecha (mas reciente arriba).

function importarDesdeGmail() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(SHEET_VUELOS);

  // Leer todos los codigos ya cargados
  var data     = hoja.getRange('A2:A300').getDisplayValues();
  var cargados = {};
  for (var i = 0; i < data.length; i++) {
    var c = data[i][0].trim();
    if (c) cargados[c] = true;
  }

  // Buscar correos de confirmacion
  var threads = GmailApp.search(
    'from:jetsmart@mg.jetsmart.com subject:Itinerario newer_than:365d',
    0, 50
  );

  var nuevas = [];

  for (var t = 0; t < threads.length; t++) {
    var mensajes = threads[t].getMessages();
    for (var m = 0; m < mensajes.length; m++) {
      var body   = mensajes[m].getBody();
      var parsed = parsearConfirmacion(body);
      if (!parsed) continue;
      if (cargados[parsed.codigo]) continue;
      cargados[parsed.codigo] = true;
      nuevas.push(construirFila(parsed));
    }
  }

  if (nuevas.length === 0) {
    SpreadsheetApp.getUi().alert('Sin reservas nuevas en el correo.');
    return;
  }

  // Ordenar de mas reciente a mas antigua antes de insertar
  nuevas.sort(function(a, b) {
    var da = dmyAiso(a[6]) || '';
    var db = dmyAiso(b[6]) || '';
    return db > da ? 1 : db < da ? -1 : 0;
  });

  for (var n = 0; n < nuevas.length; n++) {
    insertarOrdenado(hoja, nuevas[n]);
  }

  SpreadsheetApp.getUi().alert(nuevas.length + ' reserva(s) nueva(s) importada(s).');
}

// ─── Parser de email de confirmacion ─────────────────────────

function parsearConfirmacion(body) {

  // Codigo: JetSMART lo pone en un span de font-size:20px bold
  var codigoM = body.match(/font-size:20px[^>]*>([A-Z0-9]{6})<\/span>/);

  // Fallback: busca "Reserva" seguido de espacios/HTML y 6 caracteres alfanumericos
  if (!codigoM) {
    codigoM = body.match(/Reserva[^A-Z0-9]{0,80}([A-Z0-9]{6})/);
  }

  if (!codigoM) return null;
  var codigo = codigoM[1];

  // Fechas: "Fecha: DD/MM/YYYY"
  var fechas = extraerTodos(body, /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/g);

  // Horarios de salida y llegada
  var salidas  = extraerTodos(body, /Hora de salida:<\/span>(\d{1,2}:\d{2})/g).map(padHora);
  var llegadas = extraerTodos(body, /Hora de llegada:<\/span>(\d{1,2}:\d{2})/g).map(padHora);

  // Codigos IATA (aparecen en celdas con font-size:19px bold)
  var iatas = extraerTodos(body, /font-size:19px;font-weight:bold[^>]+>([A-Z]{3})<\/td>/g);

  // Numeros de vuelo: "JA3063"
  var vuelos = extraerTodos(body, /\*Vuelo <\/span>JA<span><\/span>(\d+)/g).map(function(n) { return 'JA' + n; });

  // Nombres de pasajeros (quitar titulo MR/MRS/etc)
  var paxRaw  = extraerTodos(body, />\s*(?:MR|MRS|MS|MISS|DR)\s+([A-Z][A-Z ]+?)\s*<\/td>/g);
  var paxUniq = [];
  for (var p = 0; p < paxRaw.length; p++) {
    var nombre = paxRaw[p].trim();
    if (paxUniq.indexOf(nombre) < 0) paxUniq.push(nombre);
  }
  var titular = paxUniq.join(' / ');

  // Necesitamos al menos una fecha, una hora de salida y dos IATA para la ida
  if (fechas.length === 0 || salidas.length === 0 || iatas.length < 2) return null;

  var ida = {
    fecha:   fechas[0],
    origen:  iatas[0],
    destino: iatas[1],
    salida:  salidas[0],
    llegada: llegadas[0] || '',
    vuelo:   vuelos[0]   || ''
  };

  // Vuelta: solo si hay segunda fecha distinta y cuatro IATA
  var vuelta = null;
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

  return { codigo: codigo, titular: titular, ida: ida, vuelta: vuelta };
}

// ─── Construir fila para la hoja ──────────────────────────────

function construirFila(p) {
  var fechaIda = p.ida ? p.ida.fecha : '';
  var partes   = fechaIda ? fechaIda.split('/') : [];
  var anio     = partes[2] || '';
  var mes      = partes[1] ? MESES[parseInt(partes[1]) - 1] : '';

  return [
    p.codigo,                                    // A Codigo
    'Pendiente',                                 // B Estado
    '',                                          // C Reprogramado
    p.titular,                                   // D Titular
    anio,                                        // E Ano
    mes,                                         // F Mes
    fechaIda,                                    // G Fecha Ida
    p.ida ? p.ida.vuelo              : '',        // H Vuelo Ida
    p.ida ? iataACiudad(p.ida.origen): '',        // I Origen Ida
    p.ida ? p.ida.salida             : '',        // J Salida Ida
    p.ida ? iataACiudad(p.ida.destino): '',       // K Destino Ida
    p.ida ? p.ida.llegada            : '',        // L Llegada Ida
    p.vuelta ? p.vuelta.fecha              : '',  // M Fecha Vuelta
    p.vuelta ? p.vuelta.vuelo              : '',  // N Vuelo Vuelta
    p.vuelta ? iataACiudad(p.vuelta.origen): '',  // O Origen Vuelta
    p.vuelta ? p.vuelta.salida             : '',  // P Salida Vuelta
    p.vuelta ? iataACiudad(p.vuelta.destino): '', // Q Destino Vuelta
    p.vuelta ? p.vuelta.llegada            : ''   // R Llegada Vuelta
  ];
}

// ─── Insertar fila en orden descendente por Fecha Ida ─────────

function insertarOrdenado(hoja, fila) {
  var fechaNueva = dmyAiso(fila[6]);
  if (!fechaNueva) { hoja.appendRow(fila); return; }

  var ultima  = hoja.getLastRow();
  if (ultima < 2) { hoja.appendRow(fila); return; }

  var fechas  = hoja.getRange(2, 7, ultima - 1, 1).getDisplayValues();
  var pos     = -1;

  for (var i = 0; i < fechas.length; i++) {
    var f = dmyAiso(fechas[i][0]);
    if (f && f < fechaNueva) { pos = i + 2; break; }
  }

  if (pos === -1) {
    hoja.appendRow(fila);
  } else {
    hoja.insertRowBefore(pos);
    hoja.getRange(pos, 1, 1, fila.length).setValues([fila]);
  }
}

// ─── Verificar cambios de horario ─────────────────────────────

function activarRevisionDiaria() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'verificarHorariosTrigger'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verificarHorariosTrigger')
    .timeBased().everyDays(1).atHour(8)
    .inTimezone('America/Argentina/Buenos_Aires').create();
  SpreadsheetApp.getUi().alert('Revision diaria activada a las 8am.\nEmail de alertas: ' + EMAIL_DESTINO);
}

function desactivarRevisionDiaria() {
  var lista = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'verificarHorariosTrigger'; });
  lista.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  SpreadsheetApp.getUi().alert(lista.length > 0 ? 'Revision diaria desactivada.' : 'No habia revision activa.');
}

function verificarHorariosTrigger() { verificarHorarios_(true); }
function verificarHorarios()        { verificarHorarios_(false); }

function verificarHorarios_(conEmail) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var hoja  = ss.getSheetByName(SHEET_VUELOS);
  var hoy   = getHoy();

  var data  = hoja.getRange('A1:R300').getDisplayValues();
  var filas = data.slice(1).filter(function(r) { return r[0] && /^[A-Z0-9]{6}$/.test(r[0]); });

  var aChequear = [];
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    if (f[1].trim() !== 'Pendiente') continue;
    var fechaIda    = dmyAiso(f[6]);
    var fechaVuelta = dmyAiso(f[12]);
    if (fechaIda && fechaIda >= hoy && f[7]) {
      aChequear.push({ codigo: f[0], leg: 'IDA', vuelo: f[7], origen: ciudadAIata(f[8]),
                       fecha: fechaIda, horaGuardada: padHora(f[9]) });
    }
    if (fechaVuelta && fechaVuelta >= hoy && f[13]) {
      aChequear.push({ codigo: f[0], leg: 'VUELTA', vuelo: f[13], origen: ciudadAIata(f[14]),
                       fecha: fechaVuelta, horaGuardada: padHora(f[15]) });
    }
  }

  if (aChequear.length === 0) {
    SpreadsheetApp.getUi().alert('No hay vuelos Pendiente para verificar.');
    return;
  }

  var cacheDisp = {};
  var cambios   = [];

  for (var c = 0; c < aChequear.length; c++) {
    var item = aChequear[c];
    if (!cacheDisp[item.origen]) cacheDisp[item.origen] = fetchDisponibilidad(item.origen);
    var vuelos = cacheDisp[item.origen];
    var enc    = null;
    for (var v = 0; v < vuelos.length; v++) {
      if (vuelos[v].fn === item.vuelo && vuelos[v].fecha === item.fecha) { enc = vuelos[v]; break; }
    }
    if (enc && enc.hora !== item.horaGuardada) {
      var diff = diffMinutos(item.horaGuardada, enc.hora);
      cambios.push({
        codigo: item.codigo, leg: item.leg, vuelo: item.vuelo,
        fecha: item.fecha, horaAntes: item.horaGuardada, horaAhora: enc.hora,
        diff: diff, estado: (diff > 59 || diff <= -15) ? 'Abierto' : 'NO ABIERTO'
      });
    }
  }

  // Marcar como Abierto en la hoja principal
  for (var ci = 0; ci < cambios.length; ci++) {
    if (cambios[ci].estado !== 'Abierto') continue;
    for (var fi = 0; fi < filas.length; fi++) {
      if (filas[fi][0].trim() === cambios[ci].codigo) {
        hoja.getRange(fi + 2, 2).setValue('Abierto');
        break;
      }
    }
  }

  escribirVerificacion(ss, cambios, hoy);
  if (conEmail && cambios.length > 0) enviarAlerta(cambios, hoy);
}

function fetchDisponibilidad(codigo) {
  var hoy    = getHoy();
  var futuro = Utilities.formatDate(new Date(Date.now() + 400*86400000), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
  var url    = 'https://origin.jsrtff.it.jetsm.art/availability/plain?_agg=&_meta=' +
               '&bt_date=' + encodeURIComponent(hoy + ' 00:00:00') +
               '&bt_date=' + encodeURIComponent(futuro + ' 24:00:00') +
               '&pov_c=AR&dep=' + codigo;
  try {
    var r = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://jetsmart.com/' },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return [];
    return (JSON.parse(r.getContentText()).availability || []).map(function(f) {
      return { fn: f.cc + f.fn, fecha: f.date.substring(0,10), hora: f.date.substring(11,16) };
    });
  } catch(e) { return []; }
}

function escribirVerificacion(ss, cambios, hoy) {
  var hoja = ss.getSheetByName(SHEET_VERIF) || ss.insertSheet(SHEET_VERIF);
  hoja.clearContents(); hoja.clearFormats();

  var N = 10;
  hoja.getRange(1,1,1,N).merge().setValue('JetSMART - Cambios de Horario')
    .setBackground('#0A3560').setFontColor('#FFFFFF').setFontWeight('bold')
    .setFontSize(14).setHorizontalAlignment('center').setVerticalAlignment('middle');
  hoja.setRowHeight(1, 40);
  hoja.getRange(2,1,1,N).merge().setValue('Verificado: ' + hoy)
    .setHorizontalAlignment('center').setFontColor('#666666');

  if (cambios.length === 0) {
    hoja.getRange(4,1,1,N).merge().setValue('Sin cambios de horario.')
      .setBackground('#F0F9F0').setFontWeight('bold').setHorizontalAlignment('center');
    ss.setActiveSheet(hoja);
    SpreadsheetApp.getUi().alert('Sin cambios de horario. Todo OK.');
    return;
  }

  cambios.sort(function(a,b) { return b.fecha > a.fecha ? 1 : -1; });
  hoja.getRange(4,1,1,N).setValues([['Codigo','Tramo','Vuelo','Fecha','Hora antes','Hora ahora','Diferencia','Estado','','']])
    .setBackground('#345D8B').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  var rows = cambios.map(function(c) {
    var abs  = Math.abs(c.diff);
    var h    = Math.floor(abs/60), m = abs%60;
    var dStr = (c.diff > 0 ? '+' : '-') + (h > 0 ? h+'h ' : '') + (m > 0 ? m+'min' : '') +
               ' (' + (c.diff > 0 ? 'atraso' : 'adelanto') + ')';
    return [c.codigo, c.leg, c.vuelo, isoDmy(c.fecha), c.horaAntes, c.horaAhora, dStr, c.estado, '', ''];
  });
  hoja.getRange(5,1,rows.length,N).setValues(rows).setBackground('#FDE8E8');
  hoja.getRange(5,7,rows.length,1).setFontWeight('bold');
  for (var i = 0; i < cambios.length; i++) {
    hoja.getRange(5+i,8).setFontWeight('bold').setFontColor('#FFFFFF').setHorizontalAlignment('center')
      .setBackground(cambios[i].estado === 'Abierto' ? '#1565C0' : '#2E7D32');
  }
  ss.setActiveSheet(hoja);
  SpreadsheetApp.getUi().alert(cambios.length + ' cambio(s) de horario detectado(s). Ver hoja "' + SHEET_VERIF + '".');
}

function enviarAlerta(cambios, hoy) {
  var lineas = cambios.map(function(c) {
    return '* ' + c.codigo + ' ' + c.leg + ' ' + c.vuelo + ' ' + isoDmy(c.fecha) +
           ': ' + c.horaAntes + ' -> ' + c.horaAhora;
  }).join('\n');
  GmailApp.sendEmail(EMAIL_DESTINO,
    'JetSMART - ' + cambios.length + ' cambio(s) de horario [' + hoy + ']',
    'Cambios detectados:\n\n' + lineas +
    '\n\nhttps://docs.google.com/spreadsheets/d/1RRVvrNopcHm-HpKDbUrRE3yMGHNYArNtQNJuvG_-rmE');
}

// ─── Buscador de vuelos ───────────────────────────────────────

function setupBuscarVuelos() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(SHEET_BUSCAR);
  if (!hoja) hoja = ss.insertSheet(SHEET_BUSCAR);
  else { hoja.clearContents(); hoja.clearFormats(); hoja.clearNotes(); }

  hoja.getRange('A1').setValue('Buscador de Vuelos - JetSMART');
  hoja.getRange('A3').setValue('Origen');
  hoja.getRange('A4').setValue('Destino');
  hoja.getRange('A5').setValue('Fecha IDA (DD/MM/YYYY)');
  hoja.getRange('A6').setValue('Fecha Vuelta (DD/MM/YYYY)');
  hoja.getRange('A8').setValue('Tildar para buscar ->');
  hoja.getRange('B8').insertCheckboxes();
  hoja.getRange('A10').setValue('Estado:');
  hoja.getRange('B10').setValue('Completa los campos y tilda el casillero.');
  hoja.getRange('B3').setValue('Resistencia');
  hoja.getRange('B4').setValue('Buenos Aires (AEP)');
  hoja.getRange('B5').setValue(Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy'));

  var ciudades = Object.keys(CIUDAD);
  var regla = SpreadsheetApp.newDataValidation().requireValueInList(ciudades, true).setAllowInvalid(false).build();
  hoja.getRange('B3').setDataValidation(regla);
  hoja.getRange('B4').setDataValidation(regla);

  var DARK='#0A3560', MID='#345D8B', LIGHT='#E8F4FD', GREEN='#2E7D32', WHITE='#FFFFFF';
  hoja.getRange('A1:C1').merge().setBackground(DARK).setFontColor(WHITE).setFontWeight('bold')
    .setFontSize(14).setHorizontalAlignment('center').setVerticalAlignment('middle');
  hoja.setRowHeight(1,45);
  hoja.getRange('A3:A6').setBackground(MID).setFontColor(WHITE).setFontWeight('bold')
    .setFontSize(11).setHorizontalAlignment('right').setVerticalAlignment('middle');
  [3,4,5,6].forEach(function(r){hoja.setRowHeight(r,32);});
  hoja.getRange('B3:B6').setBackground(LIGHT).setFontSize(11).setVerticalAlignment('middle')
    .setBorder(true,true,true,true,false,false,MID,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  hoja.getRange('B6').setNote('Dejar vacio para solo ida');
  hoja.getRange('A8').setBackground(GREEN).setFontColor(WHITE).setFontWeight('bold')
    .setFontSize(12).setHorizontalAlignment('center').setVerticalAlignment('middle');
  hoja.getRange('B8').setBackground(GREEN).setHorizontalAlignment('center');
  hoja.setRowHeight(8,38);
  hoja.getRange('A10').setFontWeight('bold').setFontColor(MID);
  hoja.getRange('B10').setFontColor('#555555').setFontStyle('italic');
  hoja.setColumnWidth(1,200); hoja.setColumnWidth(2,250);

  // Instalar trigger de edicion
  ScriptApp.getProjectTriggers()
    .filter(function(t){return t.getHandlerFunction()==='onEditBuscar';})
    .forEach(function(t){ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('onEditBuscar').forSpreadsheet(ss).onEdit().create();

  ss.setActiveSheet(hoja);
  SpreadsheetApp.getUi().alert('Hoja "Buscar Vuelos" lista.\nTilda el casillero verde para buscar.');
}

function onEditBuscar(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== SHEET_BUSCAR) return;
  if (e.range.getA1Notation() !== 'B8') return;
  if (e.value !== 'TRUE') return;
  e.range.setValue(false);
  e.range.getSheet().getRange('B10').setValue('Buscando...');
  SpreadsheetApp.flush();
  buscarVuelos_();
}

function buscarVuelos_() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(SHEET_BUSCAR);
  if (!hoja) return;
  var origen  = String(hoja.getRange('B3').getValue()).trim();
  var destino = String(hoja.getRange('B4').getValue()).trim();
  var fecha   = String(hoja.getRange('B5').getValue()).trim();
  var orig    = ciudadAIata(origen);
  var dest    = ciudadAIata(destino);
  var fechaIso = dmyAiso(fecha);

  if (!fechaIso) { hoja.getRange('B10').setValue('Fecha invalida (DD/MM/YYYY)'); return; }
  if (!orig || !dest || orig === dest) { hoja.getRange('B10').setValue('Origen o destino invalido'); return; }

  var vuelos = buscarVuelosAPI(orig, dest, fechaIso);
  mostrarResultados(ss, vuelos, origen, destino, fecha);

  if (vuelos.length === 0) {
    hoja.getRange('B10').setValue('Sin vuelos para ' + origen + ' -> ' + destino + ' el ' + fecha);
  } else {
    var mejor = vuelos[0];
    var precio = mejor.total != null ? '$' + numARS(mejor.total) + ' ARS' : '(sin precio)';
    hoja.getRange('B10').setValue(vuelos.length + ' vuelo(s). Mejor: ' + precio);
    ss.setActiveSheet(ss.getSheetByName(SHEET_RESULT));
  }
}

function buscarVuelosAPI(orig, dest, fecha) {
  var hoy    = getHoy();
  var futuro = Utilities.formatDate(new Date(Date.now()+400*86400000),'America/Argentina/Buenos_Aires','yyyy-MM-dd');
  var url    = 'https://origin.jsrtff.it.jetsm.art/availability/plain?_agg=&_meta=' +
               '&bt_date=' + encodeURIComponent(hoy+' 00:00:00') +
               '&bt_date=' + encodeURIComponent(futuro+' 24:00:00') +
               '&pov_c=AR&dep=' + orig;
  try {
    var r = UrlFetchApp.fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://jetsmart.com/'},muteHttpExceptions:true});
    if (r.getResponseCode()!==200) return [];
    return (JSON.parse(r.getContentText()).availability||[])
      .filter(function(f){return f.arr===dest && f.date.substring(0,10)===fecha;})
      .map(function(f){return {vuelo:(f.cc||'JA')+f.fn, hora:f.date.substring(11,16),
        base: f.p&&f.p.ars?Math.round(f.p.ars):null,
        imp:  f.i&&f.i.ars?Math.round(f.i.ars):null,
        total:f.pi&&f.pi.ars?Math.round(f.pi.ars):null, asientos:f.s||null};})
      .sort(function(a,b){return (a.total||999999)-(b.total||999999);});
  } catch(e){return [];}
}

function mostrarResultados(ss, vuelos, origen, destino, fecha) {
  var hoja = ss.getSheetByName(SHEET_RESULT) || ss.insertSheet(SHEET_RESULT);
  hoja.clearContents(); hoja.clearFormats();
  var N=6, DARK='#0A3560', MID='#345D8B';
  hoja.getRange(1,1,1,N).merge().setValue(origen+' -> '+destino+' | '+fecha)
    .setBackground(DARK).setFontColor('#FFFFFF').setFontWeight('bold')
    .setFontSize(14).setHorizontalAlignment('center').setVerticalAlignment('middle');
  hoja.setRowHeight(1,42);
  hoja.getRange(2,1,1,N).merge().setValue('JetSMART | '+getHoy()+' | '+vuelos.length+' vuelo(s)')
    .setFontColor('#666666').setHorizontalAlignment('center');
  if (vuelos.length===0) {
    hoja.getRange(4,1,1,N).merge().setValue('Sin vuelos disponibles.')
      .setBackground('#FFF3CD').setFontWeight('bold').setHorizontalAlignment('center'); return;
  }
  hoja.getRange(4,1,1,N).setValues([['Vuelo','Hora','Precio base','Impuestos','TOTAL ARS','Asientos']])
    .setBackground(MID).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  hoja.setRowHeight(4,28);
  var rows = vuelos.map(function(v){return [v.vuelo, v.hora,
    v.base?numARS(v.base):'', v.imp?numARS(v.imp):'', v.total?numARS(v.total):'', v.asientos||''];});
  hoja.getRange(5,1,rows.length,N).setValues(rows);
  for (var i=0;i<rows.length;i++) {
    var fila = hoja.getRange(5+i,1,1,N);
    fila.setBackground(i===0?'#E8F5E9':(i%2===0?'#FFFFFF':'#F5F5F5')).setVerticalAlignment('middle');
    hoja.setRowHeight(5+i,26);
    hoja.getRange(5+i,5).setFontWeight('bold').setFontColor('#1565C0');
    if (i===0) fila.setBorder(true,true,true,true,false,false,'#2E7D32',SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
  [80,70,110,100,120,75].forEach(function(w,i){hoja.setColumnWidth(i+1,w);});
}

// ─── Utilidades ───────────────────────────────────────────────

function iataACiudad(codigo) { return IATA[String(codigo).trim()] || String(codigo).trim(); }
function ciudadAIata(ciudad) { return CIUDAD[String(ciudad).trim()] || String(ciudad).trim(); }

function dmyAiso(str) {
  if (!str) return null;
  var m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3]+'-'+m[2]+'-'+m[1] : null;
}

function isoDmy(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  return p[2]+'/'+p[1]+'/'+p[0];
}

function getHoy() {
  return Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
}

function padHora(str) {
  if (!str) return '';
  var s = String(str).trim();
  return /^\d:\d{2}$/.test(s) ? '0'+s : s;
}

function diffMinutos(h1, h2) {
  var a=h1.split(':'), b=h2.split(':');
  return (parseInt(b[0])*60+parseInt(b[1])) - (parseInt(a[0])*60+parseInt(a[1]));
}

function extraerTodos(str, regex) {
  var res=[], m;
  while((m=regex.exec(str))!==null) res.push(m[1]);
  return res;
}

function numARS(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ─── Web App ─────────────────────────────────────────────────
//
// Agregar un archivo "Index.html" al mismo proyecto de Apps Script
// con el contenido del archivo Index.html de este repositorio.
// Luego: Implementar > Nueva implementacion > Aplicacion web.

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('JetSMART — Mis Reservas')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getReservas() {
  var hoja   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VUELOS);
  var data   = hoja.getRange('A2:R500').getDisplayValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!r[0] || !/^[A-Z0-9]{6}$/.test(r[0].trim())) continue;
    result.push({
      codigo:        r[0].trim(),
      estado:        r[1].trim(),
      reprog:        r[2].trim(),
      titular:       r[3].trim(),
      anio:          r[4].trim(),
      mes:           r[5].trim(),
      fechaIda:      r[6].trim(),
      vueloIda:      r[7].trim(),
      origenIda:     r[8].trim(),
      salidaIda:     r[9].trim(),
      destinoIda:    r[10].trim(),
      llegadaIda:    r[11].trim(),
      fechaVuelta:   r[12].trim(),
      vueloVuelta:   r[13].trim(),
      origenVuelta:  r[14].trim(),
      salidaVuelta:  r[15].trim(),
      destinoVuelta: r[16].trim(),
      llegadaVuelta: r[17].trim()
    });
  }
  return JSON.stringify(result);
}

function importarGmailWeb() {
  var hoja     = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VUELOS);
  var data     = hoja.getRange('A2:A500').getDisplayValues();
  var cargados = {};
  for (var i = 0; i < data.length; i++) {
    var c = data[i][0].trim();
    if (c) cargados[c] = true;
  }
  var threads = GmailApp.search(
    'from:jetsmart@mg.jetsmart.com subject:Itinerario newer_than:365d', 0, 50
  );
  var nuevas = [];
  for (var t = 0; t < threads.length; t++) {
    var mensajes = threads[t].getMessages();
    for (var m = 0; m < mensajes.length; m++) {
      var body   = mensajes[m].getBody();
      var parsed = parsearConfirmacion(body);
      if (!parsed) continue;
      if (cargados[parsed.codigo]) continue;
      cargados[parsed.codigo] = true;
      nuevas.push(construirFila(parsed));
    }
  }
  nuevas.sort(function(a, b) {
    var da = dmyAiso(a[6]) || '';
    var db = dmyAiso(b[6]) || '';
    return db > da ? 1 : db < da ? -1 : 0;
  });
  for (var n = 0; n < nuevas.length; n++) {
    insertarOrdenado(hoja, nuevas[n]);
  }
  return JSON.stringify({ added: nuevas.length });
}

function verificarHorariosWeb() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(SHEET_VUELOS);
  var hoy  = getHoy();
  var data = hoja.getRange('A1:R500').getDisplayValues();
  var filas = data.slice(1).filter(function(r) { return r[0] && /^[A-Z0-9]{6}$/.test(r[0]); });

  var aChequear = [];
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    if (f[1].trim() !== 'Pendiente') continue;
    var fechaIda    = dmyAiso(f[6]);
    var fechaVuelta = dmyAiso(f[12]);
    if (fechaIda && fechaIda >= hoy && f[7]) {
      aChequear.push({ codigo: f[0], leg: 'IDA', vuelo: f[7], origen: ciudadAIata(f[8]),
                       fecha: fechaIda, horaGuardada: padHora(f[9]) });
    }
    if (fechaVuelta && fechaVuelta >= hoy && f[13]) {
      aChequear.push({ codigo: f[0], leg: 'VUELTA', vuelo: f[13], origen: ciudadAIata(f[14]),
                       fecha: fechaVuelta, horaGuardada: padHora(f[15]) });
    }
  }

  var cacheDisp = {};
  var cambios   = [];

  for (var ci = 0; ci < aChequear.length; ci++) {
    var item = aChequear[ci];
    if (!cacheDisp[item.origen]) cacheDisp[item.origen] = fetchDisponibilidad(item.origen);
    var vuelos = cacheDisp[item.origen];
    var enc    = null;
    for (var v = 0; v < vuelos.length; v++) {
      if (vuelos[v].fn === item.vuelo && vuelos[v].fecha === item.fecha) { enc = vuelos[v]; break; }
    }
    if (enc && enc.hora !== item.horaGuardada) {
      var diff = diffMinutos(item.horaGuardada, enc.hora);
      cambios.push({
        codigo:    item.codigo,
        leg:       item.leg,
        vuelo:     item.vuelo,
        fecha:     isoDmy(item.fecha),
        horaAntes: item.horaGuardada,
        horaAhora: enc.hora,
        diff:      diff,
        estado:    (diff > 59 || diff <= -15) ? 'Abierto' : 'No abierto'
      });
    }
  }

  // Marcar Abierto en la hoja si corresponde
  for (var ca = 0; ca < cambios.length; ca++) {
    if (cambios[ca].estado !== 'Abierto') continue;
    for (var fi = 0; fi < filas.length; fi++) {
      if (filas[fi][0].trim() === cambios[ca].codigo) {
        hoja.getRange(fi + 2, 2).setValue('Abierto');
        break;
      }
    }
  }

  return JSON.stringify(cambios);
}

function buscarVuelosWeb(origen, destino, fecha) {
  var orig   = ciudadAIata(origen);
  var dest   = ciudadAIata(destino);
  var vuelos = buscarVuelosAPI(orig, dest, fecha);
  return JSON.stringify(vuelos);
}

function buscarCalendarioWeb(origen, destino) {
  var orig   = ciudadAIata(origen);
  var dest   = ciudadAIata(destino);
  var hoy    = getHoy();
  var futuro = Utilities.formatDate(new Date(Date.now()+400*86400000),'America/Argentina/Buenos_Aires','yyyy-MM-dd');
  var url    = 'https://origin.jsrtff.it.jetsm.art/availability/plain?_agg=&_meta=' +
               '&bt_date=' + encodeURIComponent(hoy+' 00:00:00') +
               '&bt_date=' + encodeURIComponent(futuro+' 24:00:00') +
               '&pov_c=AR&dep=' + orig;
  try {
    var r = UrlFetchApp.fetch(url, {
      headers: {'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://jetsmart.com/'},
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return JSON.stringify({});
    var dias = {};
    (JSON.parse(r.getContentText()).availability || [])
      .filter(function(f) { return f.arr === dest; })
      .forEach(function(f) {
        var fecha = f.date.substring(0,10);
        var total = f.pi && f.pi.ars ? Math.round(f.pi.ars) : null;
        var vuelo = {
          vuelo:    (f.cc||'JA') + f.fn,
          hora:     f.date.substring(11,16),
          total:    total,
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
    Object.keys(dias).forEach(function(d) {
      dias[d].vuelos.sort(function(a,b) { return (a.total||999999)-(b.total||999999); });
    });
    return JSON.stringify(dias);
  } catch(e) { return JSON.stringify({}); }
}

// ─── Estadísticas de cambio de horario ───────────────────────

var SHEET_VUELOS_HIST  = 'VuelosHistorial';
var SHEET_CAMBIOS_HIST = 'CambiosHorarios';

function obtenerVuelosRutaCompleta() {
  var hoy = getHoy();
  var fin = '2026-12-31';
  var url = 'https://origin.jsrtff.it.jetsm.art/availability/plain?_agg=&_meta=' +
            '&bt_date=' + encodeURIComponent(hoy + ' 00:00:00') +
            '&bt_date=' + encodeURIComponent(fin + ' 24:00:00') +
            '&pov_c=AR&dep=RES';
  try {
    var r = UrlFetchApp.fetch(url, {
      headers: {'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://jetsmart.com/'},
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return JSON.stringify({error: 'API error ' + r.getResponseCode()});
    var vuelos = [];
    (JSON.parse(r.getContentText()).availability || [])
      .filter(function(f) { return f.arr === 'AEP'; })
      .forEach(function(f) {
        vuelos.push({
          fecha:   f.date.substring(0,10),
          vuelo:   (f.cc||'JA') + f.fn,
          origen:  'RES',
          destino: 'AEP',
          salida:  f.date.substring(11,16),
          llegada: f.arr_date ? f.arr_date.substring(11,16) : ''
        });
      });
    vuelos.sort(function(a,b) {
      return a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : (a.salida < b.salida ? -1 : 1);
    });
    return JSON.stringify(vuelos);
  } catch(e) { return JSON.stringify({error: e.message}); }
}

function guardarBaseVuelos(json) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var vuelos = JSON.parse(json);
  if (!Array.isArray(vuelos) || vuelos.length === 0) return JSON.stringify({ok: false, msg: 'Sin datos'});
  var hoja   = ss.getSheetByName(SHEET_VUELOS_HIST) || ss.insertSheet(SHEET_VUELOS_HIST);
  hoja.clearContents(); hoja.clearFormats();
  var ahora  = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd HH:mm:ss');
  var cabecera = [['Fecha','NroVuelo','Origen','Destino','HoraSalida','HoraLlegada','Actualizado']];
  var rows = vuelos.map(function(v) {
    return [v.fecha, v.vuelo, v.origen, v.destino, v.salida, v.llegada || '', ahora];
  });
  hoja.getRange(1,1,1,7).setValues(cabecera).setBackground('#0A3560').setFontColor('#fff').setFontWeight('bold');
  hoja.getRange(2,1,rows.length,7).setValues(rows);
  hoja.setColumnWidth(1,100); hoja.setColumnWidth(2,80); hoja.setColumnWidth(5,80); hoja.setColumnWidth(6,80);
  return JSON.stringify({ok: true, total: rows.length, timestamp: ahora});
}

function actualizarCampoWeb(codigo, campo, valor) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_VUELOS);
  var data = hoja.getRange('A2:A500').getDisplayValues();
  var col  = campo === 'estado' ? 2 : 3; // B=Estado, C=Rep
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].trim() === codigo) {
      hoja.getRange(i + 2, col).setValue(valor);
      return JSON.stringify({ok: true});
    }
  }
  return JSON.stringify({ok: false, msg: 'Código no encontrado'});
}

function cargarDatosEstadisticas() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var hVH = ss.getSheetByName(SHEET_VUELOS_HIST);
  var vuelos = [];
  var baseTimestamp = '';
  if (hVH && hVH.getLastRow() > 1) {
    var dat = hVH.getRange(2,1,hVH.getLastRow()-1,7).getDisplayValues();
    dat.filter(function(r){ return r[0]; }).forEach(function(r) {
      vuelos.push({ fecha: r[0], vuelo: r[1], origen: r[2], destino: r[3], salida: r[4], llegada: r[5] });
      baseTimestamp = r[6];
    });
  }
  return JSON.stringify({
    vuelos:         vuelos,
    estadisticas:   calcularEstadisticasHist(ss),
    ultimosCambios: cargarUltimosCambios(ss, 100),
    baseTimestamp:  baseTimestamp
  });
}

function verificarCambiosEstadisticos() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var hVH = ss.getSheetByName(SHEET_VUELOS_HIST);
  if (!hVH || hVH.getLastRow() <= 1)
    return JSON.stringify({error: 'No hay base. Actualizá la base primero con el botón "Actualizar base".'});

  var datosBase = hVH.getRange(2,1,hVH.getLastRow()-1,6).getDisplayValues();
  var mapaBase  = {};
  datosBase.forEach(function(row) {
    if (row[0] && row[1]) mapaBase[row[0]+'|'+row[1]] = {salida: row[4], llegada: row[5]};
  });

  var parsed = JSON.parse(obtenerVuelosRutaCompleta());
  if (parsed.error) return JSON.stringify({error: parsed.error});
  var vuelosActuales = parsed;

  var cambios = [];
  var ahora   = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd HH:mm:ss');

  vuelosActuales.forEach(function(v) {
    var key  = v.fecha + '|' + v.vuelo;
    var base = mapaBase[key];
    if (!base) return;
    var cambioSalida  = base.salida  && v.salida  && base.salida  !== v.salida;
    var cambioLlegada = base.llegada && v.llegada && base.llegada !== v.llegada;
    if (!cambioSalida && !cambioLlegada) return;
    var diffMin = cambioSalida ? diffMinutos(base.salida, v.salida) : 0;
    cambios.push({
      fecha:          v.fecha,
      vuelo:          v.vuelo,
      salidaAnt:      base.salida,
      salidaNueva:    v.salida,
      llegadaAnt:     base.llegada,
      llegadaNueva:   v.llegada,
      diffMin:        diffMin,
      tipo:           diffMin > 0 ? 'Retraso' : (diffMin < 0 ? 'Adelanto' : 'Cambio llegada')
    });
  });

  if (cambios.length > 0) {
    var hCH = ss.getSheetByName(SHEET_CAMBIOS_HIST) || ss.insertSheet(SHEET_CAMBIOS_HIST);
    if (hCH.getLastRow() === 0) {
      hCH.getRange(1,1,1,11).setValues([[
        'FechaRegistro','FechaVuelo','NroVuelo','SalidaAnterior','SalidaNueva',
        'LlegadaAnterior','LlegadaNueva','MinutosCambio','Tipo','','']]);
      hCH.getRange(1,1,1,9).setBackground('#0A3560').setFontColor('#fff').setFontWeight('bold');
    }
    var filasCambios = cambios.map(function(c) {
      return [ahora, c.fecha, c.vuelo, c.salidaAnt, c.salidaNueva,
              c.llegadaAnt, c.llegadaNueva, c.diffMin, c.tipo, '', ''];
    });
    hCH.getRange(hCH.getLastRow()+1, 1, filasCambios.length, 11).setValues(filasCambios);

    // Actualizar base con nuevos horarios
    var mapaNuevo = {};
    vuelosActuales.forEach(function(v) { mapaNuevo[v.fecha+'|'+v.vuelo] = v; });
    var updRows = datosBase.map(function(row) {
      if (!row[0]) return row;
      var v = mapaNuevo[row[0]+'|'+row[1]];
      return v ? [row[0], row[1], row[2], row[3], v.salida, v.llegada||'', ahora] : row.concat([ahora]);
    });
    var hdr = hVH.getRange(1,1,1,7).getDisplayValues()[0];
    var fullRows = [hdr].concat(updRows);
    hVH.clearContents(); hVH.clearFormats();
    hVH.getRange(1,1,fullRows.length,7).setValues(fullRows);
    hVH.getRange(1,1,1,7).setBackground('#0A3560').setFontColor('#fff').setFontWeight('bold');
  }

  return JSON.stringify({
    cambios:        cambios,
    estadisticas:   calcularEstadisticasHist(ss),
    ultimosCambios: cargarUltimosCambios(ss, 100)
  });
}

function calcularEstadisticasHist(ss) {
  var hCH = ss.getSheetByName(SHEET_CAMBIOS_HIST);
  if (!hCH || hCH.getLastRow() <= 1) return {porDia: {}, porVuelo: {}, total: 0};
  var datos  = hCH.getRange(2,1,hCH.getLastRow()-1,9).getDisplayValues();
  var DIAS   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  var porDia = {}, porVuelo = {};
  datos.forEach(function(row) {
    if (!row[1]) return;
    var p = String(row[1]).split('-');
    if (p.length === 3) {
      var dia = DIAS[new Date(+p[0], +p[1]-1, +p[2]).getDay()];
      porDia[dia] = (porDia[dia]||0) + 1;
    }
    if (row[2]) porVuelo[row[2]] = (porVuelo[row[2]]||0) + 1;
  });
  return {porDia: porDia, porVuelo: porVuelo, total: datos.filter(function(r){ return r[0]; }).length};
}

function cargarUltimosCambios(ss, n) {
  var hCH = ss.getSheetByName(SHEET_CAMBIOS_HIST);
  if (!hCH || hCH.getLastRow() <= 1) return [];
  var lr    = hCH.getLastRow();
  var start = Math.max(2, lr - n + 1);
  var datos = hCH.getRange(start,1,lr-start+1,9).getDisplayValues();
  return datos.filter(function(r){ return r[0]; }).reverse().map(function(r) {
    return {fechaReg: r[0], fecha: r[1], vuelo: r[2], salidaAnt: r[3], salidaNueva: r[4],
            llegadaAnt: r[5], llegadaNueva: r[6], diffMin: r[7], tipo: r[8]};
  });
}

// ─── Smiles ───────────────────────────────────────────────────

var SMILES_API_KEY    = 'aJqPU7xNHl9qN3NVZnPaJ208aPo2Bh2p2ZV844tw';
var SMILES_MEMBER     = '172264702';
var SMILES_SEARCH_URL = 'https://api-air-flightsearch-blue.smiles.com.ar/v1/airlines/search';

function smilesHeaders_() {
  return {
    'accept':          'application/json, text/plain, */*',
    'accept-language': 'es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'channel':         'Mobile',
    'language':        'es-ES',
    'origin':          'https://www.smiles.com.ar',
    'referer':         'https://www.smiles.com.ar/',
    'region':          'ARGENTINA',
    'x-api-key':       SMILES_API_KEY,
    'user-agent':      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36'
  };
}

// Diagnóstico desde editor Apps Script — usa rutas reales de Aerolíneas Argentinas
function testSmilesApi() {
  var tz    = 'America/Argentina/Buenos_Aires';
  var fecha = Utilities.formatDate(new Date(Date.now() + 30*86400000), tz, 'yyyy-MM-dd');
  var url   = smilesBuildUrl_('AEP', 'COR', fecha);
  Logger.log('URL: ' + url);
  try {
    var r    = UrlFetchApp.fetch(url, { headers: smilesHeaders_(), muteHttpExceptions: true });
    var code = r.getResponseCode();
    var body = r.getContentText();
    Logger.log('HTTP ' + code);
    Logger.log('Body: ' + body.substring(0, 1000));
    var vuelos = code === 200 ? parsearSmiles_(body) : [];
    SpreadsheetApp.getUi().alert('AEP→COR ' + fecha + '\nHTTP ' + code + ' | ' + vuelos.length + ' vuelos\n\n' + body.substring(0, 400));
  } catch(e) {
    Logger.log('Error: ' + e.message);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

function diagnosticoSmilesWeb() {
  var tz  = 'America/Argentina/Buenos_Aires';
  var f30 = Utilities.formatDate(new Date(Date.now() + 30*86400000), tz, 'yyyy-MM-dd');
  var f60 = Utilities.formatDate(new Date(Date.now() + 60*86400000), tz, 'yyyy-MM-dd');
  var tests = [
    { orig: 'AEP', dest: 'COR', fecha: f30 },
    { orig: 'AEP', dest: 'MDZ', fecha: f30 },
    { orig: 'EZE', dest: 'GRU', fecha: f60 }
  ];
  var results = [];
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      var r    = UrlFetchApp.fetch(smilesBuildUrl_(t.orig, t.dest, t.fecha), {
                   headers: smilesHeaders_(), muteHttpExceptions: true });
      var code = r.getResponseCode();
      var body = r.getContentText();
      var vuelos = code === 200 ? parsearSmiles_(body) : [];
      results.push({ ruta: t.orig + '→' + t.dest + ' ' + t.fecha, status: code, vuelos: vuelos.length, preview: body.substring(0, 150) });
    } catch(e) {
      results.push({ ruta: t.orig + '→' + t.dest, status: 0, vuelos: 0, error: e.message });
    }
  }
  return JSON.stringify({ tests: results });
}

function smPad2_(n) { return (n < 10 ? '0' : '') + n; }

function parsearSmiles_(texto) {
  try {
    var data = JSON.parse(texto);
    if (!data || !data.requestedFlightSegmentList) return [];
    var seg = data.requestedFlightSegmentList[0];
    if (!seg || !seg.flightList) return [];

    return seg.flightList.map(function(f) {
      var fares = {};
      (f.fareList || []).forEach(function(fare) {
        if (fare.type && fare.miles > 0) {
          fares[fare.type] = { miles: fare.miles || 0, money: fare.money || 0 };
        }
      });

      // Número de vuelo principal
      var numVuelo = '';
      if (f.legList && f.legList.length > 0) {
        var mainLeg = null;
        for (var li = 0; li < f.legList.length; li++) {
          if (f.legList[li].isMainLeg === true || f.legList[li].isMainLeg === 'true') {
            mainLeg = f.legList[li]; break;
          }
        }
        if (!mainLeg) mainLeg = f.legList[0];
        numVuelo = (mainLeg.marketingAirline ? mainLeg.marketingAirline.code : '') + (mainLeg.flightNumber || '');
      }

      // Escala intermedia
      var escalaInfo = '';
      if (f.stops > 0 && f.airportMainStop) {
        var ts = f.timeStop ? (f.timeStop.hours + 'h' + (f.timeStop.minutes > 0 ? f.timeStop.minutes + 'min' : '')) : '';
        escalaInfo = f.airportMainStop.code + (ts ? ' (' + ts + ')' : '');
      }

      return {
        vuelo:     numVuelo,
        salida:    f.departure ? f.departure.date.substring(11,16) : '',
        llegada:   f.arrival   ? f.arrival.date.substring(11,16)   : '',
        duracion:  f.duration  ? (f.duration.hours + 'h' + (f.duration.minutes > 0 ? f.duration.minutes + 'min' : '')) : '',
        paradas:   f.stops || 0,
        escala:    escalaInfo,
        asientos:  f.availableSeats || 0,
        impARS:    f.airlineTax || 0,
        impMillas: f.airlineTaxMiles || 0,
        aerolinea: f.airline ? f.airline.name : '',
        fares:     fares
      };
    }).filter(function(v) {
      return v.fares.SMILES || v.fares.SMILES_CLUB || v.fares.SMILES_MONEY;
    });
  } catch(e) { return []; }
}

function smilesBuildUrl_(orig, dest, fecha) {
  return SMILES_SEARCH_URL +
    '?adults=1&cabinType=all&children=0&currencyCode=ARS' +
    '&departureDate=' + fecha +
    '&destinationAirportCode=' + dest +
    '&infants=0&isFlexibleDateChecked=false' +
    '&originAirportCode=' + orig +
    '&tripType=1&forceCongener=false' +
    '&memberNumber=' + SMILES_MEMBER + '&r=ar';
}

function buscarSmilesDiaWeb(origen, destino, fecha) {
  try {
    var r = UrlFetchApp.fetch(smilesBuildUrl_(origen, destino, fecha), {
      headers: smilesHeaders_(), muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return JSON.stringify([]);
    return JSON.stringify(parsearSmiles_(r.getContentText()));
  } catch(e) { return JSON.stringify([]); }
}

function buscarSmilesCalendarioWeb(origen, destino, anio, mes) {
  var anioN   = parseInt(anio);
  var mesN    = parseInt(mes);
  var hoy     = getHoy();
  var diasMes = new Date(anioN, mesN, 0).getDate();

  var requests = [];
  var fechas   = [];

  for (var d = 1; d <= diasMes; d++) {
    var fecha = anio + '-' + smPad2_(mesN) + '-' + smPad2_(d);
    if (fecha < hoy) continue;
    requests.push({ url: smilesBuildUrl_(origen, destino, fecha), headers: smilesHeaders_(), muteHttpExceptions: true });
    fechas.push(fecha);
  }

  if (requests.length === 0) return JSON.stringify({});

  var resps     = UrlFetchApp.fetchAll(requests);
  var resultado = {};
  var debugCodes = [];

  for (var i = 0; i < resps.length; i++) {
    var code = resps[i].getResponseCode();
    debugCodes.push(code);
    if (code !== 200) continue;
    var vuelos = parsearSmiles_(resps[i].getContentText());
    if (vuelos.length === 0) continue;

    var minMillas = null;
    for (var vi = 0; vi < vuelos.length; vi++) {
      var m = vuelos[vi].fares.SMILES ? vuelos[vi].fares.SMILES.miles : null;
      if (m && m > 0 && (minMillas === null || m < minMillas)) minMillas = m;
    }

    resultado[fechas[i]] = { minMillas: minMillas, vuelos: vuelos };
  }

  if (Object.keys(resultado).length === 0 && resps.length > 0) {
    var previews = [];
    for (var j = 0; j < Math.min(2, resps.length); j++) {
      previews.push(resps[j].getContentText().substring(0, 200));
    }
    resultado['_debug'] = { codigos: debugCodes.slice(0, 10).join(','), previews: previews };
  }

  return JSON.stringify(resultado);
}
