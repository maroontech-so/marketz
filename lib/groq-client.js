const https = require('https');

const KNOWN_MODELS = [
  { id: 'gemma2-9b-it', type: 'chat', speed: 'fast', quality: 'good', context: 8192 },
  { id: 'llama-3.3-70b-versatile', type: 'chat', speed: 'medium', quality: 'excellent', context: 128000 },
  { id: 'llama-3.1-8b-instant', type: 'chat', speed: 'fast', quality: 'good', context: 128000 },
  { id: 'llama-3.1-70b-versatile', type: 'chat', speed: 'medium', quality: 'excellent', context: 128000 },
  { id: 'mixtral-8x7b-32768', type: 'chat', speed: 'medium', quality: 'very_good', context: 32768 },
  { id: 'qwen-2.5-32b', type: 'chat', speed: 'medium', quality: 'very_good', context: 32768 },
  { id: 'qwen-2.5-7b', type: 'chat', speed: 'fast', quality: 'good', context: 32768 },
];

let selectedModel = null;
let modelCache = null;

function groqRequest(path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'api.groq.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
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
    req.write(postData);
    req.end();
  });
}

async function discoverBestModel(apiKey, preferredModel = null) {
  if (modelCache) return modelCache;
  
  if (preferredModel) {
    const test = await groqRequest('/openai/v1/chat/completions', {
      model: preferredModel,
      messages: [{ role: 'user', content: 'test' }],
      max_completion_tokens: 5
    }, apiKey);
    if (test.status === 200) {
      modelCache = preferredModel;
      return preferredModel;
    }
  }

  for (const model of KNOWN_MODELS) {
    const test = await groqRequest('/openai/v1/chat/completions', {
      model: model.id,
      messages: [{ role: 'user', content: 'test' }],
      max_completion_tokens: 5
    }, apiKey);
    if (test.status === 200) {
      console.log(`[cleo] Discovered working model: ${model.id}`);
      modelCache = model.id;
      return model.id;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.warn('[cleo] No working model found, using fallback');
  modelCache = KNOWN_MODELS[0].id;
  return KNOWN_MODELS[0].id;
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
    throw new Error(`Groq ${result.status}: ${err}`);
  }
  
  return result.data.choices?.[0]?.message?.content || '';
}

async function embeddingCompletion(apiKey, text) {
  // Groq doesn't reliably support embeddings API, use fallback
  return fallbackEmbedding(text);
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

function getSelectedModel() {
  return modelCache;
}

function resetModelCache() {
  modelCache = null;
  selectedModel = null;
}

module.exports = {
  chatCompletion,
  embeddingCompletion,
  discoverBestModel,
  fallbackEmbedding,
  getSelectedModel,
  resetModelCache,
  KNOWN_MODELS,
};