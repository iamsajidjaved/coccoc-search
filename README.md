# 🚀 Cốc Cốc Auto Indexer

A powerful Node.js automation tool designed to submit website URLs to the **Cốc Cốc Search Console** for faster indexing. Built with Puppeteer Stealth and rektCaptcha for seamless bypass of bot detection.

---

## ✨ Features

- **Multi-Domain Support**: Processes all domains listed in `domains.txt`.
- **Sitemap Extraction**: Automatically fetches and parses nested sitemaps to find every URL on your site.
- **Smart Proxy Integration**: 
    - Reuses working proxies to maximize efficiency.
    - Automatically rotates and requests new proxies when network issues occur.
    - Uses exact wait times provided by the proxy API.
- **Optimized Submission Flow**:
    - Fast URL entry (30ms/char) with robust verification.
    - Automated success detection matching the "Request has been sent" message.
    - Fresh browser instance for every URL to maintain a clean state.
- **Robust Error Handling**: 
    - Skips broken domains or sitemaps without stopping the script.
    - Infinite retry logic for proxy connectivity.
- **Human-Friendly Logging**: Beautifully colored terminal output for real-time monitoring.

---

## 🛠️ Installation & Setup

### 📋 Prerequisites
- **Node.js**: v18.0 or higher.
- **NPM**: Included with Node.js.

### 📥 Step 1: Installation
1. Clone the repository and navigate to the folder.
2. Install the required packages:
   ```powershell
   npm install
   ```

### ⚙️ Step 2: Configuration
1. **`domains.txt`**: Add your website domains (one per line).
   ```text
   https://example.com/
   https://another-site.net/
   ```
2. **`config.json`**: Enter your Proxy API details and customize behavior.
   ```json
   {
     "PROXY_API_KEY": "YOUR_KEY_HERE",
     "PROXY_API_BASE": "http://proxy.shoplike.vn/Api",
     "SUBMIT_DOMAINS": true,
     "SUBMIT_SITEMAPS": true
   }
   ```

---

## 🚀 Usage

Start the indexing process:
```powershell
npm start
```

To reset your progress and re-index everything:
```powershell
npm start -- --reset
```

### 🧠 How it works:
1. **Init**: Reads domains and loads progress from `progress.json`.
2. **Proxy**: Verifies the current proxy can reach `coccoc.com`.
3. **Loop**: For every URL found in your sitemaps:
   - Launches a fresh stealth browser.
   - Types the URL and waits for the Captcha to be solved.
   - Clicks submit and waits for the confirmation message.
   - Closes the browser and marks the URL as completed.

---

## 🛡️ Robustness Notes
- **Never Breaks**: If a domain or sitemap fails, the script logs the issue and moves to the next one automatically.
- **Connection Issues**: If the internet or proxy goes down, the script will wait and retry until a connection is restored.
- **Educational Use**: This tool is for webmaster automation and educational purposes. Use responsibly.

---

## 👤 Author
**Telegram**: [@iamsajidjaved](https://t.me/iamsajidjaved)

---
MIT License
