const axios = require('axios');

/**
 * Checks if the given proxy is working and can reach CocCoc.
 * @param {string} proxy - Proxy string in the format host:port
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<boolean>} - Resolves true if proxy works, false otherwise
 */
async function checkProxy(proxy, timeout = 15000) {
  if (!proxy) return false;
  const [host, port] = proxy.split(':');
  
  const axiosConfig = {
    proxy: { host, port: parseInt(port, 10) },
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    },
    maxRedirects: 0, 
    validateStatus: (status) => status >= 200 && status < 400
  };

  try {
    // Check if CocCoc is reachable directly (use HTTP to avoid Node.js SSL tunneling issues with proxies)
    // Receiving ANY response (including 3xx redirect) from CocCoc confirms the proxy is working.
    await axios.get('http://coccoc.com', axiosConfig);
    return true;
  } catch (e) {
    // If we got a redirect to HTTPS (301/302), it means we successfully reached the CocCoc server
    if (e.response && e.response.status >= 300 && e.response.status < 400) {
      return true;
    }
    console.log(`Proxy failed reachability check for CocCoc: ${proxy} | ${e.message}`);
    return false;
  }
}

module.exports = { checkProxy };