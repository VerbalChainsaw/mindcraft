import settings from './settings.js';
import { containsCommand } from './commands/index.js';
import { sendBotChatToServer } from './mindserver_proxy.js';

let agent;
let agent_names = [];
let agents_in_game = [];
const WAIT_TIME_START = 30_000;
const MAX_RESPONSE_WAIT_MS = 60_000;
const MAX_RESPONSE_REMINDERS = 1;
const MAX_BUSY_DEFERRALS = 6;
const MAX_QUEUED_MESSAGES = 24;
const MAX_COMPILED_MESSAGE_CHARS = 12_000;
const DEFAULT_MAX_CONVERSATION_TURNS = 6;
const DEFAULT_MAX_CONVERSATION_MS = 5 * 60_000;

class Conversation {
    constructor(name) {
        this.name = name;
        this.active = false;
        this.ignore_until_start = false;
        this.blocked = false;
        this.in_queue = [];
        this.inMessageTimer = null;
        this.startedAt = null;
        this.lastActivityAt = null;
        this.outboundTurns = 0;
        this.busyDeferrals = 0;
        this.responseReminders = 0;
        this.endedReason = null;
    }

    reset() {
        clearTimeout(this.inMessageTimer);
        this.active = false;
        this.ignore_until_start = false;
        this.in_queue = [];
        this.inMessageTimer = null;
        this.startedAt = Date.now();
        this.lastActivityAt = this.startedAt;
        this.outboundTurns = 0;
        this.busyDeferrals = 0;
        this.responseReminders = 0;
        this.endedReason = null;
    }

    end(reason = 'ended') {
        clearTimeout(this.inMessageTimer);
        this.active = false;
        this.ignore_until_start = true;
        this.inMessageTimer = null;
        this.lastActivityAt = Date.now();
        this.busyDeferrals = 0;
        this.responseReminders = 0;
        this.endedReason = String(reason || 'ended').slice(0, 80);
        const full_message = _compileInMessages(this);
        if (full_message.message.trim().length > 0)
            agent.history.add(this.name, full_message.message);
        // add the full queued messages to history, but don't respond

        if (agent.last_sender === this.name)
            agent.last_sender = null;
    }

    queue(message) {
        if (this.in_queue.length >= MAX_QUEUED_MESSAGES) this.in_queue.shift();
        this.in_queue.push(message);
        this.lastActivityAt = Date.now();
    }
}

class ConversationManager {
    constructor() {
        this.convos = {};
        this.activeConversation = null;
        this.awaiting_response = false;
        this.connection_timeout = null;
        this.wait_time_limit = WAIT_TIME_START;
        this.resume_timeout = null;
        this.paused_goal_for_conversation = false;
    }

    initAgent(a) {
        agent = a;
    }

    _getConvo(name) {
        if (!this.convos[name])
            this.convos[name] = new Conversation(name);
        return this.convos[name];
    }

    _limits() {
        const maxTurns = Math.max(
            2,
            Math.min(20, Number(agent?.runtime?.limits?.maxConversationTurns) || DEFAULT_MAX_CONVERSATION_TURNS),
        );
        const maxMinutes = Math.max(
            1,
            Math.min(30, Number(agent?.runtime?.limits?.maxConversationMinutes) || (DEFAULT_MAX_CONVERSATION_MS / 60_000)),
        );
        return {
            maxTurns,
            maxDurationMs: maxMinutes * 60_000,
        };
    }

    _endForBudget(convo, reason, message) {
        if (!convo?.active) return;
        const partner = convo.name;
        this.sendToBot(
            partner,
            `${message} !endConversation("${partner}")`,
            false,
            false,
            { terminal: true },
        );
        agent.history.add('system', `Conversation with ${partner} ended: ${reason}.`);
        this.endConversation(partner, reason);
    }

    _cancelScheduledResume() {
        clearTimeout(this.resume_timeout);
        this.resume_timeout = null;
    }

    _scheduleResume() {
        if (!this.paused_goal_for_conversation) return;
        this._cancelScheduledResume();
        this.resume_timeout = setTimeout(() => {
            this.resume_timeout = null;
            if (agent.self_prompter.isPaused() && !this.inConversation()) {
                agent.self_prompter.start();
            }
            this.paused_goal_for_conversation = false;
        }, 5_000);
    }

    async _pauseGoalForConversation() {
        if (!agent.self_prompter.isActive()) return;
        this.paused_goal_for_conversation = true;
        await agent.self_prompter.pause();
    }

    deferGoalUntilConversationEnd() {
        this.paused_goal_for_conversation = true;
    }

    _startMonitor() {
        clearInterval(this.connection_monitor);
        let wait_time = 0;
        let last_time = Date.now();
        this.connection_monitor = setInterval(() => {
            if (!this.activeConversation) {
                this._stopMonitor();
                return; // will clean itself up
            }

            let delta = Date.now() - last_time;
            last_time = Date.now();
            const convo = this.activeConversation;
            let convo_partner = convo.name;
            const limits = this._limits();

            if (Date.now() - (convo.startedAt || Date.now()) >= limits.maxDurationMs) {
                this._endForBudget(convo, 'time_budget', 'I need to return to the current mission.');
                return;
            }
            if (convo.outboundTurns >= limits.maxTurns) {
                this._endForBudget(convo, 'turn_budget', 'We have enough to continue the mission.');
                return;
            }

            if (this.awaiting_response && agent.isIdle()) {
                wait_time += delta;
                if (wait_time > this.wait_time_limit) {
                    if (convo.responseReminders >= MAX_RESPONSE_REMINDERS) {
                        this._endForBudget(convo, 'response_timeout', 'I am returning to the mission because no response arrived.');
                        return;
                    }
                    convo.responseReminders += 1;
                    agent.handleMessage('system', `${convo_partner} hasn't responded in ${this.wait_time_limit/1000} seconds, respond with a message to them or your own action.`);
                    wait_time = 0;
                    this.wait_time_limit = Math.min(MAX_RESPONSE_WAIT_MS, this.wait_time_limit * 2);
                }
            }
            else if (!this.awaiting_response){
                this.wait_time_limit = WAIT_TIME_START;
                wait_time = 0;
            }

            if (!this.otherAgentInGame(convo_partner) && !this.connection_timeout) {
                this.connection_timeout = setTimeout(() => {
                    if (this.otherAgentInGame(convo_partner)){
                        this._clearMonitorTimeouts();
                        return;
                    }
                    if (!agent.self_prompter.isPaused()) {
                        this.endConversation(convo_partner);
                        agent.handleMessage('system', `${convo_partner} disconnected, conversation has ended.`);
                    }
                    else {
                        this.endConversation(convo_partner);
                    }
                }, 10000);
            }
        }, 1000);
    }

    _stopMonitor() {
        clearInterval(this.connection_monitor);
        this.connection_monitor = null;
        this._clearMonitorTimeouts();
    }

    _clearMonitorTimeouts() {
        this.awaiting_response = false;
        if (this.activeConversation) this.activeConversation.responseReminders = 0;
        clearTimeout(this.connection_timeout);
        this.connection_timeout = null;
    }

    async startConversation(send_to, message) {
        this._cancelScheduledResume();
        const convo = this._getConvo(send_to);
        convo.reset();
        
        await this._pauseGoalForConversation();
        if (convo.active)
            return;
        convo.active = true;
        this.activeConversation = convo;
        this._startMonitor();
        const delivered = this.sendToBot(send_to, message, true, false);
        if (!delivered) {
            this.endConversation(send_to, 'relay_unavailable');
            agent.history.add('system', `Conversation with ${send_to} could not start because MindServer relay is unavailable.`);
        }
    }

    startConversationFromOtherBot(name) {
        this._cancelScheduledResume();
        const convo = this._getConvo(name);
        convo.active = true;
        this.activeConversation = convo;
        this._startMonitor();
    }

    sendToBot(send_to, message, start=false, open_chat=true, { terminal = false } = {}) {
        if (!this.isOtherAgent(send_to)) {
            console.warn(`${agent.name} tried to send bot message to non-bot ${send_to}`);
            return false;
        }
        const convo = this._getConvo(send_to);
        
        if (settings.chat_bot_messages && open_chat)
            agent.openChat(`(To ${send_to}) ${message}`);
        
        if (convo.ignore_until_start)
            return false;
        convo.active = true;
        convo.startedAt ??= Date.now();
        convo.lastActivityAt = Date.now();
        
        const end = message.includes('!endConversation');
        const limits = this._limits();
        if (!terminal && !end && convo.outboundTurns >= limits.maxTurns) {
            this._endForBudget(convo, 'turn_budget', 'We have enough to continue the mission.');
            return false;
        }
        const json = {
            'message': message,
            start,
            end,
        };

        if (!end) convo.outboundTurns += 1;
        const delivered = sendBotChatToServer(send_to, json);
        this.awaiting_response = delivered && !end;
        if (!delivered && !terminal && this.activeConversation?.name === send_to) {
            this.endConversation(send_to, 'relay_unavailable');
        }
        return delivered;
    }

    async receiveFromBot(sender, received) {
        const convo = this._getConvo(sender);

        if (convo.ignore_until_start && !received.start)
            return;

        // check if any convo is active besides the sender
        if (this.inConversation() && !this.inConversation(sender)) {
            this.sendToBot(sender, `I'm talking to someone else, try again later. !endConversation("${sender}")`, false, false);
            this.endConversation(sender);
            return;
        }

        if (received.start) {
            convo.reset();
            this.startConversationFromOtherBot(sender);
        }

        this._clearMonitorTimeouts();
        convo.queue(received);
        
        // responding to conversation takes priority over self prompting
        await this._pauseGoalForConversation();
    
        _scheduleProcessInMessage(sender, received, convo);
    }

    async receiveSquadRadio(sender, message, kind = 'status') {
        if (!this.isOtherAgent(sender) || !message) return false;
        const normalizedKind = String(kind || 'status').toLowerCase();
        const taggedMessage = `[SQUAD RADIO · ${normalizedKind.toUpperCase()}] ${String(message).slice(0, 1_200)}`;
        if (normalizedKind === 'status' && !this.inConversation(sender)) {
            agent.history.add(sender, taggedMessage);
            return true;
        }
        if (this.inConversation() && !this.inConversation(sender)) {
            agent.history.add(sender, taggedMessage);
            return true;
        }
        const convo = this._getConvo(sender);
        if (!convo.active) {
            convo.reset();
            this.startConversationFromOtherBot(sender);
        }
        await this._pauseGoalForConversation();
        convo.queue({
            message: taggedMessage,
            start: false,
            end: false,
            radio: true,
        });
        await _scheduleProcessInMessage(sender, { message, start: false, end: false, radio: true }, convo);
        return true;
    }

    responseScheduledFor(sender) {
        if (!this.isOtherAgent(sender) || !this.inConversation(sender))
            return false;
        const convo = this._getConvo(sender);
        return !!convo.inMessageTimer;
    }

    isOtherAgent(name) {
        return agent_names.some((n) => n === name);
    }

    otherAgentInGame(name) {
        return agents_in_game.some((n) => n === name);
    }
    
    updateAgents(agents) {
        agent_names = agents.map(a => a.name);
        agents_in_game = agents.filter(a => a.in_game).map(a => a.name);
    }

    getInGameAgents() {
        return agents_in_game;
    }
    
    inConversation(other_agent=null) {
        if (other_agent)
            return this.convos[other_agent]?.active;
        return Object.values(this.convos).some(c => c.active);
    }
    
    endConversation(sender, reason = 'ended') {
        if (this.convos[sender]) {
            this.convos[sender].end(reason);
            if (this.activeConversation?.name === sender) {
                this._stopMonitor();
                this.activeConversation = null;
                if (agent.self_prompter.isPaused() && !this.inConversation()) {
                    this._scheduleResume();
                }
            }
        }
    }
    
    endAllConversations() {
        this._cancelScheduledResume();
        for (const sender in this.convos) {
            this.convos[sender].end('end_all');
        }
        this._stopMonitor();
        this.activeConversation = null;
        if (agent.self_prompter.isPaused()) {
            this._scheduleResume();
        }
    }

    forceEndCurrentConversation() {
        if (this.activeConversation) {
            let sender = this.activeConversation.name;
            this.sendToBot(sender, '!endConversation("' + sender + '")', false, false);
            this.endConversation(sender);
        }
    }
}

const convoManager = new ConversationManager();
export default convoManager;

/*
This function controls conversation flow by deciding when the bot responds.
The logic is as follows:
- If neither bot is busy, respond quickly with a small delay.
- If only the other bot is busy, respond with a long delay to allow it to finish short actions (ex check inventory)
- If I'm busy but other bot isn't, let LLM decide whether to respond
- If both bots are busy, don't respond until someone is done, excluding a few actions that allow fast responses
- New messages received during the delay will reset the delay following this logic, and be queued to respond in bulk
*/
const talkOverActions = ['stay', 'followPlayer', 'mode:']; // all mode actions
const fastDelay = 200;
const longDelay = 5000;
async function _scheduleProcessInMessage(sender, received, convo) {
    if (convo.inMessageTimer)
        clearTimeout(convo.inMessageTimer);
    let otherAgentBusy = containsCommand(received.message);

    const scheduleResponse = (delay, { requireIdle = false } = {}) => {
        convo.inMessageTimer = setTimeout(() => {
            convo.inMessageTimer = null;
            if (!convo.active) return;
            if (requireIdle && !agent.isIdle() && convo.busyDeferrals < MAX_BUSY_DEFERRALS) {
                convo.busyDeferrals += 1;
                scheduleResponse(longDelay, { requireIdle: true });
                return;
            }
            convo.busyDeferrals = 0;
            _processInMessageQueue(sender);
        }, delay);
    };

    if (!agent.isIdle() && otherAgentBusy) {
        // both are busy
        let canTalkOver = talkOverActions.some(a => agent.actions.currentActionLabel.includes(a));
        if (canTalkOver)
            scheduleResponse(fastDelay);
        else
            scheduleResponse(longDelay, { requireIdle: true });
    }
    else if (otherAgentBusy)
        // other bot is busy but I'm not
        scheduleResponse(longDelay);
    else if (!agent.isIdle()) {
        // I'm busy but other bot isn't
        let canTalkOver = talkOverActions.some(a => agent.actions.currentActionLabel.includes(a));
        if (canTalkOver) {
            scheduleResponse(fastDelay);
        }
        else {
            let shouldRespond = await agent.prompter.promptShouldRespondToBot(received.message);
            console.log(`${agent.name} decided to ${shouldRespond?'respond':'not respond'} to ${sender}`);
            if (shouldRespond)
                scheduleResponse(fastDelay);
            else {
                convoManager.sendToBot(sender, `I need to finish my current task. !endConversation("${sender}")`, false, false, { terminal: true });
                convoManager.endConversation(sender, 'declined_while_busy');
            }
        }
    }
    else {
        // neither are busy
        scheduleResponse(fastDelay);
    }
}

function _processInMessageQueue(name) {
    const convo = convoManager._getConvo(name);
    if (!convo.active) return;
    _handleFullInMessage(name, _compileInMessages(convo));
}

function _compileInMessages(convo) {
    let pack = { message: '', start: false, end: false };
    const messages = [];
    while (convo.in_queue.length > 0) {
        pack = convo.in_queue.shift();
        messages.push(String(pack?.message || ''));
    }
    pack.message = messages.join('\n').slice(-MAX_COMPILED_MESSAGE_CHARS);
    return pack;
}

function _handleFullInMessage(sender, received) {
    console.log(`${agent.name} responding to "${received.message}" from ${sender}`);
    
    const convo = convoManager._getConvo(sender);
    convo.active = true;

    let message = _tagMessage(received.message);
    if (received.end) {
        convoManager.endConversation(sender);
        message = `Conversation with ${sender} ended with message: "${message}"`;
        sender = 'system'; // bot will respond to system instead of the other bot
    }
    else if (received.start)
        agent.shut_up = false;
    convo.inMessageTimer = null;
    agent.handleMessage(sender, message);
}


function _tagMessage(message) {
    return "(FROM OTHER BOT)" + message;
}
