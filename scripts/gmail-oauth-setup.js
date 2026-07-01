// Setup de un solo uso para autorizar acceso de solo lectura a Gmail.
//
// Antes de correr esto:
//   1. En Google Cloud Console: habilitar "Gmail API" en el proyecto.
//   2. Crear credenciales OAuth Client ID, tipo "Desktop app".
//   3. Poner GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET de esas credenciales en tu .env local.
//
// Uso:
//   node scripts/gmail-oauth-setup.js
//
// Te va a imprimir una URL: abrila, iniciá sesión con tu cuenta de Gmail (santiago.hector.sanchez@gmail.com),
// aceptá el permiso de solo lectura. Vas a ver "App no verificada" -> Avanzado -> Ir a JetSMART (inseguro),
// es tu propia app. Al terminar te imprime el GMAIL_REFRESH_TOKEN para pegar en tu .env y en Vercel.

require('dotenv').config();
const http = require('http');
const { OAuth2Client } = require('google-auth-library');

const PORT = 8099;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
  console.error('Falta GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET en tu .env. Creá el OAuth Client en Google Cloud Console primero.');
  process.exit(1);
}

const oauth2Client = new OAuth2Client(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // fuerza a devolver refresh_token aunque ya hayas autorizado antes
  scope: ['https://www.googleapis.com/auth/gmail.readonly']
});

console.log('\nAbrí esta URL en el navegador y aceptá el permiso de solo lectura de Gmail:\n');
console.log(authUrl + '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) { res.end(); return; }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('No llegó el código de autorización. Cerrá esta pestaña e intentá de nuevo.');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('Listo, ya podés cerrar esta pestaña y volver a la terminal.');
    console.log('\nGMAIL_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
    console.log('Pegá esa línea en tu .env y agregala también como variable de entorno en Vercel.');
  } catch (e) {
    res.end('Error al canjear el código: ' + e.message);
    console.error('Error:', e.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`Esperando el callback en ${REDIRECT_URI} ...`);
});
