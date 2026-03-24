const axios = require('axios');

/**
 * Checks if the given proxy is working by making a simple HTTP request through it.
 * @param {string} proxy - Proxy string in the format host:port
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<boolean>} - Resolves true if proxy works, false otherwise
 */
async function checkProxy(proxy, timeout = 8000) {
  if (!proxy) return false;
  const [host, port] = proxy.split(':');
  try {
    const res = await axios.get('http://httpbin.org/ip', {
      proxy: { host, port: parseInt(port, 10) },
      timeout,
    });
    return !!(res && res.data && res.data.origin);
  } catch (e) {
    return false;
  }
}

module.exports = { checkProxy };