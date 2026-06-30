const puppeteer = require('puppeteer');

// Vuelo de prueba: YY34GJ — RES→AEP 18/06/2026, horario guardado 23:53
const SEARCH = { origin: 'RES', dest: 'AEP', date: '2026-06-18', dateDisp: '18' };

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  // Capture ALL JSON API responses
  const captured = [];
  page.on('response', async (res) => {
    const url = res.url();
    const ct  = (res.headers()['content-type'] || '');
    if (!ct.includes('json')) return;
    try {
      const body = await res.text();
      captured.push({ url, status: res.status(), body });
    } catch {}
  });

  console.log('1. Navegando a la página de búsqueda...');
  await page.goto('https://booking.jetsmart.com/V2/Flight', {
    waitUntil: 'networkidle2', timeout: 60000,
  });

  await new Promise(r => setTimeout(r, 2000));

  // Try to find and click "Solo Ida" if needed
  try {
    const oneWayBtn = await page.$x('//button[contains(text(),"Solo Ida") or contains(text(),"One way")]');
    if (oneWayBtn.length) { await oneWayBtn[0].click(); await new Promise(r => setTimeout(r, 500)); }
  } catch {}

  // ── Fill origin ────────────────────────────────────────────────────────────
  console.log('2. Completando origen:', SEARCH.origin);
  try {
    // Try common selectors for origin input
    const originSelectors = [
      'input[id*="origin"]', 'input[placeholder*="Origen"]',
      'input[placeholder*="Desde"]', '[data-testid*="origin"] input',
      '#OriginStation', 'input[name*="origin"]',
    ];
    let originInput = null;
    for (const sel of originSelectors) {
      originInput = await page.$(sel);
      if (originInput) { console.log('  → selector:', sel); break; }
    }
    if (originInput) {
      await originInput.triple_click?.() || await originInput.click({ clickCount: 3 });
      await originInput.type(SEARCH.origin, { delay: 80 });
      await new Promise(r => setTimeout(r, 1500));
      // Click first suggestion
      const suggestion = await page.$('[class*="suggestion"], [class*="autocomplete"] li, [class*="dropdown"] li');
      if (suggestion) await suggestion.click();
    } else {
      console.log('  → No se encontró input de origen');
    }
  } catch (e) { console.log('  → Error origen:', e.message.substring(0,80)); }

  await new Promise(r => setTimeout(r, 1000));

  // ── Fill destination ───────────────────────────────────────────────────────
  console.log('3. Completando destino:', SEARCH.dest);
  try {
    const destSelectors = [
      'input[id*="dest"]', 'input[placeholder*="Destino"]',
      'input[placeholder*="Hasta"]', '[data-testid*="dest"] input',
      '#DestinationStation', 'input[name*="dest"]',
    ];
    let destInput = null;
    for (const sel of destSelectors) {
      destInput = await page.$(sel);
      if (destInput) { console.log('  → selector:', sel); break; }
    }
    if (destInput) {
      await destInput.click({ clickCount: 3 });
      await destInput.type(SEARCH.dest, { delay: 80 });
      await new Promise(r => setTimeout(r, 1500));
      const suggestion = await page.$('[class*="suggestion"], [class*="autocomplete"] li, [class*="dropdown"] li');
      if (suggestion) await suggestion.click();
    } else {
      console.log('  → No se encontró input de destino');
    }
  } catch (e) { console.log('  → Error destino:', e.message.substring(0,80)); }

  await new Promise(r => setTimeout(r, 1000));

  // Dump all input fields to understand the form structure
  console.log('\n--- INPUTS EN LA PÁGINA ---');
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, button')).slice(0, 30).map(el => ({
      tag: el.tagName, type: el.type, id: el.id, name: el.name,
      placeholder: el.placeholder, class: el.className.substring(0, 60),
      value: el.value?.substring(0, 30),
    }))
  );
  console.log(JSON.stringify(inputs, null, 2));

  // Screenshot for debugging
  await page.screenshot({ path: 'jetsmart_debug.png', fullPage: false });
  console.log('\nScreenshot guardado: jetsmart_debug.png');

  console.log('\n--- API CALLS JSON CAPTURADAS ---');
  for (const r of captured) {
    if (r.url.includes('manifest') || r.url.includes('fingerprint')) continue;
    console.log(`\n[${r.status}] ${r.url}`);
    console.log(r.body.substring(0, 300));
  }

  await browser.close();
}

main().catch(console.error);
