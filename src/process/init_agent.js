import { Agent } from '../agent/agent.js';
import { serverProxy } from '../agent/mindserver_proxy.js';
import yargs from 'yargs';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node init_agent.js -n <agent_name> -p <port> -l <load_memory> -m <init_message> -c <count_id>');
    process.exit(1);
}

const argv = yargs(args)
    .option('name', {
        alias: 'n',
        type: 'string',
        description: 'name of agent'
    })
    .option('load_memory', {
        alias: 'l',
        type: 'boolean',
        description: 'load agent memory from file on startup'
    })
    .option('init_message', {
        alias: 'm',
        type: 'string',
        description: 'automatically prompt the agent on startup'
    })
    .option('count_id', {
        alias: 'c',
        type: 'number',
        default: 0,
        description: 'identifying count for multi-agent scenarios',
    })
    .option('port', {
        alias: 'p',
        type: 'number',
        description: 'port of mindserver'
    })
    .argv;

// The launcher stops an agent by sending SIGINT (agent_process.js:203, :243)
// and reads exit code 0 or signal SIGINT as a graceful stop (:386). With no
// handler installed, Node's default terminated this child immediately, so the
// parent reported a clean "stopped" for what was actually an uncontrolled kill:
// the in-flight Mineflayer action was never cancelled, the exit chat line never
// sent, and the prompter was never disposed. Translate one OS stop signal into
// one bounded agent teardown; the launcher still owns escalation if it hangs.
const TEARDOWN_TIMEOUT_MS = 10_000; // inside the launcher's 15s graceful window

function installStopSignalHandlers(agent) {
    let stopping = false;
    const handleStopSignal = (signal) => {
        if (stopping) return;
        stopping = true;
        console.log(`Received ${signal}; shutting down agent.`);
        const forceExit = setTimeout(() => {
            console.error(`Agent teardown exceeded ${TEARDOWN_TIMEOUT_MS}ms after ${signal}; forcing exit.`);
            process.exit(0);
        }, TEARDOWN_TIMEOUT_MS);
        forceExit.unref?.();
        // teardownAndExit is idempotent and calls process.exit itself; code 0
        // keeps the parent's graceful-stop classification unchanged.
        void Promise.resolve(agent.teardownAndExit(`Received ${signal}. Exiting.`, 0))
            .catch((error) => {
                console.error('Agent teardown failed:', error?.message || error);
                process.exit(0);
            });
    };
    process.once('SIGINT', () => handleStopSignal('SIGINT'));
    process.once('SIGTERM', () => handleStopSignal('SIGTERM'));
}

void (async () => {
    try {
        const connectionToken = process.env.MINDCRAFT_AGENT_TOKEN;
        if (!connectionToken) {
            throw new Error('MindServer agent capability is missing.');
        }
        console.log('Connecting to MindServer');
        await serverProxy.connect(argv.name, argv.port, connectionToken);
        console.log('Starting agent');
        const agent = new Agent();
        serverProxy.setAgent(agent);
        await agent.start(argv.load_memory, argv.init_message, argv.count_id);
        installStopSignalHandlers(agent);
    } catch (error) {
        console.error('Failed to start agent process:');
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
