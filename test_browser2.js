import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });
  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });
  // Navigate to root to get Vite's dev server client environment loaded
  await page.goto('http://localhost:5173/');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/src/features/cases/CaseFormPage.tsx';
    document.head.appendChild(script);
  });
  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
})();
