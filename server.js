const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BASE_PRICE = 50000;

async function getBinancePrice() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BoostIQ/1.0)',
        'X-MBX-APIKEY': process.env.BINANCE_API_KEY || ''
      }
    });

    if (response.data && response.data.price) {
      return parseFloat(response.data.price);
    } else {
      throw new Error('Invalid response format from Binance');
    }
  } catch (error) {
    console.error('Error fetching price from Binance:', error.message);

    try {
      const fallbackResponse = await axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BoostIQ/1.0)'
        }
      });

      if (fallbackResponse.data && fallbackResponse.data.lastPrice) {
        return parseFloat(fallbackResponse.data.lastPrice);
      }
    } catch (fallbackError) {
      console.error('Fallback API also failed:', fallbackError.message);
    }

    throw error;
  }
}

function calculatePercentGrowth(currentPrice, basePrice) {
  return ((currentPrice - basePrice) / basePrice) * 100;
}

app.get('/price/binance', async (req, res) => {
  try {
    const currentPrice = await getBinancePrice();
    const percentGrowth = calculatePercentGrowth(currentPrice, BASE_PRICE);

    res.json({
      timestamp: new Date().toISOString(),
      price: parseFloat(currentPrice.toFixed(2)),
      percentGrowth: parseFloat(percentGrowth.toFixed(2))
    });
  } catch (error) {
    res.status(500).json({
      error: 'cannot get price from binance',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'BTC Price API',
    endpoints: {
      '/price/binance': 'Get current BTC price and growth %',
      '/health': 'Health check'
    }
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Base price: $${BASE_PRICE}`);
});

module.exports = app;