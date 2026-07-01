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

module.exports = { getGmailClient, buscarEmailsItinerario };
