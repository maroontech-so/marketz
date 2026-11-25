const {
  chatCompletion: groqChatCompletion,
  getSelectedModel: getSelectedGroqModel,
} = require('./groq-client');

function createProviderError(message, code = 'AI_PROVIDER_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function completeCleoChat(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw createProviderError('Groq is not configured', 'AI_NOT_CONFIGURED');
  }

  const answer = await groqChatCompletion(apiKey, messages, {
    temperature: options.temperature ?? 0.2,
    maxTokens: Math.min(options.maxTokens || 1500, 1800),
    model: process.env.GROQ_MODEL,
  });

  if (typeof answer !== 'string' || !answer.trim()) {
    throw createProviderError('Groq returned an empty response');
  }

  return {
    answer: answer.trim(),
    model: getSelectedGroqModel() || process.env.GROQ_MODEL || 'auto',
    provider: 'groq',
  };
}

function getCleoStatus() {
  const configured = Boolean(process.env.GROQ_API_KEY);

  return {
    configured,
    provider: configured ? 'groq' : null,
    model: getSelectedGroqModel() || process.env.GROQ_MODEL || 'auto',
  };
}

module.exports = {
  completeCleoChat,
  getCleoStatus,
};
