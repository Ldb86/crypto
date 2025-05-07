require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { EMA, RSI } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.CHAT_ID;

const coins = ['bitcoin', 'ethereum', 'solana'];
const vs_currency = 'usd';

// Tracking ultimi segnali per evitare ripetizioni
const lastSignals = {
  bitcoin: { type: null, timestamp: 0 },
  ethereum: { type: null, timestamp: 0 },
  solana: { type: null, timestamp: 0 }
};

const SIGNAL_INTERVAL_MS = 15 * 60 * 1000;

// === ROUTE BASE ===
app.get('/', (req, res) => {
  res.send('API Crypto attiva ✅');
});

app.listen(PORT, () => {
  console.log(`🚀 Server in ascolto sulla porta ${PORT}`);
});

// === Funzione invio Telegram ===
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
    console.log(`📬 Messaggio Telegram inviato:\n${message}\n`);
  } catch (err) {
    console.error('Errore Telegram:', err.message);
  }
}

// === Downsample a ogni 15 minuti ===
function downsampleTo15Min(data) {
  const result = [];
  let lastTime = 0;
  for (let [timestamp, price] of data) {
    if (timestamp - lastTime >= 15 * 60 * 1000) {
      result.push(price);
      lastTime = timestamp;
    }
  }
  return result;
}

// === Ottieni prezzi da CoinGecko ===
async function fetchPrices(coinId) {
  const now = Math.floor(Date.now() / 1000);
  const past = now - (60 * 60 * 24); // 24 ore
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=${vs_currency}&from=${past}&to=${now}`;
  const res = await axios.get(url);
  return downsampleTo15Min(res.data.prices);
}

// === Analisi incroci + invio messaggio ===
async function checkMarket() {
  console.clear();
  console.log(`🕒 ${new Date().toLocaleTimeString()}`);

  for (let coin of coins) {
    try {
      const prices = await fetchPrices(coin);
      const lastPrice = prices.at(-1);

      const ema12Arr = EMA.calculate({ values: prices, period: 12 });
      const ema26Arr = EMA.calculate({ values: prices, period: 26 });
      const ema50Arr = EMA.calculate({ values: prices, period: 50 });
      const ema200Arr = EMA.calculate({ values: prices, period: 200 });
      const rsiArr = RSI.calculate({ values: prices, period: 14 });

      if ([ema12Arr, ema26Arr, ema50Arr, ema200Arr, rsiArr].some(arr => arr.length < 2)) {
        console.warn(`Dati insufficienti per ${coin}`);
        continue;
      }

      const ema12 = ema12Arr.at(-1);
      const ema26 = ema26Arr.at(-1);
      const ema50 = ema50Arr.at(-1);
      const ema200 = ema200Arr.at(-1);
      const rsi = rsiArr.at(-1);
      const rsiStatus = rsi > 70 ? 'Ipercomprato' : rsi < 30 ? 'Ipervenduto' : 'Neutro';

      const prevEma12 = ema12Arr.at(-2);
      const prevEma26 = ema26Arr.at(-2);

      let crossover = null;
      if (prevEma12 < prevEma26 && ema12 > ema26) {
        crossover = 'bullish';
      } else if (prevEma12 > prevEma26 && ema12 < ema26) {
        crossover = 'bearish';
      }

      const now = Date.now();
      const last = lastSignals[coin];

      if (crossover) {
        if (last.type !== crossover || now - last.timestamp >= SIGNAL_INTERVAL_MS) {
          const message = `
📢 *Segnale ${crossover === 'bullish' ? 'LONG 🟢' : 'SHORT 🔴'} per ${coin.toUpperCase()}*
💰 *Prezzo attuale:* $${lastPrice.toFixed(2)}

📊 EMA 12: $${ema12.toFixed(2)}
📊 EMA 26: $${ema26.toFixed(2)}
📊 EMA 50: $${ema50.toFixed(2)}
📊 EMA 200: $${ema200.toFixed(2)}

📈 RSI (14): ${rsi.toFixed(2)} (${rsiStatus}) ✅
          `.trim();

          await sendTelegramMessage(message);
          lastSignals[coin] = { type: crossover, timestamp: now };
        } else {
          console.log(`⏳ ${coin}: incrocio ${crossover}, segnale già inviato.`);
        }
      } else {
        lastSignals[coin] = { type: null, timestamp: 0 };
        console.log(`📉 Nessun incrocio EMA per ${coin.toUpperCase()}`);
      }
    } catch (err) {
      console.error(`❌ Errore su ${coin}:`, err.message);
    }
  }
}

// Analisi ogni minuto
checkMarket();
setInterval(checkMarket, 60 * 1000);
