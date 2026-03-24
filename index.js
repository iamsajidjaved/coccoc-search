
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');


// Proxy API integration

// Load config.json
let config = {};

try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
} catch (e) {
  config = {};
}

// Config variable assignments for easy access
const CAPTCHA_TIMEOUT = config.CAPTCHA_TIMEOUT || 120000;
const PAGE_LOAD_TIMEOUT = config.PAGE_LOAD_TIMEOUT || 60000;
const FORM_SELECTOR_TIMEOUT = config.FORM_SELECTOR_TIMEOUT || 30000;
const URL_TYPING_DELAY = config.URL_TYPING_DELAY || 120;
const URL_TYPING_RETRIES = config.URL_TYPING_RETRIES || 3;
const URL_TYPING_RETRY_DELAY = config.URL_TYPING_RETRY_DELAY || 80;
const URL_TYPING_FOCUS_DELAY = config.URL_TYPING_FOCUS_DELAY || 30;
const POST_SUBMIT_WAIT = config.POST_SUBMIT_WAIT || 5000;
const BETWEEN_SUBMISSION_DELAY = config.BETWEEN_SUBMISSION_DELAY || 1000;

async function submitToCocCoc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto('https://coccoc.com/search/console/en/get-your-website-on-coc-coc-search', {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    console.log('Page loaded, waiting for form...');
    await page.waitForSelector('input#site', { timeout: FORM_SELECTOR_TIMEOUT });

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

    // Type the URL one character at a time, verifying after each, with retry and focus
    for (let i = 0; i < url.length; i++) {
      let success = false;
      for (let attempt = 0; attempt < URL_TYPING_RETRIES; attempt++) {
        // Focus input before typing
        await page.$eval('input#site', el => el.focus());
        await page.type('input#site', url[i], { delay: URL_TYPING_DELAY });
        await page.waitForTimeout(URL_TYPING_FOCUS_DELAY);
        const currentValue = await page.$eval('input#site', el => el.value);
        if (currentValue === url.slice(0, i + 1)) {
          success = true;
          break;
        }
        // If failed, try again after a short delay
        await page.waitForTimeout(URL_TYPING_RETRY_DELAY);
      }
      if (!success) {
        throw new Error(`Typing error: expected '${url.slice(0, i + 1)}', but could not achieve it after retries`);
      }
    }

    // Blur the input to signal completion
    await page.$eval('input#site', el => el.blur());

    // Wait for the input to lose focus and value to be stable
    await page.waitForFunction((expected) => {
      const input = document.querySelector('input#site');
      return input && input.value === expected && document.activeElement !== input;
    }, { timeout: 10000 }, url);

    // Final strict check
    const enteredValue = await page.$eval('input#site', el => el.value);
    if (enteredValue !== url) {
      throw new Error(`Final URL mismatch! Expected: ${url}, Got: ${enteredValue}`);
    }

    // Mark URL entry as complete
    await page.evaluate(() => {
      window.__urlEntryComplete = true;
    });

    console.log('URL entry complete, waiting for captcha to be solved...');

    // Wait for captcha to be actually solved (check for response token)
    await page.waitForFunction(() => {
      const response = document.querySelector('#g-recaptcha-response');
      return response && response.value && response.value.length > 0;
    }, { timeout: CAPTCHA_TIMEOUT });

    // Wait for a short period before submission to allow any last-moment changes
    await page.waitForTimeout(1000);

    // Confirm the URL is still correct before submitting
    let finalUrl = await page.$eval('input#site', el => el.value);
    if (finalUrl !== url) {
      console.warn(`URL incorrect before submit! Retrying entry. Expected: ${url}, Got: ${finalUrl}`);
      // Clear and retype the URL
      await page.evaluate(() => {
        const input = document.querySelector('input#site');
        if (input) input.value = '';
      });
      for (let i = 0; i < url.length; i++) {
        await page.type('input#site', url[i], { delay: 120 });
        const currentValue = await page.$eval('input#site', el => el.value);
        if (currentValue !== url.slice(0, i + 1)) {
          throw new Error(`Retry typing error: expected '${url.slice(0, i + 1)}', got '${currentValue}'`);
        }
      }
      await page.$eval('input#site', el => el.blur());
      await page.waitForFunction((expected) => {
        const input = document.querySelector('input#site');
        return input && input.value === expected && document.activeElement !== input;
      }, { timeout: 10000 }, url);
      finalUrl = await page.$eval('input#site', el => el.value);
      if (finalUrl !== url) {
        throw new Error(`Final retry URL mismatch! Expected: ${url}, Got: ${finalUrl}`);
      }
    }

    // Now submit
    await page.click('form.default_form button[type="submit"]');
    await page.waitForTimeout(POST_SUBMIT_WAIT);
    console.log('Submission complete for:', url);

  } catch (err) {
    console.error('Error in submitToCocCoc for URL:', url, err.message);
  } finally {
    await page.close();
  }
}


function getDomains(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch (err) {
    console.error('Failed to read domains.txt:', err);
    return [];
  }
}

function getRandomUserAgent() {
  if (Array.isArray(config.USER_AGENTS) && config.USER_AGENTS.length > 0) {
    return config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)];
  }
  // fallback
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
}

async function fetchXML(url) {
  try {
    const userAgent = getRandomUserAgent();
    const headers = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    };
    const res = await axios.get(url, { timeout: 15000, headers });
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


async function orderNewProxy() {
  if (!config.PROXY_API_KEY) throw new Error('PROXY_API_KEY not set in environment or config.json');
  let waitTime = 0;
  while (true) {
    try {
      const res = await axios.get(`${config.PROXY_API_BASE}/getNewProxy?access_token=${config.PROXY_API_KEY}`);
      if (res.data.status === 'success') {
        return res.data.data.proxy;
      } else if (res.data.nextChange) {
        waitTime = res.data.nextChange;
        console.log(`Waiting ${waitTime}s for next proxy...`);
        await new Promise(r => setTimeout(r, waitTime * 1000));
      } else {
        throw new Error(res.data.mess || 'Unknown proxy error');
      }
    } catch (err) {
      throw new Error('Proxy order failed: ' + (err.message || err));
    }
  }
}

async function getCurrentProxy() {
  if (!config.PROXY_API_KEY) throw new Error('PROXY_API_KEY not set in environment or config.json');
  try {
    const res = await axios.get(`${config.PROXY_API_BASE}/getCurrentProxy?access_token=${config.PROXY_API_KEY}`);
    if (res.data.status === 'success') {
      return res.data.data.proxy;
    } else {
      throw new Error(res.data.mess || 'No proxy available');
    }
  } catch (err) {
    throw new Error('Get current proxy failed: ' + (err.message || err));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const resetFlag = args.includes('--reset');
  const domains = await getDomains(path.join(__dirname, 'domains.txt'));
  if (domains.length === 0) {
    console.error('No domains found in domains.txt');
    process.exit(1);
  }
  const progressPath = path.join(__dirname, 'progress.json');
  let progress = loadProgress(progressPath);
  if (resetFlag) {
    // Clear progress.json
    try {
      fs.writeFileSync(progressPath, JSON.stringify({ completed: {} }, null, 2), 'utf-8');
      console.log('Progress has been reset.');
    } catch (err) {
      console.error('Failed to reset progress file:', err);
    }
    progress = { completed: {} };
  }

  // Proxy logic: order new proxy, then get current proxy
  let proxy;
  try {
    await orderNewProxy();
    proxy = await getCurrentProxy();
    console.log('Using proxy:', proxy);
  } catch (err) {
    console.error('Proxy setup failed:', err.message || err);
    process.exit(1);
  }

  const extensionPath = path.join(__dirname, 'rektcaptcha');
  let browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--proxy-server=${proxy}`,
    ],
  });

  for (const domain of domains) {
    if (!progress.completed[domain]) progress.completed[domain] = [];
    // Optionally submit the domain root
    if (config.SUBMIT_DOMAINS) {
      const rootUrl = domain.replace(/\/$/, '');
      if (!progress.completed[domain].includes(rootUrl)) {
        let success = false;
        let retryCount = 0;
        const MAX_RETRIES = 20;
        while (!success && retryCount < MAX_RETRIES) {
          console.log('Submitting domain root:', rootUrl, retryCount > 0 ? `(retry ${retryCount})` : '', '| Proxy:', proxy);
          try {
            await submitToCocCoc(browser, rootUrl);
            success = true;
          } catch (err) {
            const errMsg = (err && err.message) ? err.message : String(err);
            console.error('Submission failed for domain root:', rootUrl, errMsg);
            if (errMsg.includes('net::ERR_TIMED_OUT') || errMsg.includes('Navigation timeout') || errMsg.includes('net::ERR_PROXY_CONNECTION_FAILED') || errMsg.includes('net::ERR_CONNECTION_TIMED_OUT')) {
              console.log('Proxy/network error detected. Rotating proxy and restarting browser...');
              try { await browser.close(); } catch {}
              try {
                await orderNewProxy();
                proxy = await getCurrentProxy();
                console.log('Using new proxy:', proxy);
              } catch (proxyErr) {
                console.error('Proxy rotation failed:', proxyErr.message || proxyErr);
                await new Promise(resolve => setTimeout(resolve, 5000));
                retryCount++;
                continue;
              }
              browser = await puppeteer.launch({
                headless: false,
                args: [
                  '--no-sandbox',
                  '--disable-setuid-sandbox',
                  `--disable-extensions-except=${extensionPath}`,
                  `--load-extension=${extensionPath}`,
                  `--proxy-server=${proxy}`,
                ],
              });
              await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
              break;
            }
            retryCount++;
          }
        }
        if (success) {
          progress.completed[domain].push(rootUrl);
          saveProgress(progressPath, progress);
        }
        await new Promise(resolve => setTimeout(resolve, BETWEEN_SUBMISSION_DELAY));
      } else {
        console.log('Already submitted domain root, skipping:', rootUrl);
      }
    }
    // Optionally submit sitemaps
    if (config.SUBMIT_SITEMAPS) {
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
          let success = false;
          let retryCount = 0;
          const MAX_RETRIES = 20;
          while (!success && retryCount < MAX_RETRIES) {
            console.log('Submitting:', pageUrl, retryCount > 0 ? `(retry ${retryCount})` : '', '| Proxy:', proxy);
            try {
              await submitToCocCoc(browser, pageUrl);
              success = true;
            } catch (err) {
              const errMsg = (err && err.message) ? err.message : String(err);
              console.error('Submission failed for:', pageUrl, errMsg);
              if (errMsg.includes('net::ERR_TIMED_OUT') || errMsg.includes('Navigation timeout') || errMsg.includes('net::ERR_PROXY_CONNECTION_FAILED') || errMsg.includes('net::ERR_CONNECTION_TIMED_OUT')) {
                console.log('Proxy/network error detected. Rotating proxy and restarting browser...');
                try { await browser.close(); } catch {}
                try {
                  await orderNewProxy();
                  proxy = await getCurrentProxy();
                  console.log('Using new proxy:', proxy);
                } catch (proxyErr) {
                  console.error('Proxy rotation failed:', proxyErr.message || proxyErr);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  retryCount++;
                  continue;
                }
                browser = await puppeteer.launch({
                  headless: false,
                  args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    `--disable-extensions-except=${extensionPath}`,
                    `--load-extension=${extensionPath}`,
                    `--proxy-server=${proxy}`,
                  ],
                });
                await new Promise(resolve => setTimeout(resolve, 3000));
              } else {
                break;
              }
              retryCount++;
            }
          }
          if (success) {
            progress.completed[domain].push(pageUrl);
            saveProgress(progressPath, progress);
          }
          await new Promise(resolve => setTimeout(resolve, BETWEEN_SUBMISSION_DELAY));
        }
      }
    }
  }

  await browser.close();
}

main();

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




