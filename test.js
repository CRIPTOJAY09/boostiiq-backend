const axios = require('axios');

async function testAPI() {
  try {
    const res = await axios.get('http://localhost:3000/price/binance');
    console.log('✅ API response:', res.data);
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.response) {
      console.log('Status:', err.response.status);
      console.log('Data:', err.response.data);
    }
  }
}

testAPI();