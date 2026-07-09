const { google } = require('googleapis');

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function extraerHtml(payload) {
  function walk(part) {
    if (part.mimeType === 'text/html' && part.body && part.body.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf8');
    }
    if (part.parts) {
      for (const p of part.parts) {
        const found = walk(p);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(payload) || '';
}

// Equivalente a GmailApp.search('from:jetsmart@mg.jetsmart.com subject:Itinerario newer_than:365d', 0, 50)
async function buscarEmailsItinerario() {
  const gmail = getGmailClient();
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:jetsmart@mg.jetsmart.com subject:Itinerario newer_than:365d',
    maxResults: 50
  });
  const messages = listRes.data.messages || [];
  const bodies = [];
  for (const m of messages) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const body = extraerHtml(msg.data.payload);
    if (body) bodies.push(body);
  }
  return bodies;
}

// Busca el email de itinerario MAS RECIENTE para un codigo de reserva puntual.
// A diferencia de buscarEmailsItinerario() (que trae solo los ultimos N emails
// del buzon), esta busqueda es dirigida por codigo, asi que siempre encuentra
// el estado mas actual de esa reserva sin importar cuantos emails mas nuevos
// de OTRAS reservas haya en el medio.
async function buscarEmailPorCodigo(gmail, codigo) {
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `from:jetsmart@mg.jetsmart.com subject:Itinerario ${codigo}`,
    maxResults: 1,
  });
  const messages = listRes.data.messages || [];
  if (!messages.length) return null;
  const msg = await gmail.users.messages.get({ userId: 'me', id: messages[0].id, format: 'full' });
  return extraerHtml(msg.data.payload) || null;
}

// Corre `fn` sobre `items` con a lo sumo `concurrencia` en simultaneo.
async function mapConcurrencia(items, concurrencia, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i], i);
    }
  }
  await Promise.all(new Array(Math.min(concurrencia, items.length)).fill(0).map(trabajador));
  return resultados;
}

module.exports = { getGmailClient, buscarEmailsItinerario, buscarEmailPorCodigo, mapConcurrencia };
