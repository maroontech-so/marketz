const https = require('https');

const FALLBACK_MODELS = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'allam-2-7b',
];

let modelCache = null;

function groqRequest(path, body, apiKey, method = 'POST') {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.groq.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(postData && { 'Content-Length': Buffer.byteLength(postData) })
      },
      timeout: 30000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function fetchAvailableModels(apiKey) {
  try {
    const result = await groqRequest('/openai/v1/models', null, apiKey, 'GET');
    if (result.status === 200 && result.data?.data) {
      return result.data.data
        .filter(m => m.id)
        .map(m => m.id);
    }
  } catch (err) {
    console.warn('[cleo] Failed to fetch models from API:', err.message);
  }
  return [];
}

async function discoverBestModel(apiKey, preferredModel = null) {
  if (modelCache) return modelCache;
  if (preferredModel) {
    modelCache = preferredModel;
    return preferredModel;
  }

  const modelsToTest = [];

  for (const m of FALLBACK_MODELS) {
    if (!modelsToTest.includes(m)) modelsToTest.push(m);
  }

  const dynamicModels = await fetchAvailableModels(apiKey);
  for (const m of dynamicModels) {
    if (!modelsToTest.includes(m)) modelsToTest.push(m);
  }
  
  console.log(`[cleo] Testing ${modelsToTest.length} models...`);
  
  for (const model of modelsToTest) {
    let test;
    try {
      test = await groqRequest('/openai/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: 'test' }],
        max_completion_tokens: 5
      }, apiKey);
    } catch (err) {
      console.warn(`[cleo] Model test ${model} failed: ${err.message}`);
      continue;
    }
    console.log(`[cleo] Model test ${model}: status ${test.status}`);
    if (test.status === 200) {
      console.log(`[cleo] Selected working model: ${model}`);
      modelCache = model;
      return model;
    }
    if (test.status === 401) {
      throw new Error('Invalid API Key');
    }
    if (test.status === 429 && /tokens per day|\bTPD\b/i.test(test.data?.error?.message || '')) {
      throw new Error('Groq daily token limit reached');
    }
    if (test.status === 400 && test.data?.error?.message?.includes('decommissioned')) {
      console.log(`[cleo] Model ${model} decommissioned, skipping`);
      continue;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`[cleo] No working model found`);
  throw new Error('No working model available');
}

function getRetryDelayMs(result, attempt) {
  const retryAfter = result.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : new Date(retryAfter).getTime() - Date.now();
    if (delay > 0) return Math.min(delay, 30_000);
  }

  const messageDelay = result.data?.error?.message?.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  if (messageDelay) {
    const delay = (Number(messageDelay[1] || 0) * 60 + Number(messageDelay[2])) * 1000;
    if (delay > 0) return Math.min(delay, 30_000);
  }
  return Math.min(1000 * Math.pow(2, attempt), 8000);
}

async function groqChatWithRetry(apiKey, body, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let result;
    try {
      result = await groqRequest('/openai/v1/chat/completions', body, apiKey);
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      console.log(`[groq] retry ${attempt + 1}/${maxAttempts} in ${delay}ms (${err.message})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    const retryable = result.status === 429 || result.status >= 500;
    const dailyLimit = /tokens per day|\bTPD\b/i.test(result.data?.error?.message || '');
    if (!retryable || dailyLimit || attempt === maxAttempts - 1) return result;

    const delay = getRetryDelayMs(result, attempt);
    console.log(`[groq] retry ${attempt + 1}/${maxAttempts} in ${Math.round(delay)}ms (status ${result.status})`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

function canTryNextModel(result) {
  if (result.status === 200 || result.status === 404 || result.status === 413 || result.status === 429) return true;
  const message = result.data?.error?.message || '';
  return result.status === 400 && /decommissioned|does not exist|not found|not available|unsupported model/i.test(message);
}

async function chatCompletion(apiKey, messages, options = {}) {
  const initialModel = await discoverBestModel(apiKey, options.model || process.env.GROQ_MODEL);
  const models = [...new Set([initialModel, ...FALLBACK_MODELS])];
  let lastError = 'Groq request failed';

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_completion_tokens: options.maxTokens ?? 1500,
      ...(options.responseFormat && { response_format: options.responseFormat }),
    };

    const result = await groqChatWithRetry(apiKey, body);
    const answer = result.data?.choices?.[0]?.message?.content;
    const dailyLimit = /tokens per day|\bTPD\b/i.test(result.data?.error?.message || '');

    if (result.status === 200 && typeof answer === 'string' && answer.trim()) {
      modelCache = model;
      return answer;
    }

    lastError = result.status === 200
      ? 'Groq returned an empty response'
      : `Groq ${result.status}: ${result.data?.error?.message || `HTTP ${result.status}`}`;

    if (index === models.length - 1 || dailyLimit || !canTryNextModel(result)) {
      modelCache = null;
      throw new Error(lastError);
    }

    console.warn(`[groq] ${model} unavailable (${lastError}); trying ${models[index + 1]}`);
  }

  modelCache = null;
  throw new Error(lastError);
}

function getSelectedModel() {
  return modelCache;
}

function resetModelCache() {
  modelCache = null;
}

function fallbackEmbedding(text) {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const dim = 384;
  const vec = new Float32Array(dim);
  for (const w of words) {
    let hash = 0;
    for (let i = 0; i < w.length; i++) {
      hash = ((hash << 5) - hash) + w.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return Array.from(vec);
}

module.exports = {
  chatCompletion,
  discoverBestModel,
  getSelectedModel,
  resetModelCache,
  fallbackEmbedding,
};