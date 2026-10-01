const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5176/');
  await page.waitForTimeout(2000);
  
  const box = await page.evaluate(() => {
    const btn = document.querySelector('#nav-overview');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  
  if (!box) {
    console.log("No overview button found");
    await browser.close();
    return;
  }
  
  const hit = await page.evaluate((box) => {
    const el = document.elementFromPoint(box.x, box.y);
    return {
      tagName: el ? el.tagName : 'none',
      id: el ? el.id : 'none',
      className: el ? el.className : 'none'
    };
  }, box);
  
  console.log("Element at Overview center:", hit);

  const testClick = await page.evaluate((box) => {
    const btn = document.elementFromPoint(box.x, box.y);
    if (!btn) return false;
    btn.click();
    return true;
  }, box);
  
  console.log("Click dispatched to element:", testClick);

  await browser.close();
})();
