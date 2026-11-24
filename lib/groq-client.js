const https = require('https');

const FALLBACK_MODELS = [
  'gemma2-9b-it',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
  'qwen-2.5-32b',
  'qwen-2.5-7b',
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
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: data });
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
        .filter(m => m.id && (m.id.includes('chat') || m.id.includes('instruct') || m.id.includes('versatile') || m.id.includes('it')))
        .map(m => m.id);
    }
  } catch (err) {
    console.warn('[cleo] Failed to fetch models from API:', err.message);
  }
  return [];
}

async function discoverBestModel(apiKey, preferredModel = null) {
  if (modelCache) return modelCache;
  
  const modelsToTest = [];
  
  if (preferredModel) modelsToTest.push(preferredModel);
  
  const dynamicModels = await fetchAvailableModels(apiKey);
  for (const m of dynamicModels) {
    if (!modelsToTest.includes(m)) modelsToTest.push(m);
  }
  
  for (const m of FALLBACK_MODELS) {
    if (!modelsToTest.includes(m)) modelsToTest.push(m);
  }
  
  console.log(`[cleo] Testing ${modelsToTest.length} models...`);
  
  for (const model of modelsToTest) {
    const test = await groqRequest('/openai/v1/chat/completions', {
      model,
      messages: [{ role: 'user', content: 'test' }],
      max_completion_tokens: 5
    }, apiKey);
    console.log(`[cleo] Model test ${model}: status ${test.status}`);
    if (test.status === 200) {
      console.log(`[cleo] Selected working model: ${model}`);
      modelCache = model;
      return model;
    }
    if (test.status === 401) {
      throw new Error('Invalid API Key');
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

async function chatCompletion(apiKey, messages, options = {}) {
  const model = await discoverBestModel(apiKey, options.model);
  
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_completion_tokens: options.maxTokens ?? 1500,
    ...(options.responseFormat && { response_format: options.responseFormat }),
  };
  
  const result = await groqRequest('/openai/v1/chat/completions', body, apiKey);
  
  if (result.status !== 200) {
    const err = result.data?.error?.message || `HTTP ${result.status}`;
    // If model is decommissioned, reset cache and retry once
    if (result.status === 400 && err.includes('decommissioned')) {
      console.warn('[cleo] Model decommissioned, resetting cache and retrying...');
      resetModelCache();
      const newModel = await discoverBestModel(apiKey, options.model);
      body.model = newModel;
      const retryResult = await groqRequest('/openai/v1/chat/completions', body, apiKey);
      if (retryResult.status !== 200) {
        const retryErr = retryResult.data?.error?.message || `HTTP ${retryResult.status}`;
        throw new Error(`Groq ${retryResult.status}: ${retryErr}`);
      }
      return retryResult.data.choices?.[0]?.message?.content || '';
    }
    throw new Error(`Groq ${result.status}: ${err}`);
  }
  
  return result.data.choices?.[0]?.message?.content || '';
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