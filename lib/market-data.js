'use strict';

const { JSDOM } = require('jsdom');
const Database = require('better-sqlite3');
const path = require('path');

const CACHE_TTL_MS = 60_000;
const ERROR_COOLDOWN_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CBK_SOURCE = 'Central Bank of Kenya';
const FOREX_URL = 'https://www.centralbank.go.ke/forex/';
const BILLS_URL = 'https://www.centralbank.go.ke/bills-bonds/treasury-bills/';
const CBR_URL = 'https://www.centralbank.go.ke/rates/central-bank-rate/';
const INFLATION_URL = 'https://www.centralbank.go.ke/inflation-rates/';
const PROVIDER_BASE = 'https://mansaapi.com/api/v1/';

// Mansa API: 100 requests/day limit - smart scheduling
const MANSA_DAILY_LIMIT = 100;
const MANSA_MARKET_HOURS = { start: 8, end: 17 }; // 8am-5pm EAT
const MANSA_ACTIVE_WEIGHT = 0.7; // 70% of requests during market hours
const MANSA_OFF_HOURS_WEIGHT = 0.3;

const OFFICIAL_SOURCES = [
  { name: 'NSE — Nairobi Securities Exchange', url: 'https://www.nse.co.ke' },
  { name: 'CBK Forex', url: FOREX_URL },
  { name: 'CBK Bills', url: BILLS_URL },
  { name: 'CBK CBR', url: CBR_URL },
  { name: 'CBK Inflation', url: INFLATION_URL },
  { name: 'CMA — Capital Markets Authority', url: 'https://www.cma.or.ke' },
];

const CURRENCIES = [
  { label: 'US DOLLAR', code: 'USD', name: 'US Dollar', required: true },
  { label: 'EURO', code: 'EUR', name: 'Euro', required: true },
  { label: 'STG POUND', code: 'GBP', name: 'British Pound', required: true },
  { label: 'CHINESE YUAN', code: 'CNY', name: 'Chinese Yuan', required: true },
  { label: 'JPY (100)', code: 'JPY', name: 'Japanese Yen', required: true, quotedPer100: true },
  { label: 'KES / RWF', code: 'RWF', name: 'Rwandan Franc', required: true, reverse: true },
  { label: 'KES / TSHS', code: 'TZS', name: 'Tanzanian Shilling', required: true, reverse: true },
  { label: 'KES / USHS', code: 'UGX', name: 'Ugandan Shilling', required: true, reverse: true },
  { label: 'KES / BIF', code: 'BIF', name: 'Burundian Franc', required: true, reverse: true },
  { label: 'SA RAND', code: 'ZAR', name: 'South African Rand' },
  { label: 'IND RUPEE', code: 'INR', name: 'Indian Rupee' },
  { label: 'AE DIRHAM', code: 'AED', name: 'UAE Dirham' },
  { label: 'CAN $', code: 'CAD', name: 'Canadian Dollar' },
  { label: 'S FRANC', code: 'CHF', name: 'Swiss Franc' },
  { label: 'SW KRONER', code: 'SEK', name: 'Swedish Krona' },
  { label: 'DAN KRONER', code: 'DKK', name: 'Danish Krone' },
  { label: 'AUSTRALIAN $', code: 'AUD', name: 'Australian Dollar' },
  { label: 'SINGAPORE DOLLAR', code: 'SGD', name: 'Singapore Dollar' },
  { label: 'HONGKONG DOLLAR', code: 'HKD', name: 'Hong Kong Dollar' },
  { label: 'SAUDI RIYAL', code: 'SAR', name: 'Saudi Riyal' },
  { label: 'NOR KRONER', code: 'NOK', name: 'Norwegian Krone' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Persistent cache via SQLite
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', 'fincapita.sqlite');
const marketDb = new Database(dbPath);
marketDb.pragma('journal_mode = WAL');
marketDb.exec(`
  CREATE TABLE IF NOT EXISTS market_data_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    retry_after INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_market_cache_expires ON market_data_cache(expires_at);
  
  CREATE TABLE IF NOT EXISTS market_data_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_market_requests_timestamp ON market_data_requests(timestamp);
`);

const sectionCache = new Map();

class ProviderRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
  }
}

function clone(value) {
  return structuredClone(value);
}

function safeReason(error, secret = '') {
  let reason = error instanceof Error ? error.message : 'Market-data request failed.';
  if (secret) reason = reason.split(secret).join('[redacted]');
  return reason
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 240) || 'Market-data request failed.';
}

function providerString(value, secret) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text || (secret && text.includes(secret))) return null;
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200);
}

async function fetchWithTimeout(url, options = {}) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal,
      headers: {
        'User-Agent': 'FinCapita-MarketData/1.0',
        ...options.headers,
      },
    });
  } catch (error) {
    if (signal.aborted) throw new Error('Request timed out.');
    throw error;
  }
}

async function fetchCbkText(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: { Accept: 'text/html,application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`CBK request failed with HTTP ${response.status}.`);
  return response.text();
}

async function fetchProvider(path, key) {
  const response = await fetchWithTimeout(new URL(path.replace(/^\/+/, ''), PROVIDER_BASE), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    throw new ProviderRequestError(`Provider request failed with HTTP ${response.status}.`, response.status);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Provider returned an invalid JSON response.');
  }
  if (payload?.success === false) throw new Error('Provider returned an unsuccessful response.');
  return payload;
}

function getCachedSection(key, loader, unavailable) {
  let entry = sectionCache.get(key);
  if (!entry) {
    // Try loading from persistent cache first
    const row = marketDb.prepare('SELECT value, cached_at, expires_at, retry_after, last_error FROM market_data_cache WHERE key = ?').get(key);
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        entry = {
          value: parsed,
          cachedAt: row.cached_at,
          expiresAt: row.expires_at,
          inFlight: null,
          retryAfter: row.retry_after || 0,
          lastError: row.last_error || null,
        };
      } catch {
        entry = { value: null, cachedAt: 0, expiresAt: 0, inFlight: null, retryAfter: 0, lastError: null };
      }
    } else {
      entry = { value: null, cachedAt: 0, expiresAt: 0, inFlight: null, retryAfter: 0, lastError: null };
    }
    sectionCache.set(key, entry);
  }
  if (entry.value && entry.expiresAt > Date.now()) return Promise.resolve(clone(entry.value));
  if (entry.inFlight) return entry.inFlight;
  if (entry.retryAfter > Date.now()) {
    if (entry.value) return Promise.resolve({ ...clone(entry.value), stale: true });
    return Promise.resolve(unavailable(entry.lastError || new Error('Source is retrying after a temporary failure.')));
  }

  // Smart Mansa API scheduling - check if we should throttle
  if (key === 'nse') {
    const now = new Date();
    const hour = now.getUTCHours() + 3; // Convert to EAT (UTC+3)
    const isMarketHours = hour >= MANSA_MARKET_HOURS.start && hour < MANSA_MARKET_HOURS.end;
    
    // Count requests today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const requestsToday = marketDb.prepare('SELECT COUNT(*) as count FROM market_data_requests WHERE timestamp >= ?').get(todayStart)?.count || 0;
    
    if (requestsToday >= MANSA_DAILY_LIMIT) {
      // Daily limit reached, return stale data if available
      if (entry.value) return Promise.resolve({ ...clone(entry.value), stale: true });
      return Promise.resolve(unavailable(new Error('Daily API limit reached. Showing cached data.')));
    }
    
    // Throttle during off-hours to preserve quota
    if (!isMarketHours && requestsToday > MANSA_DAILY_LIMIT * MANSA_OFF_HOURS_WEIGHT) {
      const nextMarketOpen = new Date(now);
      nextMarketOpen.setUTCHours(MANSA_MARKET_HOURS.start - 3, 0, 0, 0); // Convert EAT to UTC
      if (nextMarketOpen <= now) nextMarketOpen.setDate(nextMarketOpen.getDate() + 1);
      const waitMs = nextMarketOpen.getTime() - now.getTime();
      
      if (entry.value) {
        // Schedule background refresh for market open
        setTimeout(() => {
          if (marketDb.prepare('SELECT COUNT(*) as count FROM market_data_requests WHERE timestamp >= ?').get(todayStart)?.count < MANSA_DAILY_LIMIT) {
            getCachedSection(key, loader, unavailable); // Trigger refresh
          }
        }, waitMs);
        return Promise.resolve({ ...clone(entry.value), stale: true });
      }
    }
  }

  entry.inFlight = (async () => {
    try {
      const fetchedAt = new Date().toISOString();
      const value = await loader();
      if (!value || value.available !== true) throw new Error('Source returned no usable data.');
      
      // Track Mansa API requests
      if (key === 'nse') {
        const requestCount = [3, 1].reduce((sum, v) => sum + v, 0); // 3 NSE calls + 1 history = 4
        for (let i = 0; i < requestCount; i++) {
          marketDb.prepare('INSERT INTO market_data_requests (key, timestamp) VALUES (?, ?)').run(key, Date.now());
        }
      }
      
      entry.value = clone({ ...value, fetchedAt: value.fetchedAt || fetchedAt });
      entry.cachedAt = Date.now();
      entry.expiresAt = entry.cachedAt + CACHE_TTL_MS;
      entry.retryAfter = 0;
      entry.lastError = null;
      
      // Persist to SQLite
      marketDb.prepare('INSERT OR REPLACE INTO market_data_cache (key, value, cached_at, expires_at, retry_after, last_error) VALUES (?, ?, ?, ?, ?, ?)')
        .run(key, JSON.stringify(entry.value), entry.cachedAt, entry.expiresAt, entry.retryAfter, entry.lastError);
      
      return clone(entry.value);
    } catch (error) {
      entry.retryAfter = Date.now() + ERROR_COOLDOWN_MS;
      entry.lastError = error.message;
      
      // Persist error state
      if (entry.value) {
        marketDb.prepare('INSERT OR REPLACE INTO market_data_cache (key, value, cached_at, expires_at, retry_after, last_error) VALUES (?, ?, ?, ?, ?, ?)')
          .run(key, JSON.stringify(entry.value), entry.cachedAt, entry.expiresAt, entry.retryAfter, entry.lastError);
      }
      
      if (entry.value) return { ...clone(entry.value), stale: true };
      return unavailable(error);
    } finally {
      entry.inFlight = null;
    }
  })();
  return entry.inFlight;
}

function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim().replace(/,/g, '').replace(/\s+/g, '');
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text)) return null;
  const number = Number(text.replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
}

function makeIsoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/\u00a0/g, ' ');
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (match) return makeIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (match) return makeIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(match[2].toLowerCase()));
    if (month !== -1) return makeIsoDate(Number(match[3]), month + 1, Number(match[1]));
  }
  return null;
}

function dateTimestamp(value) {
  const date = parseDateOnly(value);
  return date ? new Date(`${date}T00:00:00.000Z`).toISOString() : null;
}

function monthObservationPeriod(value) {
  const date = parseDateOnly(value);
  if (!date) return null;
  const [year, month] = date.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: dateTimestamp(date), end: dateTimestamp(end) };
}

function parseDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
    const timestamp = Number(value);
    date = new Date(Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp);
  } else if (typeof value === 'string') {
    const text = value.trim();
    const dateOnly = parseDateOnly(text);
    if (dateOnly && !/[T\s]\d{1,2}:\d{2}/.test(text)) return dateTimestamp(dateOnly);
    const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)
      ? `${text.replace(' ', 'T')}Z`
      : text;
    date = new Date(normalized);
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestTimestamp(values) {
  const timestamps = values.filter(Boolean).sort();
  return timestamps.length ? timestamps[timestamps.length - 1] : null;
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sol: '/' };
  let decoded = String(value);
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replace(/&#(x[\da-f]+|\d+);/gi, (entity, code) => {
        try {
          return String.fromCodePoint(parseInt(code, code[0].toLowerCase() === 'x' ? 16 : 10));
        } catch {
          return entity;
        }
      })
      .replace(/&(amp|lt|gt|quot|apos|nbsp|sol);/gi, (entity, name) => named[name.toLowerCase()] || entity);
  }
  return decoded;
}

function withDocument(html, parser) {
  const dom = new JSDOM(html);
  try {
    return parser(dom.window.document);
  } finally {
    dom.window.close();
  }
}

function textWithSpaces(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(node.tagName)) return '';
  return [...node.childNodes].map(textWithSpaces).join(' ');
}

function readField(record, aliases) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const fields = new Map(Object.keys(record).map((key) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), record[key]]));
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) return record[alias];
    const normalized = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fields.has(normalized)) return fields.get(normalized);
    if (alias.includes('.')) {
      let nested = record;
      for (const part of alias.split('.')) {
        if (!nested || typeof nested !== 'object') return undefined;
        nested = nested[part];
      }
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function firstString(record, aliases) {
  for (const alias of aliases) {
    const value = readField(record, [alias]);
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return null;
}

function firstNumber(record, aliases) {
  for (const alias of aliases) {
    const value = finiteNumber(readField(record, [alias]));
    if (value !== null) return value;
  }
  return null;
}

function forexUnavailable(error) {
  return {
    available: false,
    status: 'unavailable',
    asOf: null,
    pairs: [],
    source: CBK_SOURCE,
    url: FOREX_URL,
    reason: safeReason(error),
  };
}

function buildForexForm() {
  const params = new URLSearchParams({
    draw: '1',
    start: '0',
    length: '500',
    'order[0][column]': '0',
    'order[0][dir]': 'desc',
    'search[value]': '',
    'search[regex]': 'false',
  });
  for (let index = 0; index < 3; index += 1) {
    params.set(`columns[${index}][data]`, String(index));
    params.set(`columns[${index}][name]`, '');
    params.set(`columns[${index}][searchable]`, 'true');
    params.set(`columns[${index}][orderable]`, 'true');
    params.set(`columns[${index}][search][value]`, '');
    params.set(`columns[${index}][search][regex]`, 'false');
  }
  return params;
}

async function loadForex() {
  const text = await fetchCbkText(
    'https://www.centralbank.go.ke/wp-admin/admin-ajax.php?action=get_wdtable&table_id=193',
    {
      method: 'POST',
      body: buildForexForm(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }
  );
  const payload = JSON.parse(text);
  if (!Array.isArray(payload?.data)) throw new Error('CBK forex response did not contain a data array.');

  const groups = new Map();
  for (const row of payload.data) {
    const date = parseDateOnly(Array.isArray(row) ? row[0] : firstString(row, ['date', '0']));
    const label = String(Array.isArray(row) ? row[1] : firstString(row, ['currency', 'currency_name', 'name', '1']) || '')
      .trim().toUpperCase().replace(/\s+/g, ' ');
    const quote = finiteNumber(Array.isArray(row) ? row[2] : readField(row, ['value', 'rate', 'exchange_rate', '2']));
    const currency = CURRENCIES.find((item) => item.label === label);
    if (!date || !currency || quote === null || quote <= 0) continue;
    if (!groups.has(date)) groups.set(date, new Map());
    groups.get(date).set(currency.code, quote);
  }

  const required = CURRENCIES.filter((currency) => currency.required).map((currency) => currency.code);
  const selected = [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .find(([, rates]) => required.every((code) => rates.has(code)));
  if (!selected) throw new Error('CBK forex response did not contain a latest complete currency set.');

  const [asOf, rates] = selected;
  const pairs = CURRENCIES.filter((currency) => rates.has(currency.code)).map((currency) => {
    const quote = rates.get(currency.code);
    const rate = currency.reverse ? 1 / quote : currency.quotedPer100 ? quote / 100 : quote;
    return {
      code: currency.code,
      name: currency.name,
      rate,
      inverse: currency.reverse ? quote : 1 / rate,
      quotedPer100: Boolean(currency.quotedPer100),
      source: CBK_SOURCE,
    };
  });
  return {
    available: true,
    status: 'daily_reference',
    asOf: dateTimestamp(asOf),
    pairs,
    source: CBK_SOURCE,
    url: FOREX_URL,
  };
}

async function getForexData() {
  return getCachedSection('forex', loadForex, forexUnavailable);
}

function billsUnavailable(error) {
  return {
    available: false,
    status: 'unavailable',
    asOf: null,
    asOfBasis: null,
    updatedAt: null,
    fetchedAt: null,
    auctionPeriod: null,
    treasuryBills: [],
    source: CBK_SOURCE,
    url: BILLS_URL,
    reason: safeReason(error),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function captureField(text, labels, followingLabels) {
  const labelPattern = labels.map(escapeRegExp).join('|');
  const stopPattern = followingLabels.length
    ? `(?=\\s*(?:${followingLabels.map(escapeRegExp).join('|')}))`
    : '$';
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*([\\s\\S]*?)${stopPattern}`, 'i'));
  return match ? match[1].trim() : null;
}

async function loadTreasuryBills() {
  const html = await fetchCbkText(BILLS_URL);
  const items = withDocument(html, (document) => {
    const text = textWithSpaces(document.body).replace(/\s+/g, ' ').trim();
    const start = text.toLowerCase().indexOf('treasury bills on offer');
    if (start === -1) return [];
    const endMarkers = ['Government Securities Auction and Maturities Schedule', 'Treasury Bills Average Rates'];
    const ends = endMarkers.map((marker) => text.indexOf(marker, start)).filter((index) => index > start);
    const end = ends.length ? Math.min(...ends) : text.length;
    const onOffer = text.slice(start, end);
    const tenors = [...onOffer.matchAll(/\b(91|182|364)\s*[-–]?\s*DAY\b/gi)];
    const parsed = [];

    for (let index = 0; index < tenors.length; index += 1) {
      const tenorDays = Number(tenors[index][1]);
      const block = onOffer.slice(tenors[index].index, tenors[index + 1]?.index ?? onOffer.length);
      const issueNumber = captureField(block, ['Issue Number'], ['Auction Date']);
      const auctionDate = parseDateOnly(captureField(block, ['Auction Date'], ['Value Dated', 'Value Date']));
      const valueDate = parseDateOnly(captureField(block, ['Value Dated', 'Value Date'], ['Previous Average Interest Rate']));
      const previousAverageRate = finiteNumber(captureField(block, ['Previous Average Interest Rate'], []));
      if (!issueNumber || !auctionDate || !valueDate || previousAverageRate === null) continue;
      parsed.push({ tenorDays, label: `${tenorDays}-day`, issueNumber, auctionDate, valueDate, previousAverageRate });
    }

    const unique = new Map();
    for (const item of parsed.sort((left, right) => right.auctionDate.localeCompare(left.auctionDate))) {
      if (!unique.has(item.tenorDays)) unique.set(item.tenorDays, item);
    }
    const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const upcoming = [...unique.values()].filter((item) => item.auctionDate >= today).sort((left, right) => left.tenorDays - right.tenorDays);
    if (!upcoming.length) throw new Error('CBK has no forthcoming Treasury bill offers.');
    return upcoming;
  });
  if (!items.length) throw new Error('CBK Treasury bills on-offer data could not be parsed.');
  const fetchedAt = new Date().toISOString();
  const auctionDates = items.map((item) => item.auctionDate).sort();
  return {
    available: true,
    status: 'on_offer',
    asOf: fetchedAt,
    asOfBasis: 'fetched',
    updatedAt: fetchedAt,
    fetchedAt,
    auctionPeriod: { start: dateTimestamp(auctionDates[0]), end: dateTimestamp(auctionDates[auctionDates.length - 1]) },
    treasuryBills: items,
    source: CBK_SOURCE,
    url: BILLS_URL,
  };
}

function cbrUnavailable(error) {
  return {
    available: false,
    status: 'unavailable',
    rate: null,
    asOf: null,
    history: [],
    source: CBK_SOURCE,
    url: CBR_URL,
    reason: safeReason(error),
  };
}

async function loadCentralBankRate() {
  const html = await fetchCbkText(CBR_URL);
  const rates = new Map();
  const addPair = (date, rate) => {
    const parsedDate = parseDateOnly(date);
    const parsedRate = finiteNumber(rate);
    if (parsedDate && parsedRate !== null && parsedRate >= 0 && parsedRate <= 100 && !rates.has(parsedDate)) rates.set(parsedDate, parsedRate);
  };

  withDocument(html, (document) => {
    const table = [...document.querySelectorAll('table')].find((candidate) => {
      if (candidate.getAttribute('data-wpdatatable_id') === '15') return true;
      const headers = [...candidate.querySelectorAll('thead th')].map((cell) => cell.textContent.trim().toLowerCase());
      return headers[0] === 'date' && headers[1] === 'rate';
    });
    if (!table) return;

    for (const row of table.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td, th')].map((cell) => cell.textContent.trim());
      if (cells.length === 2) addPair(cells[0], cells[1]);
    }

    const associated = [table.outerHTML];
    const describedBy = table.getAttribute('data-described-by');
    const config = describedBy ? document.getElementById(describedBy) : null;
    if (config) associated.push(config.value || config.textContent || '');
    for (const script of document.querySelectorAll('script')) {
      const source = script.textContent || '';
      if (source.includes('"tableWpId":"15"') || source.includes("'tableWpId':'15'") ||
        (table.id && (source.includes(`#${table.id}`) || source.includes(`"${table.id}"`) || source.includes(`'${table.id}'`)))) {
        associated.push(source);
      }
    }

    for (const source of associated) {
      const decoded = decodeEntities(source).replace(/\\\//g, '/').replace(/\\u002f/gi, '/');
      const encodedPair = /(\d{1,2}\/\d{1,2}\/\d{4})["']?\s*(?:\||,|\])\s*["']?\s*(-?\d+(?:\.\d+)?)/g;
      for (const match of decoded.matchAll(encodedPair)) addPair(match[1], match[2]);
    }
  });

  const history = [...rates.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rate]) => ({ date, rate }));
  if (!history.length) throw new Error('CBK central bank rate data could not be parsed.');
  const latest = history[history.length - 1];
  return {
    available: true,
    status: 'official',
    rate: latest.rate,
    asOf: dateTimestamp(latest.date),
    history,
    source: CBK_SOURCE,
    url: CBR_URL,
  };
}

function inflationUnavailable(error) {
  return {
    available: false,
    status: 'unavailable',
    asOf: null,
    asOfBasis: null,
    publicationDate: null,
    updatedAt: null,
    fetchedAt: null,
    observationDate: null,
    observationPeriod: null,
    month: null,
    year: null,
    annualAverage: null,
    twelveMonth: null,
    history: [],
    source: CBK_SOURCE,
    url: INFLATION_URL,
    reason: safeReason(error),
  };
}

function monthNumber(value) {
  const text = String(value || '').trim();
  if (/^\d{1,2}$/.test(text)) {
    const month = Number(text);
    return month >= 1 && month <= 12 ? month : null;
  }
  const index = MONTHS.findIndex((month) => month.toLowerCase().startsWith(text.toLowerCase()));
  return index === -1 ? null : index + 1;
}

async function loadInflation() {
  const html = await fetchCbkText(INFLATION_URL);
  const rows = withDocument(html, (document) => {
    const table = [...document.querySelectorAll('table')].find((candidate) => {
      const headers = [...candidate.querySelectorAll('thead th')].map((cell) => cell.textContent.trim().toLowerCase());
      return ['year', 'month', 'annual average inflation', '12-month inflation'].every((header) => headers.includes(header));
    });
    if (!table) return [];
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim().toLowerCase());
    const yearIndex = headers.indexOf('year');
    const monthIndex = headers.indexOf('month');
    const annualIndex = headers.indexOf('annual average inflation');
    const twelveIndex = headers.indexOf('12-month inflation');
    const unique = new Map();

    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim());
      // CBK repeats the four columns for its responsive desktop/mobile layout.
      for (let offset = 0; offset + Math.max(yearIndex, monthIndex, annualIndex, twelveIndex) < cells.length; offset += 4) {
        const year = finiteNumber(cells[offset + yearIndex]);
        const month = monthNumber(cells[offset + monthIndex]);
        const annualAverage = finiteNumber(cells[offset + annualIndex]);
        const twelveMonth = finiteNumber(cells[offset + twelveIndex]);
        if (!year || !Number.isInteger(year) || !month || annualAverage === null || twelveMonth === null) continue;
        const date = makeIsoDate(year, month, 1);
        if (date) unique.set(date, { date, value: twelveMonth, annualAverage, twelveMonth, month: MONTHS[month - 1], year });
      }
    }
    return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date));
  });
  if (!rows.length) throw new Error('CBK inflation data could not be parsed.');
  const latest = rows[rows.length - 1];
  const fetchedAt = new Date().toISOString();
  return {
    available: true,
    status: 'official',
    asOf: dateTimestamp(latest.date),
    asOfBasis: 'observation',
    publicationDate: null,
    updatedAt: fetchedAt,
    fetchedAt,
    observationDate: dateTimestamp(latest.date),
    observationPeriod: monthObservationPeriod(latest.date),
    month: latest.month,
    year: latest.year,
    annualAverage: latest.annualAverage,
    twelveMonth: latest.twelveMonth,
    history: rows.map(({ date, value, annualAverage, twelveMonth }) => ({ date, observationDate: dateTimestamp(date), value, annualAverage, twelveMonth })),
    source: CBK_SOURCE,
    url: INFLATION_URL,
  };
}

function unconfiguredNse() {
  return {
    available: false,
    providerConfigured: false,
    status: 'unavailable',
    partial: false,
    errors: {},
    providerStatus: null,
    reason: 'No licensed NSE market-data provider is configured.',
    updatedAt: null,
    fetchedAt: null,
    indices: [],
    stocks: [],
    history: {},
    movers: { gainers: [], losers: [] },
    breadth: null,
    sectors: [],
    marketSummary: null,
    source: null,
    url: null,
  };
}

function failedNse(error, secret = '') {
  return {
    available: false,
    providerConfigured: true,
    status: 'error',
    partial: false,
    errors: {},
    providerStatus: null,
    reason: safeReason(error, secret),
    updatedAt: null,
    fetchedAt: null,
    indices: [],
    stocks: [],
    history: {},
    movers: { gainers: [], losers: [] },
    breadth: null,
    sectors: [],
    marketSummary: null,
    source: null,
    url: null,
  };
}

function walk(value, visitor, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  for (const child of Object.values(value)) walk(child, visitor, seen);
}

function indexQuoteValue(record) {
  return firstNumber(record, ['value', 'currentPrice', 'current_price', 'price', 'last', 'close', 'indexValue', 'index_value', 'level']);
}

function stockQuoteValue(record) {
  return firstNumber(record, ['price', 'last', 'last_price', 'lastPrice', 'close', 'currentPrice', 'current_price']);
}

function looksLikeRecord(record, kind) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const quote = kind === 'index' ? indexQuoteValue(record) : stockQuoteValue(record);
  if (quote === null || quote <= 0) return false;
  const identifiers = kind === 'index'
    ? ['code', 'index_code', 'indexCode', 'symbol', 'slug']
    : ['ticker', 'symbol', 'code', 'stock_code', 'stockCode', 'canonical_symbol'];
  const name = firstString(record, ['name', 'company_name', 'companyName', 'index_name', 'indexName', 'title']);
  const identifier = firstString(record, identifiers);
  return Boolean(identifier || name);
}

function extractRecords(payload, kind) {
  const records = [];
  walk(payload, (value) => {
    if (looksLikeRecord(value, kind)) records.push(value);
  });
  return records;
}

function normalizeIndex(record, key) {
  const changeAbs = firstNumber(record, ['change_abs', 'changeAbs', 'change_points', 'changePoints', 'points_change', 'change_amount', 'changeAmount', 'change']);
  return {
    code: providerString(firstString(record, ['code', 'index_code', 'indexCode', 'symbol', 'slug']), key),
    name: providerString(firstString(record, ['name', 'index_name', 'indexName', 'title']), key),
    value: indexQuoteValue(record),
    change: changeAbs,
    changePct: firstNumber(record, ['change_pct', 'changePct', 'changePercentage', 'change_percentage', 'percent_change', 'percentChange', 'change_percent']),
    changeAbs,
    updatedAt: parseDateTime(firstString(record, ['updated_at', 'updatedAt', 'currentDateTime', 'current_date_time', 'timestamp', 'as_of', 'asOf', 'date'])),
  };
}

function normalizeStock(record, key) {
  const changeAbs = firstNumber(record, ['change_abs', 'changeAbs', 'change_amount', 'changeAmount', 'price_change', 'priceChange', 'change', 'net_change', 'netChange']);
  return {
    ticker: providerString(firstString(record, ['ticker', 'symbol', 'code', 'stock_code', 'stockCode', 'canonical_symbol']), key),
    name: providerString(firstString(record, ['name', 'company_name', 'companyName', 'title']), key),
    sector: providerString(firstString(record, ['sector', 'sector_name', 'sectorName', 'industry']), key),
    price: stockQuoteValue(record),
    previousClose: firstNumber(record, ['previous_close', 'previousClose', 'prev_close', 'prevClose', 'previous_closing_price']),
    change: changeAbs,
    changePct: firstNumber(record, ['change_pct', 'changePct', 'changePercentage', 'change_percentage', 'percent_change', 'percentChange', 'change_percent']),
    volume: firstNumber(record, ['volume', 'shares_traded', 'sharesTraded', 'total_volume', 'totalVolume']),
    turnover: firstNumber(record, ['turnover', 'traded_value', 'tradedValue', 'total_value', 'totalValue', 'value']),
    marketCap: firstNumber(record, ['market_cap', 'marketCap', 'market_capitalisation', 'marketCapitalization', 'capitalisation']),
    updatedAt: parseDateTime(firstString(record, ['updated_at', 'updatedAt', 'currentDateTime', 'current_date_time', 'timestamp', 'as_of', 'asOf', 'date'])),
  };
}

function recordScore(record) {
  return Object.values(record).filter((value) => value !== null && value !== undefined).length;
}

function mergeQuote(primary, secondary) {
  const merged = { ...primary };
  for (const key of ['name', 'sector']) {
    if ((merged[key] === null || merged[key] === undefined || merged[key] === '') && secondary[key]) merged[key] = secondary[key];
  }
  return merged;
}

function dedupeRecords(records, identifier) {
  const unique = new Map();
  for (const record of records) {
    const id = record[identifier] || record.name;
    if (!id) continue;
    const key = String(id).toUpperCase();
    const existing = unique.get(key);
    if (!existing) { unique.set(key, record); continue; }
    const recordTime = Date.parse(record.updatedAt || '') || 0;
    const existingTime = Date.parse(existing.updatedAt || '') || 0;
    const preferRecord = recordTime > existingTime || (recordTime === existingTime && recordScore(record) > recordScore(existing));
    unique.set(key, preferRecord ? mergeQuote(record, existing) : mergeQuote(existing, record));
  }
  return [...unique.values()];
}

function sumActual(records, field) {
  const values = records.map((record) => record[field]).filter((value) => value !== null && value !== undefined);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function fieldCoverage(records, field) {
  return { known: records.filter((record) => record[field] !== null && record[field] !== undefined).length, total: records.length };
}

function percentageChange(stock) {
  if (stock.changePct !== null && stock.changePct !== undefined) return stock.changePct;
  if (stock.price !== null && stock.price !== undefined && stock.previousClose !== null && stock.previousClose !== undefined && stock.previousClose !== 0) {
    return (stock.price - stock.previousClose) / stock.previousClose * 100;
  }
  const absolute = stock.changeAbs ?? stock.change;
  if (stock.price !== null && stock.price !== undefined && absolute !== null && absolute !== undefined && stock.price - absolute !== 0) {
    return absolute / (stock.price - absolute) * 100;
  }
  return null;
}

function computeBreadth(stocks) {
  const known = stocks.filter((stock) => stock.change !== null || stock.changePct !== null);
  if (!known.length) return null;
  const direction = (stock) => {
    const value = stock.change ?? stock.changePct;
    return value > 0 ? 'advancing' : value < 0 ? 'declining' : 'unchanged';
  };
  return {
    total: stocks.length,
    advancing: known.filter((stock) => direction(stock) === 'advancing').length,
    declining: known.filter((stock) => direction(stock) === 'declining').length,
    unchanged: known.filter((stock) => direction(stock) === 'unchanged').length,
    unknown: stocks.length - known.length,
  };
}

function computeSectors(stocks) {
  const groups = new Map();
  for (const stock of stocks) {
    const sector = stock.sector || 'Unclassified';
    if (!groups.has(sector)) groups.set(sector, []);
    groups.get(sector).push(stock);
  }
  return [...groups.entries()].map(([sector, members]) => ({
    sector,
    stockCount: members.length,
    turnover: sumActual(members, 'turnover'),
    marketCap: sumActual(members, 'marketCap'),
    advancing: members.filter((stock) => (stock.change ?? stock.changePct) > 0).length,
    declining: members.filter((stock) => (stock.change ?? stock.changePct) < 0).length,
    unchanged: members.filter((stock) => (stock.change ?? stock.changePct) === 0).length,
  })).sort((left, right) => right.stockCount - left.stockCount || (right.turnover ?? -1) - (left.turnover ?? -1) || left.sector.localeCompare(right.sector));
}

function computeMarketSummary(stocks) {
  if (!stocks.length) return null;
  const ranked = stocks.filter((stock) => percentageChange(stock) !== null)
    .sort((left, right) => percentageChange(right) - percentageChange(left));
  const quote = (stock) => ({
    ticker: stock.ticker,
    name: stock.name,
    price: stock.price,
    change: stock.change,
    changeAbs: stock.changeAbs,
    changePct: percentageChange(stock),
  });
  return {
    stockCount: stocks.length,
    pricedCount: stocks.filter((stock) => stock.price !== null).length,
    totalVolume: sumActual(stocks, 'volume'),
    totalTurnover: sumActual(stocks, 'turnover'),
    totalMarketCap: sumActual(stocks, 'marketCap'),
    volumeCoverage: fieldCoverage(stocks, 'volume'),
    turnoverCoverage: fieldCoverage(stocks, 'turnover'),
    marketCapCoverage: fieldCoverage(stocks, 'marketCap'),
    topGainers: ranked.filter((stock) => percentageChange(stock) > 0).slice(0, 5).map(quote),
    topLosers: ranked.filter((stock) => percentageChange(stock) < 0).slice(-5).reverse().map(quote),
  };
}

function findNamedArray(payload, names) {
  let found = null;
  const normalizedNames = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const visit = (value) => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) && normalizedNames.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        found = child;
        return;
      }
      visit(child);
    }
  };
  visit(payload);
  return found;
}

function normalizeMovers(payload, key) {
  const explicitGainers = findNamedArray(payload, ['gainers', 'top_gainers', 'topGainers']);
  const explicitLosers = findNamedArray(payload, ['losers', 'top_losers', 'topLosers']);
  let gainers;
  let losers;
  if (explicitGainers || explicitLosers) {
    gainers = (explicitGainers || []).filter((record) => looksLikeRecord(record, 'stock')).map((record) => normalizeStock(record, key));
    losers = (explicitLosers || []).filter((record) => looksLikeRecord(record, 'stock')).map((record) => normalizeStock(record, key));
  } else {
    const stocks = extractRecords(payload, 'stock').map((record) => normalizeStock(record, key));
    gainers = stocks.filter((stock) => percentageChange(stock) !== null && percentageChange(stock) > 0)
      .sort((left, right) => percentageChange(right) - percentageChange(left));
    losers = stocks.filter((stock) => percentageChange(stock) !== null && percentageChange(stock) < 0)
      .sort((left, right) => percentageChange(left) - percentageChange(right));
  }
  return {
    gainers: dedupeRecords(gainers, 'ticker'),
    losers: dedupeRecords(losers, 'ticker'),
  };
}

function metadataObjects(payloads) {
  const objects = [];
  for (const payload of payloads) {
    const visit = (value, parentKey = '') => {
      if (!value || typeof value !== 'object') return;
      if (!parentKey || ['meta', 'metadata', 'marketmetadata', 'providerinfo'].includes(parentKey.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        objects.push(value);
      }
      for (const [key, child] of Object.entries(value)) visit(child, key);
    };
    visit(payload);
  }
  return objects;
}

function metadataString(objects, aliases, key) {
  for (const object of objects) {
    const value = providerString(firstString(object, aliases), key);
    if (value) return value;
  }
  return null;
}

function classifyProviderStatus(value) {
  const status = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (/(^|_)(live|real_time|realtime|open|immediate)($|_)/.test(status)) return 'live';
  if (/(^|_)(eod|end_of_day|endofday|daily|closed)($|_)/.test(status)) return 'end_of_day';
  if (status.includes('delay') || /minute|hour/.test(status)) return 'delayed';
  return null;
}

function providerStatus(objects) {
  const explicit = ['market_status', 'marketStatus', 'session_status', 'sessionStatus', 'trading_status', 'tradingStatus', 'market_state', 'marketState', 'status'];
  for (const object of objects) {
    const status = classifyProviderStatus(firstString(object, explicit));
    if (status) return status;
  }
  for (const object of objects) {
    const status = classifyProviderStatus(firstString(object, ['data_freshness', 'dataFreshness', 'freshness', 'delay']));
    if (status) return status;
  }
  return 'provider';
}

function providerMetadata(payloads, key, records) {
  const objects = metadataObjects(payloads);
  const metadataTimes = objects.flatMap((object) => {
    const value = firstString(object, ['updated_at', 'updatedAt', 'as_of', 'asOf', 'timestamp']);
    return [parseDateTime(value)];
  });
  const updatedAt = latestTimestamp([...metadataTimes, ...records.flatMap((record) => [record.updatedAt])]);
  return {
    name: 'Mansa API',
    url: 'https://mansaapi.com',
    source: metadataString(objects, ['source', 'provider', 'provider_name', 'providerName'], key),
    exchange: metadataString(objects, ['exchange', 'exchange_code', 'exchangeCode'], key) || 'NSE',
    currency: metadataString(objects, ['currency', 'currency_code', 'currencyCode'], key),
    dataFreshness: metadataString(objects, ['data_freshness', 'dataFreshness', 'freshness'], key),
    updatedAt,
  };
}

function normalizeHistoryPoint(point, key) {
  if (Array.isArray(point)) {
    const date = parseDateOnly(point[0]);
    const value = finiteNumber(point[1]);
    return date && value !== null && value > 0 ? { date, value, change: null, changePct: null } : null;
  }
  const rawDate = firstString(point, ['trade_date', 'tradeDate', 'date', 't', 'timestamp', 'time']);
  const date = parseDateOnly(rawDate) || parseDateTime(rawDate)?.slice(0, 10);
  const value = firstNumber(point, ['value', 'close', 'price', 'currentPrice', 'current_price', 'index_value', 'indexValue']);
  if (!date || value === null || value <= 0) return null;
  const changeAbs = firstNumber(point, ['change_abs', 'changeAbs', 'change_points', 'changePoints', 'change_amount', 'changeAmount', 'change']);
  return {
    date,
    value,
    change: changeAbs,
    changePct: firstNumber(point, ['change_pct', 'changePct', 'changePercentage', 'change_percentage', 'percent_change', 'percentChange']),
  };
}

function extractHistoryPoints(payload, key) {
  const points = [];
  walk(payload, (value) => {
    if (Array.isArray(value)) {
      for (const point of value) {
        const normalized = normalizeHistoryPoint(point, key);
        if (normalized) points.push(normalized);
      }
    } else {
      const normalized = normalizeHistoryPoint(value, key);
      if (normalized) points.push(normalized);
    }
  });
  const unique = new Map();
  for (const point of points.sort((left, right) => left.date.localeCompare(right.date))) unique.set(point.date, point);
  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function loadIndexHistory(index, key) {
  if (!index?.code) return {};
  const encodedCode = encodeURIComponent(index.code);
  const primaryPath = `/markets/exchanges/NSE/indices/${encodedCode}/history?range=1Y`;
  let payload;
  try {
    payload = await fetchProvider(primaryPath, key);
  } catch (error) {
    if (!(error instanceof ProviderRequestError) || error.status !== 404) throw error;
    const slug = encodeURIComponent(index.code.toLowerCase().replace(/\s+/g, '-'));
    payload = await fetchProvider(`/markets/indices/${slug}/history?range=1Y`, key);
  }
  const points = extractHistoryPoints(payload, key);
  return points.length ? { [index.code]: points } : {};
}

async function loadNse(key) {
  const results = await Promise.allSettled([
    fetchProvider('/markets/exchanges/NSE/indices', key),
    fetchProvider('/markets/exchanges/NSE/stocks?limit=200', key),
    fetchProvider('/markets/exchanges/NSE/movers?limit=20&type=both', key),
  ]);
  const errors = {};
  const payloads = [];
  const settleFeed = (name, result, normalize, emptyValue, hasValue, emptyReason) => {
    if (result.status === 'rejected') {
      errors[name] = safeReason(result.reason, key);
      return emptyValue;
    }
    payloads.push(result.value);
    try {
      const value = normalize(result.value);
      if (!hasValue(value)) errors[name] = emptyReason;
      return value;
    } catch (error) {
      errors[name] = safeReason(error, key);
      return emptyValue;
    }
  };

  const indices = settleFeed('indices', results[0], (payload) =>
    dedupeRecords(extractRecords(payload, 'index').map((record) => normalizeIndex(record, key)), 'code'),
  [], (value) => value.length > 0, 'Provider returned no usable NSE index quotes.');
  const stocks = settleFeed('stocks', results[1], (payload) =>
    dedupeRecords(extractRecords(payload, 'stock').map((record) => normalizeStock(record, key)), 'ticker'),
  [], (value) => value.length > 0, 'Provider returned no usable NSE stock quotes.');
  const movers = settleFeed('movers', results[2], (payload) => normalizeMovers(payload, key),
    { gainers: [], losers: [] }, (value) => value.gainers.length > 0 || value.losers.length > 0,
    'Provider returned no usable NSE mover quotes.');

  const preferredIndex = indices.find((index) => /NASI/i.test(index.code || '')) ||
    indices.find((index) => /NSE\s*20/i.test(index.code || '')) || indices[0];
  let history = {};
  if (preferredIndex) {
    try {
      history = await loadIndexHistory(preferredIndex, key);
      if (!Object.keys(history).length) errors.history = 'Provider returned no usable NSE index history.';
    } catch (error) {
      errors.history = safeReason(error, key);
    }
  }

  const hasMovers = movers.gainers.length > 0 || movers.losers.length > 0;
  if (!indices.length && !stocks.length && !hasMovers && !Object.keys(history).length) {
    throw new Error('Provider returned no usable NSE market data.');
  }
  const records = [...indices, ...stocks, ...movers.gainers, ...movers.losers];
  const fetchedAt = new Date().toISOString();
  const provider = providerMetadata(payloads, key, records);
  const freshness = providerStatus(metadataObjects(payloads));
  const partial = Object.keys(errors).length > 0;
  return {
    available: true,
    providerConfigured: true,
    status: partial ? 'partial' : freshness,
    providerStatus: freshness,
    partial,
    errors,
    updatedAt: provider.updatedAt,
    fetchedAt,
    indices,
    stocks,
    history,
    breadth: computeBreadth(stocks),
    sectors: computeSectors(stocks),
    marketSummary: computeMarketSummary(stocks),
    movers,
    provider,
    source: 'Mansa API',
    url: 'https://mansaapi.com',
  };
}

async function getNseData() {
  const key = typeof process.env.MANSA_API_KEY === 'string' ? process.env.MANSA_API_KEY.trim() : '';
  if (!key) return unconfiguredNse();
  return getCachedSection('nse', () => loadNse(key), (error) => failedNse(error, key));
}

function buildFixedIncome(bills, cbr, inflation) {
  const sections = [bills, cbr, inflation];
  const available = sections.some((section) => section.available);
  const stale = sections.some((section) => section.stale);
  return {
    available,
    partial: available && sections.some((section) => !section.available || section.partial || section.stale),
    status: bills.available ? 'on_offer' : available ? 'official' : 'unavailable',
    asOf: latestTimestamp(sections.map((section) => section.asOf)),
    updatedAt: latestTimestamp(sections.map((section) => section.updatedAt)),
    fetchedAt: latestTimestamp(sections.map((section) => section.fetchedAt)),
    treasuryBills: bills.treasuryBills,
    treasuryBillsMeta: {
      available: bills.available,
      status: bills.status,
      asOf: bills.asOf,
      asOfBasis: bills.asOfBasis,
      updatedAt: bills.updatedAt,
      fetchedAt: bills.fetchedAt,
      auctionPeriod: bills.auctionPeriod,
      source: bills.source,
      url: bills.url,
      ...(bills.stale ? { stale: true } : {}),
      ...(bills.reason ? { reason: bills.reason } : {}),
    },
    centralBankRate: cbr,
    inflation,
    source: CBK_SOURCE,
    ...(stale ? { stale: true } : {}),
    ...(!available ? { reason: sections.find((section) => section.reason)?.reason || 'CBK fixed-income data is unavailable.' } : {}),
  };
}

async function getMarketData() {
  const results = await Promise.allSettled([
    getNseData(),
    getForexData(),
    getCachedSection('bills', loadTreasuryBills, billsUnavailable),
    getCachedSection('cbr', loadCentralBankRate, cbrUnavailable),
    getCachedSection('inflation', loadInflation, inflationUnavailable),
  ]);
  const value = (result, fallback) => result.status === 'fulfilled' ? result.value : fallback(result.reason);
  const nse = value(results[0], () => failedNse(new Error('NSE adapter failed.')));
  const forex = value(results[1], forexUnavailable);
  const bills = value(results[2], billsUnavailable);
  const cbr = value(results[3], cbrUnavailable);
  const inflation = value(results[4], inflationUnavailable);
  const fixedIncome = buildFixedIncome(bills, cbr, inflation);
  const sections = [nse, forex, fixedIncome];
  const available = sections.some((section) => section.available);
  return {
    generatedAt: new Date().toISOString(),
    available,
    partial: available && sections.some((section) => !section.available || section.partial || section.stale),
    nse,
    forex,
    fixedIncome,
    officialSources: OFFICIAL_SOURCES.map((source) => ({ ...source })),
  };
}

module.exports = {
  getMarketData,
  getForexData,
};
