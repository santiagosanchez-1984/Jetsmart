const { authenticate } = require('./auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1X-lphu41ZblI50gGmPoCgmHW_Zy8cfcsNd-BOvhVb-k';

function hex(h) {
  return {
    red:   parseInt(h.slice(1,3), 16) / 255,
    green: parseInt(h.slice(3,5), 16) / 255,
    blue:  parseInt(h.slice(5,7), 16) / 255
  };
}

function cellFmt(bg, fg, bold, size, align) {
  return {
    backgroundColor: hex(bg),
    textFormat: { foregroundColor: hex(fg), bold: !!bold, fontSize: size || 10 },
    horizontalAlignment: align || 'CENTER',
    verticalAlignment: 'MIDDLE'
  };
}

// Horarios confirmados por API oficial JetSmart (https://origin.jsrtff.it.jetsm.art/availability/plain)
// consultada el 10/06/2026. Llegada estimada = salida + 1:30h.
// Días sin vuelo omitidos (Jun 27 Sáb, Jul Sáb, Jul Mar, Ago Mar).
// Ago 26 Mié: PENDIENTE (ausente en API, probable publicación tardía).
const DATOS = [
  ['FECHA','DÍA','MES','VUELO','SALE RES','LLEGA AEP','ESTADO'],

  ['──','── JUNIO ──────────────────','Junio','','','',''],
  ['10/06/2026','Miércoles','Junio','JA3065','22:23','23:53','CONFIRMADO'],
  ['11/06/2026','Jueves',   'Junio','JA3063','23:53','01:23','CONFIRMADO'],
  ['12/06/2026','Viernes',  'Junio','JA3065','19:08','20:38','CONFIRMADO'],
  ['13/06/2026','Sábado',   'Junio','JA3065','18:59','20:29','CONFIRMADO'],
  ['14/06/2026','Domingo',  'Junio','JA3063','23:59','01:29','CONFIRMADO'],
  ['15/06/2026','Lunes',    'Junio','JA3065','23:08','00:38','CONFIRMADO'],
  ['16/06/2026','Martes',   'Junio','JA3063','23:59','01:29','CONFIRMADO'],
  ['17/06/2026','Miércoles','Junio','JA3065','22:23','23:53','CONFIRMADO'],
  ['18/06/2026','Jueves',   'Junio','JA3063','23:53','01:23','CONFIRMADO'],
  ['19/06/2026','Viernes',  'Junio','JA3065','19:08','20:38','CONFIRMADO'],
  ['20/06/2026','Sábado',   'Junio','JA3065','18:59','20:29','CONFIRMADO'],
  ['21/06/2026','Domingo',  'Junio','JA3063','23:59','01:29','CONFIRMADO'],
  ['22/06/2026','Lunes',    'Junio','JA3065','22:58','00:28','CONFIRMADO'],
  ['23/06/2026','Martes',   'Junio','JA3063','23:14','00:44','CONFIRMADO'],
  ['24/06/2026','Miércoles','Junio','JA3065','22:23','23:53','CONFIRMADO'],
  ['25/06/2026','Jueves',   'Junio','JA3063','23:58','01:28','CONFIRMADO'],
  ['26/06/2026','Viernes',  'Junio','JA3065','19:08','20:38','CONFIRMADO'],
  ['28/06/2026','Domingo',  'Junio','JA3063','23:59','01:29','CONFIRMADO'],
  ['29/06/2026','Lunes',    'Junio','JA3065','22:58','00:28','CONFIRMADO'],
  ['30/06/2026','Martes',   'Junio','JA3063','23:07','00:37','CONFIRMADO'],

  ['──','── JULIO ──────────────────','Julio','','','',''],
  ['01/07/2026','Miércoles','Julio','JA3065','22:53','00:23','CONFIRMADO'],
  ['02/07/2026','Jueves',   'Julio','JA3063','18:50','20:20','CONFIRMADO'],
  ['03/07/2026','Viernes',  'Julio','JA3063','22:45','00:15','CONFIRMADO'],
  ['05/07/2026','Domingo',  'Julio','JA3063','16:29','17:59','CONFIRMADO'],
  ['06/07/2026','Lunes',    'Julio','JA3065','22:59','00:29','CONFIRMADO'],
  ['08/07/2026','Miércoles','Julio','JA3065','22:53','00:23','CONFIRMADO'],
  ['09/07/2026','Jueves',   'Julio','JA3063','18:50','20:20','CONFIRMADO'],
  ['10/07/2026','Viernes',  'Julio','JA3063','22:45','00:15','CONFIRMADO'],
  ['12/07/2026','Domingo',  'Julio','JA3063','16:29','17:59','CONFIRMADO'],
  ['13/07/2026','Lunes',    'Julio','JA3065','22:59','00:29','CONFIRMADO'],
  ['15/07/2026','Miércoles','Julio','JA3065','22:53','00:23','CONFIRMADO'],
  ['16/07/2026','Jueves',   'Julio','JA3063','18:50','20:20','CONFIRMADO'],
  ['17/07/2026','Viernes',  'Julio','JA3063','22:45','00:15','CONFIRMADO'],
  ['19/07/2026','Domingo',  'Julio','JA3063','16:29','17:59','CONFIRMADO'],
  ['20/07/2026','Lunes',    'Julio','JA3065','22:59','00:29','CONFIRMADO'],
  ['22/07/2026','Miércoles','Julio','JA3065','22:53','00:23','CONFIRMADO'],
  ['23/07/2026','Jueves',   'Julio','JA3063','18:50','20:20','CONFIRMADO'],
  ['24/07/2026','Viernes',  'Julio','JA3063','22:45','00:15','CONFIRMADO'],
  ['26/07/2026','Domingo',  'Julio','JA3063','16:29','17:59','CONFIRMADO'],
  ['27/07/2026','Lunes',    'Julio','JA3065','22:59','00:29','CONFIRMADO'],
  ['29/07/2026','Miércoles','Julio','JA3065','22:53','00:23','CONFIRMADO'],
  ['30/07/2026','Jueves',   'Julio','JA3063','18:50','20:20','CONFIRMADO'],
  ['31/07/2026','Viernes',  'Julio','JA3063','22:45','00:15','CONFIRMADO'],

  ['──','── AGOSTO ─────────────────','Agosto','','','',''],
  ['02/08/2026','Domingo',  'Agosto','JA3063','18:55','20:25','CONFIRMADO'],
  ['03/08/2026','Lunes',    'Agosto','JA3065','22:53','00:23','CONFIRMADO'],
  ['05/08/2026','Miércoles','Agosto','JA3065','22:55','00:25','CONFIRMADO'],
  ['06/08/2026','Jueves',   'Agosto','JA3063','18:50','20:20','CONFIRMADO'],
  ['07/08/2026','Viernes',  'Agosto','JA3063','22:52','00:22','CONFIRMADO'],
  ['08/08/2026','Sábado',   'Agosto','JA3065','19:08','20:38','CONFIRMADO'],
  ['09/08/2026','Domingo',  'Agosto','JA3063','18:55','20:25','CONFIRMADO'],
  ['10/08/2026','Lunes',    'Agosto','JA3065','22:53','00:23','CONFIRMADO'],
  ['12/08/2026','Miércoles','Agosto','JA3065','22:55','00:25','CONFIRMADO'],
  ['13/08/2026','Jueves',   'Agosto','JA3063','18:50','20:20','CONFIRMADO'],
  ['14/08/2026','Viernes',  'Agosto','JA3063','22:52','00:22','CONFIRMADO'],
  ['15/08/2026','Sábado',   'Agosto','JA3065','19:08','20:38','CONFIRMADO'],
  ['16/08/2026','Domingo',  'Agosto','JA3063','18:35','20:05','CONFIRMADO'],
  ['17/08/2026','Lunes',    'Agosto','JA3065','22:53','00:23','CONFIRMADO'],
  ['19/08/2026','Miércoles','Agosto','JA3065','22:55','00:25','CONFIRMADO'],
  ['20/08/2026','Jueves',   'Agosto','JA3063','18:50','20:20','CONFIRMADO'],
  ['21/08/2026','Viernes',  'Agosto','JA3063','22:52','00:22','CONFIRMADO'],
  ['22/08/2026','Sábado',   'Agosto','JA3065','19:08','20:38','CONFIRMADO'],
  ['23/08/2026','Domingo',  'Agosto','JA3063','18:35','20:05','CONFIRMADO'],
  ['24/08/2026','Lunes',    'Agosto','JA3065','22:53','00:23','CONFIRMADO'],
  ['26/08/2026','Miércoles','Agosto','JA3065','?','?','PENDIENTE'],
  ['27/08/2026','Jueves',   'Agosto','JA3063','19:00','20:30','CONFIRMADO'],
  ['28/08/2026','Viernes',  'Agosto','JA3063','22:52','00:22','CONFIRMADO'],
  ['29/08/2026','Sábado',   'Agosto','JA3065','19:08','20:38','CONFIRMADO'],
  ['30/08/2026','Domingo',  'Agosto','JA3063','18:35','20:05','CONFIRMADO'],
];

async function main() {
  const auth   = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta    = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = meta.data.sheets[0].properties.sheetId;
  console.log('Sheet ID:', sheetId);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A1:Z300'
  });
  console.log('Contenido limpiado');

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values: DATOS }
  });
  console.log('Datos escritos:', DATOS.length, 'filas');

  const requests = [];

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, title: 'Vuelos RES → AEP' },
      fields: 'title'
    }
  });

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount'
    }
  });

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: DATOS.length, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: {} },
      fields: 'userEnteredFormat'
    }
  });

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: cellFmt('#1A237E', '#FFFFFF', true, 11, 'CENTER') },
      fields: 'userEnteredFormat'
    }
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 38 },
      fields: 'pixelSize'
    }
  });

  const BG = {
    Junio_conf:  '#DBEAFE', Junio_pend:  '#FEF9C3',
    Julio_conf:  '#DCFCE7', Julio_pend:  '#FEF9C3',
    Agosto_conf: '#EDE9FE', Agosto_pend: '#FEF9C3',
  };

  for (let i = 1; i < DATOS.length; i++) {
    const r  = DATOS[i];
    const ri = i;

    if (r[0] === '──') {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: ri, endRowIndex: ri + 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: { userEnteredFormat: cellFmt('#374151', '#FFFFFF', true, 10, 'CENTER') },
          fields: 'userEnteredFormat'
        }
      });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: ri, endIndex: ri + 1 },
          properties: { pixelSize: 24 },
          fields: 'pixelSize'
        }
      });
      continue;
    }

    const mes     = r[2];
    const pending = r[6] === 'PENDIENTE';
    const bg      = BG[mes + (pending ? '_pend' : '_conf')] || '#FFFFFF';

    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: ri, endRowIndex: ri + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: { backgroundColor: hex(bg), textFormat: { fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat'
      }
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: ri, endRowIndex: ri + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: hex(bg), textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat'
      }
    });

    const timeFg = pending ? '#92400E' : '#1E3A5F';
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: ri, endRowIndex: ri + 1, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { backgroundColor: hex(bg), textFormat: { bold: true, fontSize: 12, foregroundColor: hex(timeFg) }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat'
      }
    });

    const estadoBg = pending ? '#FDE68A' : '#A7F3D0';
    const estadoFg = pending ? '#78350F' : '#065F46';
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: ri, endRowIndex: ri + 1, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { backgroundColor: hex(estadoBg), textFormat: { bold: true, fontSize: 10, foregroundColor: hex(estadoFg) }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat'
      }
    });

    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: ri, endIndex: ri + 1 },
        properties: { pixelSize: 22 },
        fields: 'pixelSize'
      }
    });
  }

  [115, 100, 80, 80, 140, 140, 110].forEach((px, ci) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize'
      }
    });
  });

  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: DATOS.length, startColumnIndex: 0, endColumnIndex: 7 },
      top:    { style: 'SOLID', color: hex('#B0BEC5') },
      bottom: { style: 'SOLID', color: hex('#B0BEC5') },
      left:   { style: 'SOLID', color: hex('#B0BEC5') },
      right:  { style: 'SOLID', color: hex('#B0BEC5') },
      innerHorizontal: { style: 'SOLID', color: hex('#B0BEC5') },
      innerVertical:   { style: 'SOLID', color: hex('#B0BEC5') }
    }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests }
  });
  console.log('✅ Formato aplicado —', requests.length, 'operaciones');
  console.log('Planilla lista: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
