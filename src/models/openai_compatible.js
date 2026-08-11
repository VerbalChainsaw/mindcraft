import OpenAIApi from 'openai';
import { strictFormat } from '../utils/text.js';
import { getKey } from '../utils/keys.js';
import { isCancellation, ModelCancelledError, PendingRequests } from './cancellation.js';

export const OPENAI_COMPATIBLE_API_KEY_ENVS = Object.freeze([
    'OPENAI_COMPATIBLE_API_KEY',
    'NVIDIA_API_KEY',
    'TOGETHER_API_KEY',
    'FIREWORKS_API_KEY',
    'DEEPINFRA_API_KEY',
]);

export const DEFAULT_OPENAI_COMPATIBLE_API_KEY_ENV = OPENAI_COMPATIBLE_API_KEY_ENVS[0];

const openAICompatibleApiKeyEnvSet = new Set(OPENAI_COMPATIBLE_API_KEY_ENVS);

export function isValidOpenAICompatibleApiKeyEnv(value) {
    return typeof value === 'string' && openAICompatibleApiKeyEnvSet.has(value);
}

export class OpenAICompatible {
    static prefix = 'openai_compatible';
    constructor(model_name, url, params, {
        readKey = getKey,
        createClient = (config) => new OpenAIApi(config),
    } = {}) {
        if (typeof url !== 'string' || url.trim().length === 0) {
            throw new Error('openai_compatible requires an explicit non-empty URL.');
        }
        const requestParams = params && typeof params === 'object' && !Array.isArray(params)
            ? { ...params }
            : {};
        const apiKeyEnv = Object.hasOwn(requestParams, 'api_key_env')
            ? requestParams.api_key_env
            : DEFAULT_OPENAI_COMPATIBLE_API_KEY_ENV;
        if (!isValidOpenAICompatibleApiKeyEnv(apiKeyEnv)) {
            throw new Error('Invalid openai_compatible api_key_env.');
        }
        delete requestParams.api_key_env;

        // A request `timeout` is a client option, not an API body field. Spread
        // into the completion body it is silently ignored, so a stalled stream
        // parked the whole turn loop for the SDK's 10 minute default and the
        // failure-backoff path never fired -- the bot just went quiet. Lift it
        // onto the client exactly as gpt.js does.
        const { timeout, timeout_seconds, ...bodyParams } = requestParams;
        const timeoutSeconds = Number(timeout ?? timeout_seconds);

        this.model_name = model_name;
        this.params = bodyParams;
        this.apiKeyEnv = apiKeyEnv;
        const config = {
            baseURL: url.trim(),
            apiKey: readKey(apiKeyEnv),
        };
        if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)
            config.timeout = Math.round(timeoutSeconds * 1000);
        this.openai = createClient(config);
        this._pending = new PendingRequests();
    }

    cancelPending() {
        return this._pending.cancelAll();
    }

    async sendRequest(turns, systemMessage, stop_seq = '***') {
        let messages = [{ role: 'system', content: systemMessage }].concat(turns);
        let model = this.model_name || 'gpt-3.5-turbo';

        if (model.includes('deepseek') || model.includes('qwen')) {
            messages = strictFormat(messages);
        }

        const pack = {
            model,
            messages,
            stop: stop_seq,
            ...(this.params || {}),
        };

        let res = null;
        const controller = this._pending.begin();
        try {
            console.log('Awaiting openai_compatible api response...');
            let completion = await this.openai.chat.completions.create(pack, { signal: controller.signal });
            if (completion.choices[0].finish_reason === 'length')
                throw new Error('Context length exceeded');
            console.log('Received.');
            res = completion.choices[0].message.content;
        } catch (err) {
            // Cancellation must throw, not return the failure sentinel, or the
            // router would treat a deliberate stop as a dead provider and
            // restart the generation elsewhere.
            if (isCancellation(err)) throw new ModelCancelledError();
            if ((err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        } finally {
            this._pending.end(controller);
        }
        return res;
    }

    sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: 'user',
            content: [
                { type: 'text', text: systemMessage },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` },
                },
            ],
        });
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        if (text.length > 8191)
            text = text.slice(0, 8191);
        const embedding = await this.openai.embeddings.create({
            model: this.model_name || 'text-embedding-3-small',
            input: text,
            encoding_format: 'float',
            ...this.params,
        });
        return embedding.data[0].embedding;
    }
}
