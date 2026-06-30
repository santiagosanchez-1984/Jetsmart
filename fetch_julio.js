const https = require('https');

const url = 'https://origin.jsrtff.it.jetsm.art/availability/plain' +
  '?_agg=&_meta=' +
  '&bt_date=' + encodeURIComponent('2026-06-10 00:00:00') +
  '&bt_date=' + encodeURIComponent('2026-09-01 24:00:00') +
  '&pov_c=AR&dep=RES';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://jetsmart.com/' } }, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const json = JSON.parse(data);
    const flights = (json.availability || []).filter(f => f.arr === 'AEP');

    // Mostrar estructura completa del primer vuelo
    console.log('=== ESTRUCTURA DEL PRIMER VUELO ===');
    console.log(JSON.stringify(flights[0], null, 2));

    // Mostrar todos los vuelos con llegada si está disponible
    const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    console.log('\n=== TODOS LOS VUELOS RES→AEP ===');
    let lastMes = '';
    for (const f of flights.sort((a,b) => a.date.localeCompare(b.date))) {
      const d   = new Date(f.date + (f.date.length === 10 ? 'T12:00:00' : ''));
      const mes = f.date.substring(5, 7);
      if (mes !== lastMes) {
        const MESES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep'];
        console.log('\n--- ' + MESES[parseInt(mes)] + ' ---');
        lastMes = mes;
      }
      const dep  = f.date.substring(11, 16) || '?';
      const arr  = f.arr_date ? f.arr_date.substring(11, 16) : (f.arrival_time || f.arrTime || f.eta || '?');
      const dia  = DIAS[d.getDay()];
      console.log(`  ${f.date.substring(0,10)}  ${dia}  JA${f.fn}  ${dep} → ${arr}`);
    }
  });
}).on('error', e => console.error(e.message));
