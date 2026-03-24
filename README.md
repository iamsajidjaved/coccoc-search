# Cốc Cốc Auto Indexer

## Introduction

Cốc Cốc Auto Indexer is a Node.js automation tool that submits all URLs from your website's sitemaps to the Cốc Cốc Search Console. It uses Puppeteer in stealth mode and the rektCaptcha Chrome extension to bypass bot detection and solve reCAPTCHA challenges automatically. This tool is ideal for webmasters who want to ensure all their site pages are indexed by Cốc Cốc efficiently.

## Features
- Loops through all domains listed in `domains.txt`
- Fetches and parses all sitemaps (including nested sitemaps) for each domain
- Extracts all URLs (pages, posts, etc.) from the sitemaps
- Submits each URL to the Cốc Cốc Search Console form
- Uses the rektCaptcha Chrome extension to solve captchas automatically
- Fully automated, hands-free operation

## Installation & Setup


### Prerequisites
- Node.js (v16 or higher recommended)
- npm (Node package manager)

### Installation
1. Clone or download this repository to your local machine.
2. Open a terminal in the project directory.
3. Install dependencies:
   ```sh
   npm install
   ```

### Setup
1. Add your website domains (one per line) to a file named `domains.txt` in the project root. Example:
   ```
   https://example.com/
   https://anotherdomain.com/
   ```
2. The `rektcaptcha` folder with the required extension files is already included in the source code. No need to download or unpack it separately.

## Usage

Run the script with:
```sh
npm start
```

- The script will loop through each domain in `domains.txt`, fetch all sitemaps, extract all URLs, and submit them to the Cốc Cốc Search Console.
- The browser will open for each submission, fill the form, solve the captcha, and submit the URL automatically.

## Notes
- The script waits for the rektCaptcha extension to solve the captcha before submitting each URL. Adjust the wait time in `index.js` if needed.
- Make sure the rektCaptcha extension is up to date and functional.
- This tool is for educational and webmaster automation purposes only. Use responsibly.

## License
MIT License

## Author
Telegram: @iamsajidjaved
