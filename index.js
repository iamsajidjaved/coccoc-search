const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');

puppeteer.use(StealthPlugin());

async function getDomains(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch (err) {
    console.error('Failed to read domains.txt:', err);
    return [];
  }
}

async function fetchXML(url) {
  try {
    const res = await axios.get(url, { timeout: 15000 });
    return res.data;
  } catch (err) {
    console.error('Failed to fetch:', url, err.message);
    return null;
  }
}

async function parseSitemapIndex(xml) {
  try {
    const result = await xml2js.parseStringPromise(xml);
    const sitemaps = result.sitemapindex.sitemap.map(s => s.loc[0]);
    return sitemaps;
  } catch (err) {
    console.error('Failed to parse sitemap index:', err.message);
    return [];
  }
}

async function parseSitemap(xml) {
  try {
    const result = await xml2js.parseStringPromise(xml);
    if (result.urlset && result.urlset.url) {
      return result.urlset.url.map(u => u.loc[0]);
    }
    return [];
  } catch (err) {
    console.error('Failed to parse sitemap:', err.message);
    return [];
  }
}

async function submitToCocCoc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto('https://coccoc.com/search/console/en/get-your-website-on-coc-coc-search', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('Page loaded, waiting for form...');
    await page.waitForSelector('input#site', { timeout: 30000 });
    
    // CRITICAL: Prevent any premature form submission
    await page.evaluate(() => {
      const form = document.querySelector('form.default_form');
      if (form) {
        // Block form submission until we're ready
        form.addEventListener('submit', (e) => {
          if (!window.__urlEntryComplete) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Blocked premature form submission');
          }
        }, { capture: true });
      }
    });

    console.log('Entering URL:', url);
    // Clear the input field first
    await page.evaluate(() => {
      const input = document.querySelector('input#site');
      if (input) input.value = '';
    });

    // Type the URL with a small delay between keystrokes
    await page.type('input#site', url, { delay: 100 });
    
    // Multiple checks to ensure URL is fully entered
    console.log('Verifying URL entry...');
    await page.waitForFunction((expected) => {
      const input = document.querySelector('input#site');
      return input && input.value === expected;
    }, { timeout: 20000 }, url);

    // Triple-check the value is correct
    await page.waitForTimeout(500);
    const enteredValue = await page.evaluate(() => {
      const input = document.querySelector('input#site');
      return input ? input.value : '';
    });

    if (enteredValue !== url) {
      throw new Error(`URL mismatch! Expected: ${url}, Got: ${enteredValue}`);
    }

    console.log('URL verified:', enteredValue);

    // Mark URL entry as complete
    await page.evaluate(() => {
      window.__urlEntryComplete = true;
    });

    console.log('Waiting for captcha to be solved...');
    
    // Wait for captcha to be actually solved (check for response token)
    await page.waitForFunction(() => {
      const response = document.querySelector('#g-recaptcha-response');
      return response && response.value && response.value.length > 0;
    }, { timeout: 45000 });

    console.log('Captcha appears to be solved, waiting additional time...');
    await page.waitForTimeout(2000);

    // Final verification before submit
    const finalUrl = await page.evaluate(() => {
      const input = document.querySelector('input#site');
      return input ? input.value : '';
    });

    if (finalUrl !== url) {
      throw new Error(`URL changed before submit! Expected: ${url}, Got: ${finalUrl}`);
    }

    console.log('Submitting form...');
    await page.click('form.default_form button[type="submit"]');
    await page.waitForTimeout(5000);
    console.log('Submission complete for:', url);

  } catch (err) {
    console.error('Error in submitToCocCoc for URL:', url, err.message);
  } finally {
    await page.close();
  }
}

function loadProgress(progressPath) {
  try {
    if (fs.existsSync(progressPath)) {
      return JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to read progress file:', err);
  }
  return { completed: {} };
}

function saveProgress(progressPath, progress) {
  try {
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write progress file:', err);
  }
}



(async () => {
  const args = process.argv.slice(2);
  const resetFlag = args.includes('--reset');
  const domains = await getDomains(path.join(__dirname, 'domains.txt'));
  if (domains.length === 0) {
    console.error('No domains found in domains.txt');
    process.exit(1);
  }

  const progressPath = path.join(__dirname, 'progress.json');
  if (resetFlag) {
    // Clear progress.json
    try {
      fs.writeFileSync(progressPath, JSON.stringify({ completed: {} }, null, 2), 'utf-8');
      console.log('Progress has been reset.');
    } catch (err) {
      console.error('Failed to reset progress file:', err);
    }
  }
  const progress = loadProgress(progressPath);

  const extensionPath = path.join(__dirname, 'rektcaptcha');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  for (const domain of domains) {
    if (!progress.completed[domain]) progress.completed[domain] = [];
    const sitemapIndexUrl = domain.replace(/\/$/, '') + '/sitemap_index.xml';
    const sitemapIndexXML = await fetchXML(sitemapIndexUrl);
    if (!sitemapIndexXML) continue;
    const sitemapUrls = await parseSitemapIndex(sitemapIndexXML);
    for (const sitemapUrl of sitemapUrls) {
      const sitemapXML = await fetchXML(sitemapUrl);
      if (!sitemapXML) continue;
      const pageUrls = await parseSitemap(sitemapXML);
      for (const pageUrl of pageUrls) {
        if (progress.completed[domain].includes(pageUrl)) {
          console.log('Already submitted, skipping:', pageUrl);
          continue;
        }
        console.log('Submitting:', pageUrl);
        await submitToCocCoc(browser, pageUrl);
        progress.completed[domain].push(pageUrl);
        saveProgress(progressPath, progress);
        // Add 1 second delay between each submission
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  await browser.close();
})();
