const puppeteer = require('puppeteer');

async function main() {
  const browser = await puppeteer.launch({
    headless: false,  // visible para debug
    args: ['--no-sandbox', '--start-maximized']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });

  console.log('Cargando jetsmart.com...');
  await page.goto('https://jetsmart.com/ar/es', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'step1_home.png' });
  console.log('Screenshot home guardado');

  // Buscar el campo de origen
  const html = await page.content();
  const text = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('Texto visible:', text);

  // Buscar inputs de búsqueda
  const inputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].map(i => ({
      id: i.id,
      name: i.name,
      placeholder: i.placeholder,
      type: i.type,
      class: i.className.substring(0, 60)
    }));
  });
  console.log('\nInputs encontrados:', JSON.stringify(inputs, null, 2));

  // Buscar botones
  const buttons = await page.evaluate(() => {
    return [...document.querySelectorAll('button, [role="button"], [type="submit"]')].slice(0, 10).map(b => ({
      text: b.innerText?.trim().substring(0, 50),
      id: b.id,
      class: b.className.substring(0, 60)
    }));
  });
  console.log('\nBotones encontrados:', JSON.stringify(buttons, null, 2));

  await browser.close();
}

main().catch(console.error);
