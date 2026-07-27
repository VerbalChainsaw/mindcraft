import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    DEFAULT_OPENAI_COMPATIBLE_API_KEY_ENV,
    isValidOpenAICompatibleApiKeyEnv,
} from './openai_compatible.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically discover model classes in this directory.
// Each model class must export a static `prefix` string.
const apiMap = await (async () => {
    const map = {};
    const files = (await fs.readdir(__dirname))
        .filter(f => f.endsWith('.js') && f !== '_model_map.js' && f !== 'prompter.js');
    for (const file of files) {
        try {
            const moduleUrl = pathToFileURL(path.join(__dirname, file)).href;
            const mod = await import(moduleUrl);
            for (const exported of Object.values(mod)) {
                if (typeof exported === 'function' && Object.prototype.hasOwnProperty.call(exported, 'prefix')) {
                    const prefix = exported.prefix;
                    if (typeof prefix === 'string' && prefix.length > 0) {
                        map[prefix] = exported;
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load model module:', file, e?.message || e);
        }
    }
    return map;
})();

const credentialAlternativesByProvider = {
    anthropic: ['ANTHROPIC_API_KEY'],
    azure: ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    cerebras: ['CEREBRAS_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    glhf: ['GHLF_API_KEY'],
    google: ['GEMINI_API_KEY'],
    groq: ['GROQCLOUD_API_KEY'],
    huggingface: ['HUGGINGFACE_API_KEY'],
    hyperbolic: ['HYPERBOLIC_API_KEY'],
    lmstudio: [],
    mercury: ['MERCURY_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
    novita: ['NOVITA_API_KEY'],
    ollama: [],
    openai: ['OPENAI_API_KEY'],
    openai_compatible: [],
    openrouter: ['OPENROUTER_API_KEY'],
    qwen: ['QWEN_API_KEY'],
    replicate: ['REPLICATE_API_KEY'],
    vllm: [],
    xai: ['XAI_API_KEY'],
};

export function selectAPI(profile) {
    if (typeof profile === 'string' || profile instanceof String) {
        profile = {model: profile};
    }
    // backwards compatibility with local->ollama
    if (profile.api?.includes('local') || profile.model?.includes('local')) {
        profile.api = 'ollama';
        if (profile.model) {
            profile.model = profile.model.replace('local', 'ollama');
        }
    }
    if (!profile.api) {
        const api = Object.keys(apiMap).find(key => profile.model?.startsWith(key));
        if (api) {
            profile.api = api;
        }
        else {
            // check for some common models that do not require prefixes
            if (profile.model.includes('gpt') || profile.model.includes('o1')|| profile.model.includes('o3'))
                profile.api = 'openai';
            else if (profile.model.includes('claude'))
                profile.api = 'anthropic';
            else if (profile.model.includes('gemini'))
                profile.api = "google";
            else if (profile.model.includes('grok'))
                profile.api = 'xai';
            else if (profile.model.includes('mistral'))
                profile.api = 'mistral';
            else if (profile.model.includes('deepseek'))
                profile.api = 'deepseek';
            else if (profile.model.includes('qwen'))
                profile.api = 'qwen';
        }
        if (!profile.api) {
            throw new Error('Unknown model:', profile.model);
        }
    }
    if (!apiMap[profile.api]) {
        throw new Error('Unknown api:', profile.api);
    }
    let model_name = profile.model.replace(profile.api + '/', ''); // remove prefix
    profile.model = model_name === "" ? null : model_name; // if model is empty, set to null
    return profile;
}

export function describeModelProvider(profile) {
    try {
        const clonedProfile = typeof profile === 'string' || profile instanceof String
            ? String(profile)
            : JSON.parse(JSON.stringify(profile));
        const resolvedProfile = selectAPI(clonedProfile);
        if (resolvedProfile.api === 'openai_compatible') {
            if (typeof resolvedProfile.url !== 'string' || resolvedProfile.url.trim().length === 0) {
                return {
                    ok: false,
                    provider: 'openai_compatible',
                    credentialAlternatives: [],
                    error: 'openai_compatible requires an explicit non-empty URL.',
                };
            }
            const params = resolvedProfile.params;
            const apiKeyEnv = params && Object.hasOwn(params, 'api_key_env')
                ? params.api_key_env
                : DEFAULT_OPENAI_COMPATIBLE_API_KEY_ENV;
            if (!isValidOpenAICompatibleApiKeyEnv(apiKeyEnv)) {
                return {
                    ok: false,
                    provider: 'openai_compatible',
                    credentialAlternatives: [],
                    error: 'Invalid openai_compatible api_key_env.',
                };
            }
            return {
                ok: true,
                provider: 'openai_compatible',
                credentialAlternatives: [apiKeyEnv],
            };
        }
        const credentialAlternatives = credentialAlternativesByProvider[resolvedProfile.api];
        if (!credentialAlternatives) {
            return {
                ok: false,
                provider: resolvedProfile.api || null,
                credentialAlternatives: [],
                error: 'Unsupported model provider.',
            };
        }
        return {
            ok: true,
            provider: resolvedProfile.api,
            credentialAlternatives: [...credentialAlternatives],
        };
    } catch {
        return {
            ok: false,
            provider: null,
            credentialAlternatives: [],
            error: 'Unsupported model provider.',
        };
    }
}

export function createModel(profile) {
    if (apiMap[profile.model]) {
        // if the model value is an api (instead of a specific model name)
        // then set model to null so it uses the default model for that api
        profile.model = null;
    }
    if (!apiMap[profile.api]) {
        throw new Error('Unknown api:', profile.api);
    }
    const model = new apiMap[profile.api](profile.model, profile.url, profile.params);
    return model;
}
