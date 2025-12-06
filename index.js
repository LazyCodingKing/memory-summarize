import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'memory-summarize'; // Kept same folder name for compatibility

// --- Defaults ---
const DEFAULT_PROMPT = `You are a helpful AI assistant managing the long-term memory of a story.
Your job is to update the existing summary with new events.

EXISTING MEMORY:
"{{EXISTING}}"

NEW CONVERSATION:
{{NEW_LINES}}

INSTRUCTION:
Write a consolidated summary in the past tense. 
Merge the new conversation into the existing memory.
Keep it concise. Do not lose key details (names, locations, major plot points).
Do not output anything else, just the summary text.

UPDATED MEMORY:`;

const defaults = {
    enabled: true,
    api_url: 'http://127.0.0.1:5000/api/v1/generate',
    api_key: '',
    threshold: 5, // Default to 5, user can set to 1
    show_visuals: true, // Show in chat by default
    pruning_enabled: true,
    pruning_buffer: 2, 
    prompt_template: DEFAULT_PROMPT,
    debug: false
};

let settings = {};
let isProcessing = false;

// --- Helpers ---
const log = (msg) => console.log(`[Titan] ${msg}`);
const err = (msg) => console.error(`[Titan] ${msg}`);
const getMeta = () => {
    const ctx = getContext();
    if (!ctx.character) return {};
    return ctx.character.metadata[MODULE] || {};
};
const setMeta = (data) => {
    const ctx = getContext();
    if (!ctx.character) return;
    if (!ctx.character.metadata[MODULE]) ctx.character.metadata[MODULE] = {};
    Object.assign(ctx.character.metadata[MODULE], data);
    saveMetadataDebounced();
};

// --- UI Updates ---
function updateUI() {
    const meta = getMeta();
    if (!$('#titan-memory-text').is(':focus')) {
        $('#titan-memory-text').val(meta.summary || '');
    }
    
    // Status
    const ctx = getContext();
    if (ctx.character) {
        const lastIndex = meta.last_index || 0;
        const count = ctx.chat.length;
        const pending = Math.max(0, count - lastIndex);
        $('#titan-status').text(`Status: Ready. ${pending} new messages pending summary.`);
    }
}

// --- Visual Injection (The "Qvink" Style Display) ---
function renderVisuals() {
    if (!settings.enabled || !settings.show_visuals) {
        $('.titan-chat-node').remove();
        return;
    }

    const meta = getMeta();
    if (!meta.summary) return;

    // We only want to show this on the very last message of the chat
    const chat = $('#chat');
    const lastMsg = chat.children('.mes').last();
    
    if (lastMsg.length === 0) return;

    // Check if we already injected into this specific message
    if (lastMsg.find('.titan-chat-node').length > 0) {
        // Update text if it exists
        lastMsg.find('.titan-memory-content').text(meta.summary);
        return;
    }

    // Remove from previous messages to avoid clutter
    $('.titan-chat-node').remove();

    // Create the HTML
    const html = `
        <div class="titan-chat-node">
            <div class="titan-chat-header">
                <i class="fa-solid fa-brain"></i> Current Memory
            </div>
            <div class="titan-memory-content" style="white-space: pre-wrap;">${meta.summary}</div>
        </div>
    `;

    // Append to message content
    lastMsg.find('.mes_text').append(html);
}

// --- The Core: Summarizer ---
async function runSummarization() {
    if (isProcessing) return;
    const ctx = getContext();
    if (!ctx.character) return;

    const meta = getMeta();
    const chat = ctx.chat;
    const lastIndex = meta.last_index || 0;
    
    if (lastIndex >= chat.length) {
        $('#titan-status').text("No new messages to summarize.");
        return;
    }

    isProcessing = true;
    $('#titan-now').prop('disabled', true).text('Working...');
    $('#titan-status').text('Generating summary...');

    // Show visual indicator in chat
    if (settings.show_visuals) {
        const lastMsg = $('#chat').children('.mes').last();
        if (lastMsg.find('.titan-loading').length === 0) {
             lastMsg.find('.mes_text').append(`<div class="titan-chat-node titan-loading"><i class="fa-solid fa-spinner fa-spin"></i> Updating Memory...</div>`);
        }
    }

    try {
        const newLines = chat.slice(lastIndex).map(m => `${m.name}: ${m.mes}`).join('\n');
        const existingMemory = meta.summary || "No history yet.";
        
        let prompt = settings.prompt_template;
        prompt = prompt.replace('{{EXISTING}}', existingMemory);
        prompt = prompt.replace('{{NEW_LINES}}', newLines);

        const response = await fetch(settings.api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': settings.api_key ? `Bearer ${settings.api_key}` : undefined
            },
            body: JSON.stringify({
                prompt: prompt,
                max_new_tokens: 600,
                temperature: 0.7,
                top_p: 0.9,
                stop: ["INSTRUCTION:", "NEW CONVERSATION:", "UPDATED MEMORY:"]
            })
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        
        let result = data.results?.[0]?.text || data.choices?.[0]?.text || data.choices?.[0]?.message?.content || "";
        result = result.trim();

        if (!result) throw new Error("Empty response from API");

        setMeta({
            summary: result,
            last_index: chat.length
        });

        $('#titan-status').text('Summary updated successfully!');
        updateUI();
        
        // Re-render visuals immediately with new text
        $('.titan-loading').remove();
        renderVisuals();

    } catch (e) {
        err(e);
        $('.titan-loading').remove();
        $('#titan-status').text(`Error: ${e.message}`).addClass('error');
    } finally {
        isProcessing = false;
        $('#titan-now').prop('disabled', false).text('⚡ Summarize Now');
    }
}

// --- Context Processor: Injection ---
const titanProcessor = (data) => {
    if (!settings.enabled) return;
    const meta = getMeta();
    if (!meta.summary) return;

    const summaryMsg = {
        is_system: true,
        mes: `[System Note: Long-term memory of previous events]\n${meta.summary}`,
        send_as: 'system',
        force_avatar: 'system'
    };
    data.chat.unshift(summaryMsg);
};

// --- Event Handlers ---
function onNewMessage() {
    if (!settings.enabled) return;
    const ctx = getContext();
    const meta = getMeta();
    const lastIndex = meta.last_index || 0;
    const currentCount = ctx.chat.length;

    // 1. Pruning
    if (settings.pruning_enabled && lastIndex > 0) {
        const IGNORE = ctx.symbols.ignore;
        const buffer = settings.pruning_buffer || 2;
        const pruneLimit = lastIndex - buffer;

        if (pruneLimit > 0) {
            for (let i = 0; i < pruneLimit; i++) {
                if (!ctx.chat[i][IGNORE]) ctx.chat[i][IGNORE] = true;
            }
        }
    }

    // 2. Trigger
    const diff = currentCount - lastIndex;
    if (diff >= settings.threshold) {
        log(`Threshold reached (${diff}/${settings.threshold}). Summarizing.`);
        runSummarization();
    }
    
    updateUI();
    
    // 3. Render Visuals (Delay slightly to ensure DOM is ready)
    setTimeout(renderVisuals, 100);
}

function setupUI() {
    const bind = (id, key, type='text') => {
        const el = $(`#${id}`);
        if (type === 'check') {
            el.prop('checked', settings[key]);
            el.on('change', () => { settings[key] = el.prop('checked'); saveSettings(); renderVisuals(); });
        } else {
            el.val(settings[key]);
            el.on('change', () => { settings[key] = (type==='num' ? Number(el.val()) : el.val()); saveSettings(); });
        }
    };

    bind('titan-enabled', 'enabled', 'check');
    bind('titan-show-visuals', 'show_visuals', 'check');
    bind('titan-pruning', 'pruning_enabled', 'check');
    bind('titan-api', 'api_url');
    bind('titan-key', 'api_key');
    bind('titan-threshold', 'threshold', 'num');
    bind('titan-prompt-template', 'prompt_template');

    $('#titan-reset-prompt').on('click', () => {
        $('#titan-prompt-template').val(DEFAULT_PROMPT).trigger('change');
    });

    $('#titan-save').on('click', () => {
        setMeta({ summary: $('#titan-memory-text').val() });
        $('#titan-status').text('Memory manually updated.');
        renderVisuals();
    });

    $('#titan-now').on('click', runSummarization);

    $('#titan-wipe').on('click', () => {
        if(confirm("Delete all memory for this character?")) {
            setMeta({ summary: '', last_index: 0 });
            const ctx = getContext();
            const IGNORE = ctx.symbols.ignore;
            ctx.chat.forEach(m => delete m[IGNORE]);
            updateUI();
            renderVisuals(); // Will remove the box
            $('#titan-status').text('Memory wiped.');
        }
    });
}

function saveSettings() {
    extension_settings[MODULE] = settings;
    saveSettingsDebounced();
}

async function init() {
    settings = { ...defaults, ...(extension_settings[MODULE] || {}) };

    const url = new URL(import.meta.url);
    const path = url.pathname.substring(0, url.pathname.lastIndexOf('/'));
    const html = await (await fetch(`${path}/settings.html`)).text();
    $('#extensions_settings2').append(html);

    setupUI();

    const ctx = getContext();
    ctx.eventSource.on('chat:new-message', onNewMessage);
    // Also listen for message render to inject visuals
    ctx.eventSource.on('chat_message_rendered', () => setTimeout(renderVisuals, 50));
    
    ctx.eventSource.on('chat_loaded', () => { 
        updateUI(); 
        onNewMessage(); 
        setTimeout(renderVisuals, 500); 
    });

    ctx.contextProcessors.push(titanProcessor);

    log('Titan Memory v2.1 Loaded.');
}

init();
