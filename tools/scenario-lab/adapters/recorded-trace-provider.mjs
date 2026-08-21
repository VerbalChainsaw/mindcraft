import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  fingerprintVarianceValue,
  recordedTraceModelName,
  requestCompletionCase,
} from '../variance-cases.mjs';

const LOOPBACK_HOST = '127.0.0.1';

function parseOptions(argv) {
  if (argv.length % 2 !== 0) throw new Error('Arguments must be flag/value pairs.');
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--case', '--ready-file', '--evidence-file'].includes(flag) || Object.hasOwn(options, flag)) {
      throw new Error(`Unsupported or repeated option: ${flag}`);
    }
    options[flag] = String(argv[index + 1] || '');
  }
  for (const required of ['--case', '--ready-file', '--evidence-file']) {
    if (!options[required]) throw new Error(`${required} is required.`);
  }
  return options;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function modelInputFromCompatibleRequest(body) {
  const supplied = Array.isArray(body?.messages) ? body.messages : [];
  const [system, ...messages] = supplied;
  if (system?.role !== 'system' || typeof system?.content !== 'string') {
    throw new Error('The compatible request did not begin with one system prompt.');
  }
  return {
    messages,
    prompt: system.content,
  };
}

function latestUserText(messages) {
  return [...messages]
    .reverse()
    .find(message => message?.role === 'user' && typeof message?.content === 'string')
    ?.content || '';
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function requestSizeEvidence(body, input, recordedResponse) {
  return {
    compatibleBodyUtf8Bytes: utf8Bytes(JSON.stringify(body)),
    systemPromptUtf8Bytes: utf8Bytes(input.prompt),
    conversationContentUtf8Bytes: input.messages.reduce(
      (total, message) => total + utf8Bytes(message?.content),
      0,
    ),
    conversationMessageCount: input.messages.length,
    recordedResponseUtf8Bytes: utf8Bytes(recordedResponse),
  };
}

export async function startRecordedTraceProvider({ varianceCase, readyFile, evidenceFile }) {
  const model = recordedTraceModelName(varianceCase);
  const evidence = {
    schemaVersion: 'scenario-lab.recorded-trace-provider.v1',
    caseId: varianceCase.id,
    driverFingerprint: varianceCase.recordedTraceFingerprint,
    expectedResponseFingerprint: varianceCase.recordedResponseFingerprint,
    endpoint: null,
    requests: [],
    complete: false,
  };
  const persistEvidence = () => writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${LOOPBACK_HOST}`);
      if (request.method === 'GET' && requestUrl.pathname === '/v1/models') {
        sendJson(response, 200, { object: 'list', data: [{ id: model, object: 'model' }] });
        return;
      }
      if (request.method !== 'POST' || requestUrl.pathname !== '/v1/chat/completions') {
        sendJson(response, 404, { error: { message: 'Recorded provider endpoint not found.' } });
        return;
      }

      const body = await readJsonBody(request);
      const input = modelInputFromCompatibleRequest(body);
      const observedUserText = latestUserText(input.messages);
      const record = {
        receivedAt: Date.now(),
        requestedModel: body?.model || null,
        inputFingerprint: fingerprintVarianceValue(input),
        responseFingerprint: varianceCase.recordedResponseFingerprint,
        requestSize: requestSizeEvidence(body, input, varianceCase.recordedResponse),
        matchedCaseRequest: observedUserText.includes(varianceCase.request),
        accepted: false,
      };
      evidence.requests.push(record);

      if (evidence.requests.length !== 1) {
        await persistEvidence();
        sendJson(response, 409, { error: { message: 'Recorded trace permits exactly one conversation generation.' } });
        return;
      }
      if (record.requestedModel !== model || record.matchedCaseRequest !== true) {
        await persistEvidence();
        sendJson(response, 422, { error: { message: 'Request does not match the declared recorded trace.' } });
        return;
      }

      record.accepted = true;
      evidence.complete = true;
      await persistEvidence();
      sendJson(response, 200, {
        id: `recorded-${varianceCase.id}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: varianceCase.recordedResponse },
        }],
      });
    } catch (error) {
      evidence.complete = false;
      evidence.error = String(error?.message || error);
      await persistEvidence().catch(() => {});
      if (!response.headersSent) sendJson(response, 400, { error: { message: evidence.error } });
      else response.destroy(error);
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, resolvePromise);
  });
  const address = server.address();
  evidence.endpoint = { host: LOOPBACK_HOST, port: address.port, baseUrl: `http://${LOOPBACK_HOST}:${address.port}/v1` };
  await persistEvidence();
  await writeFile(readyFile, `${JSON.stringify({
    schemaVersion: 'scenario-lab.recorded-trace-provider-ready.v1',
    caseId: varianceCase.id,
    driverFingerprint: varianceCase.recordedTraceFingerprint,
    model,
    ...evidence.endpoint,
  }, null, 2)}\n`, 'utf8');
  return { server, evidence };
}

async function main(argv) {
  const options = parseOptions(argv);
  const varianceCase = requestCompletionCase(options['--case']);
  const { server } = await startRecordedTraceProvider({
    varianceCase,
    readyFile: options['--ready-file'],
    evidenceFile: options['--evidence-file'],
  });
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exitCode = 1;
  });
}
