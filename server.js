const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Precio base para calcular el crecimiento
const BASE_PRICE = 50000;

// Función para obtener precio de Binance
async function getBinancePrice() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
      timeout: 10000, // 10 segundos de timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BTC-Price-Bot/1.0)'
      }
    });
    
    if (response.data && response.data.price) {
      return parseFloat(response.data.price);
    } else {
      throw new Error('Invalid response format from Binance API');
    }
  } catch (error) {
    console.error('Error fetching price from Binance:', error.message);
    
    // Si falla la API principal, intentar con un endpoint alternativo
    try {
      const fallbackResponse = await axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BTC-Price-Bot/1.0)'
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

// Función para calcular el porcentaje de crecimiento
function calculatePercentGrowth(currentPrice, basePrice) {
  return ((currentPrice - basePrice) / basePrice) * 100;
}

// Endpoint principal
app.get('/price/binance', async (req, res) => {
  try {
    console.log('Fetching BTC price from Binance...');
    
    const currentPrice = await getBinancePrice();
    const percentGrowth = calculatePercentGrowth(currentPrice, BASE_PRICE);
    
    const response = {
      timestamp: new Date().toISOString(),
      price: parseFloat(currentPrice.toFixed(2)),
      percentGrowth: parseFloat(percentGrowth.toFixed(2))
    };
    
    console.log('Success:', response);
    res.json(response);
    
  } catch (error) {
    console.error('Error in /price/binance endpoint:', error.message);
    
    res.status(500).json({
      error: 'cannot get price from binance',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({ 
    message: 'BTC Price API',
    endpoints: {
      '/price/binance': 'Get current BTC price and growth %',
      '/health': 'Health check'
    }
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Base price set to: $${BASE_PRICE}`);
  console.log(`🌐 Endpoints available:`);
  console.log(`   - GET /price/binance`);
  console.log(`   - GET /health`);
  console.log(`   - GET /`);
});

module.exports = app;
