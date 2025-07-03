const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración mejorada
const CAPITAL = 50000;
const MIN_PROFIT_MARGIN = 2; // Reducido para detectar más pumps
const MONITOR_INTERVAL = 5000; // 5 segundos para detección más rápida
const PRICE_HISTORY_MINUTES = 10; // Ventana de tiempo para detectar pumps
const MAX_HISTORY_SIZE = 1000; // Máximo de registros por token

// Middleware
app.use(cors());
app.use(express.json());

// Storage mejorado
let priceHistory = new Map();
let activeAlerts = [];
let monitoringActive = false;
let monitoringInterval = null;
let lastPumpCheck = new Map();

// Lista de tokens con alta volatilidad
const MONITORING_TOKENS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'LINKUSDT', 'UNIUSDT',
  'ETCUSDT', 'XLMUSDT', 'NEARUSDT', 'ALGOUSDT', 'VETUSDT',
  'FTMUSDT', 'MANAUSDT', 'SANDUSDT', 'AXSUSDT', 'CHZUSDT',
  'ENJUSDT', 'GALAUSDT', 'HBARUSDT', 'ICPUSDT', 'FILUSDT'
];

// Función para obtener precios con mejor manejo de errores
async function getRealTimePrices() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      timeout: 10000,
      headers: {
        'User-Agent': 'PumpDetector/1.0'
      }
    });

    const prices = response.data
      .filter(item => MONITORING_TOKENS.includes(item.symbol))
      .map(item => ({
        symbol: item.symbol,
        price: parseFloat(item.price),
        timestamp: Date.now()
      }));

    return prices;
  } catch (error) {
    console.error('Error fetching prices:', error.message);
    return [];
  }
}

// Función para obtener datos de mercado en lote
async function getMarketDataBatch() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      timeout: 10000,
      headers: {
        'User-Agent': 'PumpDetector/1.0'
      }
    });

    const marketData = new Map();
    response.data
      .filter(item => MONITORING_TOKENS.includes(item.symbol))
      .forEach(item => {
        marketData.set(item.symbol, {
          volume: parseFloat(item.volume),
          volumeUSDT: parseFloat(item.quoteVolume),
          change24h: parseFloat(item.priceChangePercent),
          high24h: parseFloat(item.highPrice),
          low24h: parseFloat(item.lowPrice),
          trades: parseInt(item.count)
        });
      });

    return marketData;
  } catch (error) {
    console.error('Error fetching market data:', error.message);
    return new Map();
  }
}

// Función mejorada para detectar pumps
function detectPumps(currentPrices, marketData) {
  const pumps = [];
  const now = Date.now();
  const windowStart = now - (PRICE_HISTORY_MINUTES * 60 * 1000);

  for (const current of currentPrices) {
    const { symbol, price, timestamp } = current;
    
    // Inicializar historial si no existe
    if (!priceHistory.has(symbol)) {
      priceHistory.set(symbol, []);
    }

    const history = priceHistory.get(symbol);
    
    // Agregar precio actual al historial
    history.push({ price, timestamp });

    // Limpiar historial antiguo
    const recentHistory = history.filter(h => h.timestamp > windowStart);
    priceHistory.set(symbol, recentHistory.slice(-MAX_HISTORY_SIZE));

    // Necesitamos al menos 2 puntos para detectar pump
    if (recentHistory.length < 2) continue;

    // Calcular precio promedio de los últimos minutos
    const avgPrice = recentHistory.reduce((sum, h) => sum + h.price, 0) / recentHistory.length;
    const minPrice = Math.min(...recentHistory.map(h => h.price));
    const maxPrice = Math.max(...recentHistory.map(h => h.price));

    // Detectar pump usando múltiples criterios
    const priceChangeFromMin = ((price - minPrice) / minPrice) * 100;
    const priceChangeFromAvg = ((price - avgPrice) / avgPrice) * 100;
    const volatility = ((maxPrice - minPrice) / minPrice) * 100;

    // Criterios para detectar pump
    const isPump = (
      priceChangeFromMin >= MIN_PROFIT_MARGIN ||
      priceChangeFromAvg >= MIN_PROFIT_MARGIN/2 ||
      volatility >= MIN_PROFIT_MARGIN * 2
    );

    // Evitar duplicados recientes
    const lastCheck = lastPumpCheck.get(symbol) || 0;
    const timeSinceLastPump = now - lastCheck;

    if (isPump && timeSinceLastPump > 30000) { // 30 segundos entre alertas del mismo token
      const profitMargin = Math.max(priceChangeFromMin, priceChangeFromAvg);
      const potentialProfit = CAPITAL * (profitMargin / 100);
      
      // Obtener datos de mercado
      const market = marketData.get(symbol) || {};

      pumps.push({
        symbol: symbol,
        currentPrice: price,
        minPrice: minPrice,
        avgPrice: parseFloat(avgPrice.toFixed(8)),
        maxPrice: maxPrice,
        profitMargin: parseFloat(profitMargin.toFixed(2)),
        potentialProfit: parseFloat(potentialProfit.toFixed(2)),
        priceChangeFromMin: parseFloat(priceChangeFromMin.toFixed(2)),
        priceChangeFromAvg: parseFloat(priceChangeFromAvg.toFixed(2)),
        volatility: parseFloat(volatility.toFixed(2)),
        timestamp: new Date(timestamp).toISOString(),
        status: 'PUMP_DETECTED',
        confidence: profitMargin > 5 ? 'HIGH' : profitMargin > 2 ? 'MEDIUM' : 'LOW',
        dataPoints: recentHistory.length,
        volume24h: market.volumeUSDT || 0,
        change24h: market.change24h || 0,
        trades24h: market.trades || 0
      });

      lastPumpCheck.set(symbol, now);
    }
  }

  return pumps;
}

// Función principal de monitoreo mejorada
async function monitorTokens() {
  try {
    console.log(`🔍 Scanning at ${new Date().toISOString()}`);
    
    // Obtener precios y datos de mercado en paralelo
    const [currentPrices, marketData] = await Promise.all([
      getRealTimePrices(),
      getMarketDataBatch()
    ]);

    if (currentPrices.length === 0) {
      console.log('⚠️ No price data received');
      return;
    }

    const detectedPumps = detectPumps(currentPrices, marketData);
    
    if (detectedPumps.length > 0) {
      console.log(`🚀 PUMPS DETECTED: ${detectedPumps.length}`);
      detectedPumps.forEach(pump => {
        console.log(`   ${pump.symbol}: ${pump.profitMargin}% (${pump.confidence})`);
      });
      
      // Guardar alertas
      const alert = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        pumps: detectedPumps,
        totalOpportunities: detectedPumps.length,
        totalPotentialProfit: detectedPumps.reduce((sum, p) => sum + p.potentialProfit, 0)
      };

      activeAlerts.push(alert);
      
      // Mantener solo las últimas 100 alertas
      if (activeAlerts.length > 100) {
        activeAlerts = activeAlerts.slice(-100);
      }
    } else {
      console.log('📊 No pumps detected this cycle');
    }
    
  } catch (error) {
    console.error('Error in monitoring cycle:', error.message);
  }
}

// Funciones de control
function startMonitoring() {
  if (monitoringActive) {
    console.log('⚠️ Monitoring already active');
    return;
  }
  
  monitoringActive = true;
  console.log(`🎯 Starting pump monitoring`);
  console.log(`💰 Capital: $${CAPITAL.toLocaleString()}`);
  console.log(`📈 Min profit: ${MIN_PROFIT_MARGIN}%`);
  console.log(`⏱️  Interval: ${MONITOR_INTERVAL/1000}s`);
  console.log(`🎯 Tokens: ${MONITORING_TOKENS.length}`);
  
  // Ejecutar inmediatamente
  monitorTokens();
  
  // Programar ejecución periódica
  monitoringInterval = setInterval(monitorTokens, MONITOR_INTERVAL);
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  monitoringActive = false;
  console.log('⏹️ Monitoring stopped');
}

// ENDPOINTS MEJORADOS

// Endpoint principal para pumps en tiempo real
app.get('/pumps/live', (req, res) => {
  try {
    const recentAlerts = activeAlerts.slice(-5);
    const currentPumps = recentAlerts.length > 0 ? recentAlerts[recentAlerts.length - 1].pumps : [];
    const totalPotentialProfit = currentPumps.reduce((sum, p) => sum + p.potentialProfit, 0);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      monitoringActive: monitoringActive,
      config: {
        capital: CAPITAL,
        minProfitMargin: MIN_PROFIT_MARGIN,
        monitorInterval: MONITOR_INTERVAL,
        tokensMonitored: MONITORING_TOKENS.length
      },
      currentPumps: currentPumps,
      summary: {
        totalPumps: currentPumps.length,
        totalPotentialProfit: parseFloat(totalPotentialProfit.toFixed(2)),
        highConfidencePumps: currentPumps.filter(p => p.confidence === 'HIGH').length,
        avgProfitMargin: currentPumps.length > 0 ? 
          parseFloat((currentPumps.reduce((sum, p) => sum + p.profitMargin, 0) / currentPumps.length).toFixed(2)) : 0
      },
      stats: {
        totalAlertsToday: activeAlerts.length,
        tokensWithHistory: priceHistory.size,
        nextScanIn: monitoringActive ? `${Math.ceil((MONITOR_INTERVAL - (Date.now() % MONITOR_INTERVAL)) / 1000)}s` : 'N/A'
      }
    });
  } catch (error) {
    console.error('Error in /pumps/live:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para historial
app.get('/pumps/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = activeAlerts.slice(-limit);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalAlerts: activeAlerts.length,
      history: history,
      stats: {
        avgPumpsPerAlert: history.length > 0 ? 
          parseFloat((history.reduce((sum, alert) => sum + alert.pumps.length, 0) / history.length).toFixed(1)) : 0,
        topPerformers: getTopPerformers(),
        totalProfitOpportunities: history.reduce((sum, alert) => sum + (alert.totalPotentialProfit || 0), 0)
      }
    });
  } catch (error) {
    console.error('Error in /pumps/history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Función para obtener top performers
function getTopPerformers() {
  const performers = new Map();
  
  activeAlerts.forEach(alert => {
    alert.pumps.forEach(pump => {
      const current = performers.get(pump.symbol) || { 
        count: 0, 
        maxProfit: 0, 
        totalProfit: 0,
        avgVolume: 0
      };
      
      performers.set(pump.symbol, {
        count: current.count + 1,
        maxProfit: Math.max(current.maxProfit, pump.profitMargin),
        totalProfit: current.totalProfit + pump.profitMargin,
        avgVolume: current.avgVolume + (pump.volume24h || 0)
      });
    });
  });
  
  return Array.from(performers.entries())
    .map(([symbol, data]) => ({
      symbol,
      pumpCount: data.count,
      maxProfitMargin: parseFloat(data.maxProfit.toFixed(2)),
      avgProfitMargin: parseFloat((data.totalProfit / data.count).toFixed(2)),
      avgVolume: parseFloat((data.avgVolume / data.count).toFixed(0))
    }))
    .sort((a, b) => b.maxProfitMargin - a.maxProfitMargin)
    .slice(0, 10);
}

// Endpoints de control
app.post('/monitoring/start', (req, res) => {
  try {
    startMonitoring();
    res.json({
      success: true,
      message: 'Pump monitoring started',
      timestamp: new Date().toISOString(),
      config: {
        capital: CAPITAL,
        minProfitMargin: MIN_PROFIT_MARGIN,
        interval: `${MONITOR_INTERVAL/1000}s`,
        tokens: MONITORING_TOKENS.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/monitoring/stop', (req, res) => {
  try {
    stopMonitoring();
    res.json({
      success: true,
      message: 'Pump monitoring stopped',
      timestamp: new Date().toISOString(),
      totalAlertsGenerated: activeAlerts.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/monitoring/reset', (req, res) => {
  try {
    priceHistory.clear();
    activeAlerts = [];
    lastPumpCheck.clear();
    
    res.json({
      success: true,
      message: 'Monitoring data reset',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de estado
app.get('/status', (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    system: {
      monitoringActive: monitoringActive,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nextScan: monitoringActive ? new Date(Date.now() + MONITOR_INTERVAL).toISOString() : null
    },
    config: {
      capital: CAPITAL,
      minProfitMargin: MIN_PROFIT_MARGIN,
      monitorInterval: `${MONITOR_INTERVAL/1000}s`,
      tokensMonitored: MONITORING_TOKENS.length,
      historyWindow: `${PRICE_HISTORY_MINUTES}min`
    },
    data: {
      tokensWithHistory: priceHistory.size,
      totalAlerts: activeAlerts.length,
      totalDataPoints: Array.from(priceHistory.values()).reduce((sum, arr) => sum + arr.length, 0)
    }
  });
});

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    name: 'Pump Detection API',
    version: '2.0',
    status: monitoringActive ? 'MONITORING' : 'IDLE',
    description: 'Real-time cryptocurrency pump detection system',
    endpoints: {
      'GET /pumps/live': 'Get current pump opportunities',
      'GET /pumps/history': 'Get historical pump alerts',
      'GET /status': 'Get system status',
      'POST /monitoring/start': 'Start monitoring',
      'POST /monitoring/stop': 'Stop monitoring',
      'POST /monitoring/reset': 'Reset all data'
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
    status: 'healthy',
    monitoring: monitoringActive,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Pump Detection API v2.0 running on port ${PORT}`);
  console.log(`💰 Capital: $${CAPITAL.toLocaleString()}`);
  console.log(`📈 Min profit: ${MIN_PROFIT_MARGIN}%`);
  console.log(`⏱️  Interval: ${MONITOR_INTERVAL/1000}s`);
  console.log(`🎯 Tokens: ${MONITORING_TOKENS.length}`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
  
  // Auto-start monitoring después de 3 segundos
  setTimeout(() => {
    console.log('🔄 Auto-starting monitoring...');
    startMonitoring();
  }, 3000);
});

// Cleanup
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  stopMonitoring();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  stopMonitoring();
  process.exit(0);
});

module.exports = app;
