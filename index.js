

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');
const os = require('os');

const { v4: uuidv4 } = require('uuid');
const { checkProxy } = require('./proxy-check');

// Human-friendly logger with colors
const log = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg, detail = '') => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}${detail ? ` | ${detail}` : ''}`),
  step: (msg) => console.log(`\x1b[35m➔\x1b[0m ${msg}`),
  url: (url) => `\x1b[34m${url}\x1b[0m`
};

// Utility to sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
const URL_TYPING_RETRIES = config.URL_TYPING_RETRIES || 3;

async function submitToCocCoc(browser, url) {
  const page = await browser.newPage();
  
  try {
    await page.goto('https://coccoc.com/search/console/en/get-your-website-on-coc-coc-search', {
      waitUntil: 'networkidle2',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    log.step(`Page loaded, entering URL: ${log.url(url)}`);
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
          }
        }, { capture: true });
      }
    });

    async function enterUrl(targetUrl) {
      for (let attempt = 0; attempt < URL_TYPING_RETRIES; attempt++) {
        // Clear input via evaluate for reliability
        await page.evaluate(() => {
          const input = document.querySelector('input#site');
          if (input) {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });

        await page.focus('input#site');
        await page.type('input#site', targetUrl, { delay: 30 }); // Faster but still human-like
        
        // Wait a bit and blur to trigger validation
        await sleep(200);
        await page.$eval('input#site', el => el.blur());
        await sleep(200);

        const enteredValue = await page.$eval('input#site', el => el.value);
        if (enteredValue === targetUrl) return true;
        
        log.warn(`URL entry retry ${attempt + 1}. Got: ${enteredValue.substring(0, 30)}...`);
        await sleep(500);
      }
      throw new Error(`Failed to enter URL correctly after ${URL_TYPING_RETRIES} attempts.`);
    }

    await enterUrl(url);

    // Wait for the input to be stable and verified
    await page.waitForFunction((expected) => {
      const input = document.querySelector('input#site');
      return input && input.value === expected && document.activeElement !== input;
    }, { timeout: 10000 }, url);

    // Mark URL entry as complete
    await page.evaluate(() => {
      window.__urlEntryComplete = true;
    });

    log.step('Waiting for Google reCAPTCHA to be solved...');

    // Wait for captcha to be solved (token present in hidden textarea)
    await page.waitForFunction(() => {
      const response = document.querySelector('#g-recaptcha-response');
      return response && response.value && response.value.length > 10;
    }, { timeout: CAPTCHA_TIMEOUT });

    log.success('Captcha solved successfully');
    await sleep(2000);

    // Confirm the URL is still correct before submitting
    let finalUrl = await page.$eval('input#site', el => el.value);
    if (finalUrl !== url) {
      log.warn(`URL mismatch detected! Re-entering: ${log.url(url)}`);
      await page.evaluate((v) => { 
        const input = document.querySelector('input#site');
        input.value = v; 
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, url);
      await page.$eval('input#site', el => el.blur());
      await sleep(1000);
      finalUrl = await page.$eval('input#site', el => el.value);
      if (finalUrl !== url) throw new Error('Final URL mismatch after retry');
    }

    // Ensure the button is clickable
    const submitBtnSelector = 'form.default_form button[type="submit"], .btn-primary, button.btn';
    await page.waitForSelector(submitBtnSelector, { visible: true, timeout: 15000 });
    
    // Scroll into view to be safe
    await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, submitBtnSelector);
    await sleep(1000);

    log.step('Submitting form...');
    
    // Try regular click with some delay
    try {
      await page.click(submitBtnSelector, { delay: 100 });
    } catch (e) {
      log.warn('Direct click failed, using JavaScript fallback...');
      await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          // Also try to submit the form directly if it's not working
          const form = btn.closest('form');
          if (form) form.submit();
        }
      }, submitBtnSelector);
    }

    // Wait for the success modal or an error message
    try {
      await page.waitForFunction(() => {
        // Success check
        const modal = Array.from(document.querySelectorAll('div, .modal, .swal2-popup, .sweet-alert, .alert-success'))
          .find(el => el.innerText && el.innerText.match(/Request has been sent|success|thành công|đã gửi|submitted/i));
        if (modal) return true;
        
        // Error check
        const err = Array.from(document.querySelectorAll('.alert-danger, .error, .alert-warning'))
          .find(el => el.innerText && el.innerText.length > 0);
        if (err) return true;
        
        return false;
      }, { timeout: 30000 });
      
      const result = await page.evaluate(() => {
        const modal = Array.from(document.querySelectorAll('div, .modal, .swal2-popup, .sweet-alert, .alert-success'))
          .find(el => el.innerText && el.innerText.match(/Request has been sent|success|thành công|đã gửi|submitted/i));
        if (modal) return { status: 'success', text: modal.innerText };
        
        const err = Array.from(document.querySelectorAll('.alert-danger, .error, .alert-warning'))
          .find(el => el.innerText && el.innerText.length > 0);
        return err ? { status: 'error', message: err.innerText } : null;
      });

      if (result && result.status === 'success') {
        log.success(`Request sent: ${result.text.split('\n')[0]}`);
      } else if (result && result.status === 'error') {
        throw new Error(`CocCoc site returned error: ${result.message}`);
      } else {
        throw new Error('Timed out waiting for confirmation');
      }
    } catch (e) {
      throw new Error(`Result detection failed: ${e.message}`);
    }

    await sleep(2000);
    return true;
  } catch (err) {
    throw err;
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
  while (true) {
    try {
      const res = await axios.get(`${config.PROXY_API_BASE}/getNewProxy?access_token=${config.PROXY_API_KEY}`);
      if (res.data.status === 'success') {
        return res.data.data.proxy;
      }
      
      // If the API specifies a nextChange time, use it exactly
      let waitSeconds = 0;
      if (res.data.nextChange !== undefined) {
        waitSeconds = parseInt(res.data.nextChange, 10);
      } else if (res.data.mess) {
        // Fallback: try to extract seconds from the message if nextChange is missing
        const match = res.data.mess.match(/(\d+)/);
        if (match) waitSeconds = parseInt(match[1], 10);
      }

      if (waitSeconds > 0) {
        log.info(`API: Wait ${waitSeconds}s for next proxy change...`);
        await sleep(waitSeconds * 1000);
      } else {
        throw new Error(res.data.mess || 'Unknown proxy error');
      }
    } catch (err) {
      if (err.message && err.message.includes('Proxy order failed')) throw err;
      log.warn(`Proxy API error, retrying in 5s... (${err.message})`);
      await sleep(5000);
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
    log.error('No domains found in domains.txt');
    process.exit(1);
  }
  const progressPath = path.join(__dirname, 'progress.json');
  let progress = loadProgress(progressPath);
  if (resetFlag) {
    try {
      fs.writeFileSync(progressPath, JSON.stringify({ completed: {} }, null, 2), 'utf-8');
      log.info('Progress has been reset.');
    } catch (err) {
      log.error('Failed to reset progress file', err.message);
    }
    progress = { completed: {} };
  }

  const extensionPath = path.join(__dirname, 'rektcaptcha');
  let proxy;
  let browser;
  let userDataDir;

  async function getTempUserDataDir() {
    const dir = path.join(os.tmpdir(), 'puppeteer-profile-' + uuidv4());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async function cleanupBrowser() {
    if (browser) {
      try { await browser.close(); } catch {}
      browser = null;
    }
    if (userDataDir) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
      userDataDir = null;
    }
  }

  async function getAndCheckProxy(forceNew = false) {
    let working = false;
    let attempts = 0;
    while (!working) {
      attempts++;
      try {
        if (forceNew || attempts > 1) {
          log.info(`Requesting new proxy (attempt ${attempts})...`);
          proxy = await orderNewProxy();
        } else {
          log.info('Checking current proxy status...');
          proxy = await getCurrentProxy();
        }
        
        if (!proxy) {
          forceNew = true;
          continue;
        }

        log.step(`Verifying connectivity: ${proxy}`);
        working = await checkProxy(proxy);
        
        if (!working) {
          log.warn('Proxy check failed, rotating immediately...');
          forceNew = true;
        }
      } catch (err) {
        log.error('Proxy management error', err.message);
        forceNew = true;
      }
    }
    log.success(`Active proxy: ${proxy}`);
    return proxy;
  }

  async function launchBrowser(forceNewProxy = false) {
    await cleanupBrowser();
    await getAndCheckProxy(forceNewProxy);
    userDataDir = await getTempUserDataDir();
    log.info(`Starting browser instance...`);
    browser = await puppeteer.launch({
      headless: false,
      userDataDir,
      protocolTimeout: 180000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--proxy-server=${proxy}`,
      ],
    });
    return browser;
  }

  async function submitUrlWithRetry(url) {
    let success = false;
    let retryCount = 0;
    const MAX_RETRIES = 5; // Reduced default retries for cleaner execution

    while (!success && retryCount < MAX_RETRIES) {
      if (!browser) {
        await launchBrowser();
      }

      log.step(`Processing: ${log.url(url)} (Try ${retryCount + 1}/${MAX_RETRIES})`);
      try {
        success = await submitToCocCoc(browser, url);
        if (success) {
          log.success(`Finished: ${log.url(url)}`);
          await cleanupBrowser();
          return true;
        }
      } catch (err) {
        success = false;
        const errMsg = (err && err.message) ? err.message : String(err);
        log.error(`Failed: ${log.url(url)}`, errMsg);

        if (errMsg.includes('net::') || errMsg.includes('timeout') || errMsg.includes('Connection closed')) {
          log.warn('Network issue detected, refreshing environment...');
          await launchBrowser(false); 
        }
        retryCount++;
      }
    }
    return false;
  }

  for (const domain of domains) {
    try {
      log.info(`Starting processing for domain: ${log.url(domain)}`);
      if (!progress.completed[domain]) progress.completed[domain] = [];

      // Optionally submit the domain root
      if (config.SUBMIT_DOMAINS) {
        const rootUrl = domain.replace(/\/$/, '');
        if (!progress.completed[domain].includes(rootUrl)) {
          const success = await submitUrlWithRetry(rootUrl);
          if (success) {
            progress.completed[domain].push(rootUrl);
            saveProgress(progressPath, progress);
          }
        } else {
          log.info(`Skipping (already done): ${log.url(rootUrl)}`);
        }
      }

      // Optionally submit sitemaps
      if (config.SUBMIT_SITEMAPS) {
        const sitemapIndexUrl = domain.replace(/\/$/, '') + '/sitemap_index.xml';
        log.step(`Analyzing sitemap index: ${log.url(sitemapIndexUrl)}`);
        const sitemapIndexXML = await fetchXML(sitemapIndexUrl);
        if (!sitemapIndexXML) {
          log.warn(`Could not fetch sitemap index for ${domain}, skipping sitemaps.`);
        } else {
          const sitemapUrls = await parseSitemapIndex(sitemapIndexXML);
          for (const sitemapUrl of sitemapUrls) {
            log.step(`Reading sitemap: ${log.url(sitemapUrl)}`);
            const sitemapXML = await fetchXML(sitemapUrl);
            if (!sitemapXML) {
              log.warn(`Could not fetch sitemap ${sitemapUrl}, skipping this sitemap.`);
              continue;
            }
            
            const pageUrls = await parseSitemap(sitemapXML);
            for (const pageUrl of pageUrls) {
              if (progress.completed[domain].includes(pageUrl)) {
                log.info(`Skipping (already done): ${log.url(pageUrl)}`);
                continue;
              }

              const success = await submitUrlWithRetry(pageUrl);
              if (success) {
                progress.completed[domain].push(pageUrl);
                saveProgress(progressPath, progress);
              }
            }
          }
        }
      }
    } catch (domainErr) {
      log.error(`Critical error processing domain ${domain}:`, domainErr.message);
      log.info(`Skipping to next domain...`);
      // Continue to next domain in the list
    }
  }

  log.success('ALL TASKS COMPLETED SUCCESSFULLY');
  await cleanupBrowser();
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




