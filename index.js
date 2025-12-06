import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, generateRaw, isChatCompletionPromptManager } from '../../../../script.js';

const MODULE = 'memory-summarize';

const DEFAULT_PROMPT = `[System Note: You are an AI managing the long-term memory of a story.]
Your job is to update the existing summary with new events.

EXISTING MEMORY:
"{{EXISTING}}"

RECENT CONVERSATION:
{{NEW_LINES}}

INSTRUCTION:
Write a consolidated summary in the past tense. 
Merge the new conversation into the existing memory.
Keep it concise. Do not lose key details (names, locations, major plot points).
Do not output anything else, just the summary text.

UPDATED MEMORY:`;

const defaults = {
    enabled: true,
    threshold: 1,
    show_visuals: true,
    pruning_enabled: true,
    prompt_template: DEFAULT_PROMPT,
    debug: true
};

let settings = {};
let isProcessing = false;

// --- Helpers ---
const log = (msg) => {
    if (settings.debug) console.log(`[Titan] ${msg}`);
};
const err = (msg) => console.error(`[Titan] ${msg}`);

const getMeta = () => {
    const ctx = getContext();
    if (!ctx.characterId) return {};
    return ctx.characters[ctx.characterId]?.data?.extensions?.[MODULE] || {};
};

const setMeta = (data) => {
    const ctx = getContext();
    if (!ctx.characterId) return;
    
    const char = ctx.characters[ctx.characterId];
    if (!char.data.extensions) char.data.extensions = {};
    if (!char.data.extensions[MODULE]) char.data.extensions[MODULE] = {};
    
    Object.assign(char.data.extensions[MODULE], data);
    saveMetadataDebounced();
};

// --- UI Updates ---
function updateUI() {
    const meta = getMeta();
    const $memoryText = $('#titan-memory-text');
    
    if (!$memoryText.is(':focus')) {
        $memoryText.val(meta.summary || '');
    }
    
    const ctx = getContext();
    if (ctx.characterId) {
        const lastIndex = meta.last_index || 0;
        const count = ctx.chat?.length || 0;
        const pending = Math.max(0, count - lastIndex);
        $('#titan-status').text(`Status: Ready. ${pending} new messages pending.`);
    }
}

// --- Visual Injection ---
function renderVisuals(errorMsg = null) {
    if (!settings.enabled || !settings.show_visuals) {
        $('.titan-chat-node').remove();
        return;
    }

    const meta = getMeta();
    const $chat = $('#chat');
    const $lastMsg = $chat.children('.mes').last();
    
    if ($lastMsg.length === 0) return;

    // Remove existing nodes
    $('.titan-chat-node').remove();

    let html = '';
    if (errorMsg) {
        html = `<div class="titan-chat-node error">
            <div class="titan-chat-header"><i class="fa-solid fa-triangle-exclamation"></i> Memory Error</div>
            <div class="titan-memory-content">${escapeHtml(errorMsg)}</div></div>`;
    } else if (isProcessing) {
        html = `<div class="titan-chat-node">
            <div class="titan-chat-header"><i class="fa-solid fa-spinner fa-spin"></i> Updating Memory...</div></div>`;
    } else if (meta.summary) {
        html = `<div class="titan-chat-node">
            <div class="titan-chat-header"><i class="fa-solid fa-brain"></i> Current Memory</div>
            <div class="titan-memory-content" style="white-space: pre-wrap;">${escapeHtml(meta.summary)}</div></div>`;
    }

    if (html) {
        const $textBlock = $lastMsg.find('.mes_text');
        if ($textBlock.length) {
            $textBlock.after(html);
        } else {
            $lastMsg.append(html);
        }
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Injection Logic ---
function refreshMemoryInjection() {
    const ctx = getContext();
    const meta = getMeta();
    
    if (!settings.enabled || !meta.summary) {
        ctx.setExtensionPrompt(`${MODULE}_injection`, '', 0, 0);
        return;
    }

    const injectionText = `[System Note - Story Memory]:\n${meta.summary}`;
    // depth=0, position=0, scan=true, role=0 (system)
    ctx.setExtensionPrompt(`${MODULE}_injection`, injectionText, 0, 0, true, 0);
}

// --- Pruning Logic via Event System ---
function handlePruning() {
    if (!settings.enabled || !settings.pruning_enabled) return;

    const ctx = getContext();
    const meta = getMeta();
    const chat = ctx.chat;
    
    if (!chat || chat.length === 0) return;
    
    const lastIndex = meta.last_index || 0;
    const buffer = 4;
    const pruneLimit = lastIndex - buffer;

    if (pruneLimit > 0) {
        log(`Pruning messages up to index ${pruneLimit}`);
        // Mark old messages to be excluded from context
        for (let i = 0; i < Math.min(pruneLimit, chat.length); i++) {
            if (!chat[i].extra) chat[i].extra = {};
            chat[i].extra.exclude_recursion = true;
        }
    }
}

// --- Summarizer ---
async function runSummarization() {
    if (isProcessing) {
        log('Summarization already in progress');
        return;
    }
    
    const ctx = getContext();
    if (!ctx.characterId) {
        err('No character loaded');
        return;
    }

    const meta = getMeta();
    const chat = ctx.chat || [];
    const lastIndex = meta.last_index || 0;
    
    if (lastIndex >= chat.length) {
        log('No new messages to summarize');
        return;
    }

    isProcessing = true;
    renderVisuals();
    $('#titan-status').text('Generating summary...');

    try {
        // Get new messages
        const newMessages = chat.slice(lastIndex);
        const newLines = newMessages
            .map(m => `${m.name}: ${m.mes}`)
            .join('\n');
        
        const existingMemory = meta.summary || "No history yet.";
        
        // Build prompt
        let promptText = settings.prompt_template;
        promptText = promptText.replace('{{EXISTING}}', existingMemory);
        promptText = promptText.replace('{{NEW_LINES}}', newLines);

        // Format for API type
        let apiPrompt;
        if (isChatCompletionPromptManager()) {
            log("Using Chat Completion format");
            apiPrompt = [{ role: 'user', content: promptText }];
        } else {
            log("Using Text Completion format");
            apiPrompt = promptText;
        }

        log(`Generating summary for ${newMessages.length} new messages`);
        
        // Generate summary
        const result = await generateRaw(apiPrompt, {
            max_length: 600,
            temperature: 0.5,
            top_p: 1.0,
            top_k: 0,
            rep_pen: 1.0,
            use_stop_strings: true,
            stop_strings: ["INSTRUCTION:", "RECENT CONVERSATION:", "UPDATED MEMORY:"],
            bypass_all_plugins: true,
            quiet_prompt: true,
        }).catch(e => {
            throw new Error(`API call failed: ${e.message}`);
        });

        if (!result || typeof result !== 'string') {
            throw new Error("API returned invalid response");
        }

        let cleanResult = result.trim();
        
        // Remove common artifacts
        cleanResult = cleanResult
            .replace(/^UPDATED MEMORY:\s*/i, '')
            .replace(/^["']|["']$/g, '')
            .trim();

        if (!cleanResult) {
            throw new Error("Generated summary was empty");
        }

        log(`Summary generated: ${cleanResult.length} characters`);

        // Save to metadata
        setMeta({
            summary: cleanResult,
            last_index: chat.length,
            updated_at: Date.now()
        });

        updateUI();
        refreshMemoryInjection();
        handlePruning();
        renderVisuals();
        
        $('#titan-status').text('Summary updated successfully!');
        
    } catch (e) {
        err(`Summarization failed: ${e.message}`);
        $('#titan-status').text(`Error: ${e.message}`).addClass('error');
        renderVisuals(`Failed: ${e.message}`);
    } finally {
        isProcessing = false;
        setTimeout(() => {
            $('#titan-status').text('Ready.');
        }, 3000);
    }
}

// --- Event Handlers ---
function onNewMessage() {
    if (!settings.enabled) return;
    
    const ctx = getContext();
    const meta = getMeta();
    const lastIndex = meta.last_index || 0;
    const currentCount = ctx.chat?.length || 0;

    const diff = currentCount - lastIndex;
    
    log(`New message detected. Pending: ${diff}/${settings.threshold}`);
    
    if (diff >= settings.threshold) {
        log('Threshold reached, triggering summarization');
        runSummarization();
    } else {
        refreshMemoryInjection();
        requestAnimationFrame(() => renderVisuals());
    }
    updateUI();
}

function onChatChanged() {
    log('Chat changed');
    updateUI();
    refreshMemoryInjection();
    handlePruning();
    requestAnimationFrame(() => renderVisuals());
}

// --- UI Setup ---
function setupUI() {
    const bind = (id, key, type = 'text') => {
        const $el = $(`#${id}`);
        if (!$el.length) {
            err(`UI element #${id} not found`);
            return;
        }
        
        if (type === 'check') {
            $el.prop('checked', settings[key]);
            $el.on('change', () => {
                settings[key] = $el.prop('checked');
                saveSettings();
                refreshMemoryInjection();
                renderVisuals();
            });
        } else {
            $el.val(settings[key]);
            $el.on('change', () => {
                settings[key] = (type === 'num' ? Number($el.val()) : $el.val());
                saveSettings();
            });
        }
    };

    bind('titan-enabled', 'enabled', 'check');
    bind('titan-show-visuals', 'show_visuals', 'check');
    bind('titan-pruning', 'pruning_enabled', 'check');
    bind('titan-threshold', 'threshold', 'num');
    bind('titan-prompt-template', 'prompt_template');

    $('#titan-reset-prompt').on('click', () => {
        $('#titan-prompt-template').val(DEFAULT_PROMPT).trigger('change');
        log('Prompt reset to default');
    });

    $('#titan-save').on('click', () => {
        const newSummary = $('#titan-memory-text').val();
        setMeta({ summary: newSummary, updated_at: Date.now() });
        refreshMemoryInjection();
        renderVisuals();
        $('#titan-status').text('Memory saved manually.');
        log('Manual save completed');
    });

    $('#titan-now').on('click', () => {
        log('Manual summarization triggered');
        runSummarization();
    });

    $('#titan-wipe').on('click', () => {
        if (confirm("Delete all memory? This cannot be undone.")) {
            setMeta({ summary: '', last_index: 0, updated_at: Date.now() });
            refreshMemoryInjection();
            renderVisuals();
            updateUI();
            log('Memory wiped');
        }
    });

    log('UI setup complete');
}

function saveSettings() {
    extension_settings[MODULE] = settings;
    saveSettingsDebounced();
    log('Settings saved');
}

// --- MAIN ENTRY POINT ---
jQuery(async function () {
    console.log('[Titan] Initializing Titan Memory v14...');

    // Load settings
    settings = { ...defaults, ...(extension_settings[MODULE] || {}) };
    
    // Save if new
    if (!extension_settings[MODULE]) {
        saveSettings();
    }

    // Load settings HTML
    try {
        const settingsPath = '/scripts/extensions/third-party/memory-summarize/settings.html';
        const html = await fetch(settingsPath).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        });
        $('#extensions_settings2').append(html);
        setupUI();
    } catch (e) {
        err(`Failed to load settings.html: ${e.message}`);
        return;
    }

    const ctx = getContext();
    const eventTypes = ctx.eventTypes || ctx.event_types;

    // Register event listeners
    ctx.eventSource.on(eventTypes.USER_MESSAGE_RENDERED, onNewMessage);
    ctx.eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    ctx.eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    
    // Listen for generation events to handle pruning
    ctx.eventSource.on(eventTypes.GENERATION_STARTED, handlePruning);

    // Initial state
    if (ctx.chat && ctx.chat.length > 0) {
        requestAnimationFrame(() => {
            updateUI();
            refreshMemoryInjection();
            renderVisuals();
        });
    }

    console.log('[Titan] Titan Memory v14 loaded successfully');
});
