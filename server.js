const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
const CAPITAL = 50000; // Capital base en USD
const MIN_PROFIT_MARGIN = 5; // Margen mínimo de ganancia en %
const MONITOR_INTERVAL = 10000; // 10 segundos
const API_KEY = process.env.BINANCE_API_KEY; // Tu API key de Binance
const API_SECRET = process.env.BINANCE_API_SECRET; // Tu API secret

// Middleware
app.use(cors());
app.use(express.json());

// Storage en memoria para precios base y alerts
let priceHistory = new Map();
let activeAlerts = [];
let monitoringActive = false;
let monitoringInterval = null;

// Lista de tokens para monitorear (alta liquidez y volumen)
const MONITORING_TOKENS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'LINKUSDT', 'UNIUSDT',
  'ETCUSDT', 'XLMUSDT', 'NEARUSDT', 'ALGOUSDT', 'VETUSDT',
  'FTMUSDT', 'MANAUSDT', 'SANDUSDT', 'AXSUSDT', 'CHZUSDT',
  'ENJUSDT', 'GALAUSDT', 'HBARUSDT', 'ICPUSDT', 'FILUSDT'
];

// Función para obtener precios en tiempo real
async function getRealTimePrices() {
  try {
    const symbols = MONITORING_TOKENS.join(',');
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price`, {
      timeout: 8000,
      headers: {
        'X-MBX-APIKEY': API_KEY,
        'User-Agent': 'PumpDetector/1.0'
      }
    });

    // Filtrar solo los tokens que monitoreamos
    const prices = response.data
      .filter(item => MONITORING_TOKENS.includes(item.symbol))
      .map(item => ({
        symbol: item.symbol,
        price: parseFloat(item.price),
        timestamp: Date.now()
      }));

    return prices;
  } catch (error) {
    console.error('Error fetching real-time prices:', error.message);
    throw error;
  }
}

// Función para obtener datos adicionales de mercado
async function getMarketData(symbol) {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, {
      timeout: 5000,
      headers: {
        'X-MBX-APIKEY': API_KEY,
        'User-Agent': 'PumpDetector/1.0'
      }
    });

    const data = response.data;
    return {
      symbol: symbol,
      volume: parseFloat(data.volume),
      volumeUSDT: parseFloat(data.quoteVolume),
      change24h: parseFloat(data.priceChangePercent),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      trades: parseInt(data.count)
    };
  } catch (error) {
    console.error(`Error fetching market data for ${symbol}:`, error.message);
    return null;
  }
}

// Función para detectar pumps
function detectPumps(currentPrices) {
  const pumps = [];
  const now = Date.now();

  for (const current of currentPrices) {
    const { symbol, price, timestamp } = current;
    
    // Obtener precio base (hace 10 segundos o precio inicial)
    let basePrice = priceHistory.get(symbol);
    
    if (!basePrice) {
      // Primera vez que vemos este token, establecer precio base
      priceHistory.set(symbol, {
        basePrice: price,
        lastPrice: price,
        timestamp: timestamp,
        maxPrice: price,
        minPrice: price
      });
      continue;
    }

    // Calcular ganancia desde precio base
    const profitMargin = ((price - basePrice.basePrice) / basePrice.basePrice) * 100;
    const potentialProfit = CAPITAL * (profitMargin / 100);

    // Detectar si hay pump significativo
    if (profitMargin >= MIN_PROFIT_MARGIN) {
      pumps.push({
        symbol: symbol,
        currentPrice: price,
        basePrice: basePrice.basePrice,
        profitMargin: parseFloat(profitMargin.toFixed(2)),
        potentialProfit: parseFloat(potentialProfit.toFixed(2)),
        priceChange: price - basePrice.basePrice,
        timestamp: new Date(timestamp).toISOString(),
        status: 'PUMP_DETECTED',
        confidence: profitMargin > 10 ? 'HIGH' : 'MEDIUM'
      });
    }

    // Actualizar historial
    priceHistory.set(symbol, {
      ...basePrice,
      lastPrice: price,
      timestamp: timestamp,
      maxPrice: Math.max(basePrice.maxPrice, price),
      minPrice: Math.min(basePrice.minPrice, price)
    });
  }

  return pumps;
}

// Función principal de monitoreo
async function monitorTokens() {
  try {
    console.log(`🔍 Monitoring ${MONITORING_TOKENS.length} tokens at ${new Date().toISOString()}`);
    
    const currentPrices = await getRealTimePrices();
    const detectedPumps = detectPumps(currentPrices);
    
    if (detectedPumps.length > 0) {
      console.log(`🚀 PUMPS DETECTED: ${detectedPumps.length}`);
      
      // Agregar datos de mercado adicionales
      for (const pump of detectedPumps) {
        const marketData = await getMarketData(pump.symbol);
        if (marketData) {
          pump.volume24h = marketData.volumeUSDT;
          pump.change24h = marketData.change24h;
          pump.trades24h = marketData.trades;
        }
      }
      
      // Guardar alertas activas
      activeAlerts.push({
        timestamp: new Date().toISOString(),
        pumps: detectedPumps,
        totalOpportunities: detectedPumps.length
      });
      
      // Mantener solo las últimas 50 alertas
      if (activeAlerts.length > 50) {
        activeAlerts = activeAlerts.slice(-50);
      }
    }
    
  } catch (error) {
    console.error('Error in monitoring cycle:', error.message);
  }
}

// Iniciar monitoreo automático
function startMonitoring() {
  if (monitoringActive) return;
  
  monitoringActive = true;
  console.log(`🎯 Starting pump monitoring with $${CAPITAL} capital`);
  console.log(`📊 Monitoring ${MONITORING_TOKENS.length} tokens every ${MONITOR_INTERVAL/1000} seconds`);
  console.log(`💰 Minimum profit margin: ${MIN_PROFIT_MARGIN}%`);
  
  // Ejecutar inmediatamente
  monitorTokens();
  
  // Programar ejecución cada 10 segundos
  monitoringInterval = setInterval(monitorTokens, MONITOR_INTERVAL);
}

// Detener monitoreo
function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  monitoringActive = false;
  console.log('⏹️ Monitoring stopped');
}

// ENDPOINTS

// Endpoint para obtener pumps detectados en tiempo real
app.get('/pumps/live', (req, res) => {
  const recentAlerts = activeAlerts.slice(-10); // Últimas 10 alertas
  const currentPumps = recentAlerts.length > 0 ? recentAlerts[recentAlerts.length - 1].pumps : [];
  
  res.json({
    timestamp: new Date().toISOString(),
    monitoringActive: monitoringActive,
    capital: CAPITAL,
    minProfitMargin: MIN_PROFIT_MARGIN,
    currentPumps: currentPumps,
    totalAlertsToday: activeAlerts.length,
    monitoredTokens: MONITORING_TOKENS.length,
    nextScanIn: monitoringActive ? `${Math.ceil((MONITOR_INTERVAL - (Date.now() % MONITOR_INTERVAL)) / 1000)}s` : 'N/A'
  });
});

// Endpoint para obtener historial de alertas
app.get('/pumps/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const history = activeAlerts.slice(-limit);
  
  res.json({
    timestamp: new Date().toISOString(),
    totalAlerts: activeAlerts.length,
    history: history,
    stats: {
      avgPumpsPerAlert: history.length > 0 ? (history.reduce((sum, alert) => sum + alert.pumps.length, 0) / history.length).toFixed(1) : 0,
      topPerformers: getTopPerformers()
    }
  });
});

// Función para obtener top performers
function getTopPerformers() {
  const performers = new Map();
  
  activeAlerts.forEach(alert => {
    alert.pumps.forEach(pump => {
      const current = performers.get(pump.symbol) || { count: 0, maxProfit: 0, totalProfit: 0 };
      performers.set(pump.symbol, {
        count: current.count + 1,
        maxProfit: Math.max(current.maxProfit, pump.profitMargin),
        totalProfit: current.totalProfit + pump.profitMargin
      });
    });
  });
  
  return Array.from(performers.entries())
    .map(([symbol, data]) => ({
      symbol,
      pumpCount: data.count,
      maxProfitMargin: data.maxProfit.toFixed(2),
      avgProfitMargin: (data.totalProfit / data.count).toFixed(2)
    }))
    .sort((a, b) => b.pumpCount - a.pumpCount)
    .slice(0, 10);
}

// Endpoint para controlar el monitoreo
app.post('/monitoring/start', (req, res) => {
  startMonitoring();
  res.json({
    message: 'Pump monitoring started',
    timestamp: new Date().toISOString(),
    config: {
      capital: CAPITAL,
      minProfitMargin: MIN_PROFIT_MARGIN,
      interval: `${MONITOR_INTERVAL/1000}s`,
      tokens: MONITORING_TOKENS.length
    }
  });
});

app.post('/monitoring/stop', (req, res) => {
  stopMonitoring();
  res.json({
    message: 'Pump monitoring stopped',
    timestamp: new Date().toISOString(),
    totalAlertsGenerated: activeAlerts.length
  });
});

// Endpoint para reset de datos
app.post('/monitoring/reset', (req, res) => {
  priceHistory.clear();
  activeAlerts = [];
  res.json({
    message: 'Monitoring data reset',
    timestamp: new Date().toISOString()
  });
});

// Endpoint de estado
app.get('/status', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    monitoringActive: monitoringActive,
    capital: CAPITAL,
    minProfitMargin: MIN_PROFIT_MARGIN,
    monitorInterval: `${MONITOR_INTERVAL/1000}s`,
    tokensMonitored: MONITORING_TOKENS.length,
    priceHistorySize: priceHistory.size,
    totalAlerts: activeAlerts.length,
    uptime: process.uptime(),
    nextScan: monitoringActive ? new Date(Date.now() + MONITOR_INTERVAL).toISOString() : null
  });
});

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    message: 'Pump Detection API - Real Time Token Monitor',
    status: monitoringActive ? 'MONITORING' : 'IDLE',
    endpoints: {
      'GET /pumps/live': 'Current pump opportunities',
      'GET /pumps/history': 'Historical pump alerts',
      'GET /status': 'System status',
      'POST /monitoring/start': 'Start monitoring',
      'POST /monitoring/stop': 'Stop monitoring',
      'POST /monitoring/reset': 'Reset data'
    },
    config: {
      capital: `$${CAPITAL.toLocaleString()}`,
      minProfit: `${MIN_PROFIT_MARGIN}%`,
      scanInterval: `${MONITOR_INTERVAL/1000}s`,
      tokensWatched: MONITORING_TOKENS.length
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    monitoring: monitoringActive,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Iniciar servidor y monitoreo automático
app.listen(PORT, () => {
  console.log(`🚀 Pump Detection API running on port ${PORT}`);
  console.log(`💰 Capital: $${CAPITAL.toLocaleString()}`);
  console.log(`📈 Min profit margin: ${MIN_PROFIT_MARGIN}%`);
  console.log(`⏱️  Scan interval: ${MONITOR_INTERVAL/1000}s`);
  console.log(`🎯 Tokens monitored: ${MONITORING_TOKENS.length}`);
  
  // Auto-start monitoring
  setTimeout(() => {
    startMonitoring();
  }, 2000);
});

// Cleanup al cerrar
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  stopMonitoring();
  process.exit(0);
});

module.exports = app;
