
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
        while (!success && retryCount < 3) {
          console.log('Submitting:', pageUrl, retryCount > 0 ? `(retry ${retryCount})` : '');
          try {
            await submitToCocCoc(browser, pageUrl);
            success = true;
          } catch (err) {
            const errMsg = (err && err.message) ? err.message : String(err);
            console.error('Submission failed for:', pageUrl, errMsg);
            // If navigation/network error, rotate proxy and restart browser
            if (errMsg.includes('net::ERR_TIMED_OUT') || errMsg.includes('Navigation timeout') || errMsg.includes('net::ERR_PROXY_CONNECTION_FAILED') || errMsg.includes('net::ERR_CONNECTION_TIMED_OUT')) {
              console.log('Proxy/network error detected. Rotating proxy and restarting browser...');
              try {
                await browser.close();
              } catch {}
              try {
                await orderNewProxy();
                proxy = await getCurrentProxy();
                console.log('Using new proxy:', proxy);
              } catch (proxyErr) {
                console.error('Proxy rotation failed:', proxyErr.message || proxyErr);
                break;
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
            } else {
              // For other errors, do not retry
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




