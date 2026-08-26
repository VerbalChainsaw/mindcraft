import { OpenAICompatible } from './openai_compatible.js';

export class DeepSeek extends OpenAICompatible {
    static prefix = 'deepseek';
    constructor(model_name, url, params, runtime = {}) {
        super(
            model_name || 'deepseek-v4-flash',
            url || 'https://api.deepseek.com',
            params,
            {
                ...runtime,
                defaultApiKeyEnv: 'DEEPSEEK_API_KEY',
                validateApiKeyEnv: (value) => value === 'DEEPSEEK_API_KEY',
                providerName: 'deepseek',
            },
        );
    }

    embed() {
        return Promise.reject(new Error('Embeddings are not supported by Deepseek.'));
    }
}

