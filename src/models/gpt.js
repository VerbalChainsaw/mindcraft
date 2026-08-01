import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

// The o-series reasoning models (o1, o3, o4...) are the only ones that need the
// Responses API. Everything else -- gpt-4o, gpt-4.1, gpt-5* -- is faster and
// more reliable on chat.completions.
function usesResponsesApi(model) {
    return /^o[0-9]/i.test(String(model || ''));
}

export class GPT {
    static prefix = 'openai';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.url = url; // store so that we know whether a custom URL has been set

        // A request `timeout` is a client option, not an API body field. It was
        // being spread into the completion body, where OpenAI rejects it -- which
        // is one way a call fails and the bot reports "my brain disconnected".
        // Lift it onto the client and keep only real generation params for the body.
        const { timeout, timeout_seconds, ...bodyParams } = params || {};
        this.params = bodyParams;
        const timeoutSeconds = Number(timeout ?? timeout_seconds);

        let config = {};
        if (url)
            config.baseURL = url;

        if (hasKey('OPENAI_ORG_ID'))
            config.organization = getKey('OPENAI_ORG_ID');

        config.apiKey = getKey('OPENAI_API_KEY');

        if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)
            config.timeout = Math.round(timeoutSeconds * 1000);

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='***') {
        let messages = strictFormat(turns);
        messages = messages.map(message => {
            message.content += stop_seq;
            return message;
        });
        let model = this.model_name || "gpt-5.4-mini";

        let res = null;

        try {
            console.log('Awaiting openai api response from model', model);
            // Use chat.completions for a custom endpoint and for every standard
            // chat model. The Responses API is only needed by the o-series
            // reasoning models; for gpt-4o and friends it was both slower and
            // intermittently returned no text, which reached players as "my
            // brain disconnected". Chat completions is the fast, reliable path.
            if (this.url || !usesResponsesApi(model)) {
                let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);
                messages = strictFormat(messages);
                const pack = {
                    model: model,
                    messages,
                    stop: stop_seq,
                    ...(this.params || {})
                };
                if (model.includes('o1') || model.includes('o3') || model.includes('5')) {
                    delete pack.stop;
                }
                let completion = await this.openai.chat.completions.create(pack);
                if (completion.choices[0].finish_reason == 'length')
                    throw new Error('Context length exceeded'); 
                console.log('Received.');
                res = completion.choices[0].message.content;
            } 
            // otherwise, use responses
            else {
                let messages = strictFormat(turns);
                messages = messages.map(message => {
                    message.content += stop_seq;
                    return message;
                });
                const response = await this.openai.responses.create({
                    model: model,
                    instructions: systemMessage,
                    input: messages,
                    ...(this.params || {})
                });
                console.log('Received.');
                res = response.output_text;
                let stop_seq_index = res.indexOf(stop_seq);
                res = stop_seq_index !== -1 ? res.slice(0, stop_seq_index) : res;
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            } else if (err.message.includes('image_url')) {
                console.log(err);
                res = 'Vision is only supported by certain models.';
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "input_text", text: systemMessage },
                {
                    type: "input_image",
                    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        if (text.length > 8191)
            text = text.slice(0, 8191);
        const embedding = await this.openai.embeddings.create({
            model: this.model_name || "text-embedding-3-small",
            input: text,
            encoding_format: "float",
        });
        return embedding.data[0].embedding;
    }

}

const sendAudioRequest = async (text, model, voice, url) => {
    const payload = {
        model: model,
        voice: voice,
        input: text
    }

    let config = {};

    if (url)
        config.baseURL = url;

    if (hasKey('OPENAI_ORG_ID'))
        config.organization = getKey('OPENAI_ORG_ID');

    config.apiKey = getKey('OPENAI_API_KEY');

    const openai = new OpenAIApi(config);

    const mp3 = await openai.audio.speech.create(payload);
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const base64 = buffer.toString("base64");
    return base64;
}

export const TTSConfig = {
    sendAudioRequest: sendAudioRequest,
    baseUrl: 'https://api.openai.com/v1',
}
