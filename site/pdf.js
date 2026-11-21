const { chromium } = require('playwright');
(async () => {
  const name = process.argv[2];
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/dist/' + name + '-Apparel-Profile-2026-11.html'); await p.waitForTimeout(1200);
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: 'dist/' + name + '-Apparel-Profile-2026-11.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close(); console.log('pdf ok');
})();
