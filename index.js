import {
    saveSettingsDebounced,
    generateRaw, 
    eventSource,
    event_types,
    getRequestHeaders,
} from '../../../../script.js';

import { 
    extension_settings, 
    getContext 
} from '../../../extensions.js';

// ============================================================================
// CONSTANTS & CSS
// ============================================================================

const extensionName = 'memory-summarize';
const summaryDivClass = 'qvink_memory_text'; 

// Inject CSS dynamically
const styles = `
.qvink_memory_text {
    font-size: 0.85em;
    margin-top: 5px;
    padding: 5px 10px;
    border-radius: 5px;
    background-color: var(--smart-theme-bg-transfer, rgba(0, 0, 0, 0.2));
    border-left: 3px solid var(--qm-short, #22c55e);
    font-style: italic;
    color: var(--smart-theme-body-color, #e0e0e0);
    opacity: 0.9;
    cursor: pointer;
}
.qvink_memory_text:hover {
    background-color: var(--smart-theme-bg-transfer, rgba(0, 0, 0, 0.4));
}
`;
$('head').append(`<style>${styles}</style>`);

const defaultSettings = {
    enabled: true,
    autoSummarize: true,
    
    // Limits
    messageThreshold: 20,
    messageLag: 0,
    
    // Prompting - IMPROVED: Clearer separation of instruction vs content
    summaryPrompt: `Summarize the following message concisely in past tense. Focus on key events and information.

Do not include any preamble or commentary. Output only the summary.`,
    
    // Display
    displayMemories: true,
    
    // Injection
    includeUserMessages: false,
    includeSystemMessages: false,
    includeCharacterMessages: true,
    
    // Injection template
    memoryTemplate: `[Previous events from this conversation]:
{{memories}}`,
    
    debugMode: false
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function get_extension_directory() {
    let index_path = new URL(import.meta.url).pathname;
    return index_path.substring(0, index_path.lastIndexOf('/'));
}

function get_settings(key) {
    let store = extension_settings?.[extensionName];
    if (!store) store = getContext().extension_settings?.[extensionName];
    return store?.[key] ?? defaultSettings[key];
}

function set_settings(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

function log(msg, ...args) {
    if (get_settings('debugMode')) {
        console.log(`[${extensionName}] ${msg}`, ...args);
    }
}

// ============================================================================
// CORE LOGIC: VISUALS
// ============================================================================

function updateMessageVisuals(index) {
    if (!get_settings('displayMemories')) return;

    const context = getContext();
    if (!context.chat || !context.chat[index]) return;

    let div_element = $(`#chat .mes[mesid="${index}"]`);
    
    if (div_element.length === 0) return; 

    // Remove existing summary if present
    div_element.find(`.${summaryDivClass}`).remove();

    const message = context.chat[index];
    const summary = message.extensions?.[extensionName]?.summary;

    if (summary) {
        let message_text_div = div_element.find('.mes_text');
        
        let html = `<div class="${summaryDivClass}" title="Click to edit summary">📝 ${summary}</div>`;
        message_text_div.after(html);

        // Click to Edit
        div_element.find(`.${summaryDivClass}`).on('click', async function() {
            const newSummary = await context.Popup.show.input('Edit Summary', 'Update the memory for this message:', summary);
            if (newSummary !== false && newSummary !== summary) {
                if (!message.extensions) message.extensions = {};
                if (!message.extensions[extensionName]) message.extensions[extensionName] = {};
                
                message.extensions[extensionName].summary = newSummary;
                context.saveChat();
                updateMessageVisuals(index); 
                refreshContext(); 
            }
        });
    }
}

function refreshAllVisuals() {
    const chat = getContext().chat;
    if (!chat) return;
    for (let i = 0; i < chat.length; i++) {
        updateMessageVisuals(i);
    }
}

// ============================================================================
// CORE LOGIC: CONTEXT INJECTION
// ============================================================================

function refreshContext() {
    if (!get_settings('enabled')) {
        getContext().setExtensionPrompt(extensionName, '');
        return;
    }

    const context = getContext();
    const chat = context.chat;
    let summaries = [];

    if (!chat) return;

    chat.forEach((msg) => {
        if (msg.extensions?.[extensionName]?.summary) {
            summaries.push(msg.extensions[extensionName].summary);
        }
    });

    if (summaries.length === 0) {
        context.setExtensionPrompt(extensionName, '');
        return;
    }

    const memoryBlock = summaries.map(s => `• ${s}`).join('\n');
    const template = get_settings('memoryTemplate');
    const injectionText = template.replace('{{memories}}', memoryBlock);

    // Inject at depth 2, scan enabled for better positioning
    context.setExtensionPrompt(extensionName, injectionText, 0, 2, true);
}

// ============================================================================
// CORE LOGIC: GENERATION - FIXED VERSION
// ============================================================================

async function triggerAutoSummarize() {
    if (!get_settings('enabled') || !get_settings('autoSummarize')) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;

    const lag = parseInt(get_settings('messageLag')) || 0;
    const targetIndex = chat.length - 1 - lag;

    if (targetIndex < 0) return; 

    const targetMsg = chat[targetIndex];

    // Check filters
    if (targetMsg.is_system && !get_settings('includeSystemMessages')) return;
    if (!targetMsg.is_user && !targetMsg.is_system && !get_settings('includeCharacterMessages')) return;
    if (targetMsg.is_user && !get_settings('includeUserMessages')) return;
    
    // Skip if already summarized
    if (targetMsg.extensions?.[extensionName]?.summary) return;

    // Check length
    const content = targetMsg.mes; 
    if (!content || content.length < get_settings('messageThreshold')) return;

    await generateSummaryForMessage(targetIndex, content);
}

async function generateSummaryForMessage(index, content) {
    log(`Summarizing message ${index}...`);
    
    const instructionPrompt = get_settings('summaryPrompt');

    try {
        // CRITICAL FIX: Use proper format for generateRaw
        // We build a complete prompt string that separates instruction from content
        const fullPrompt = `${instructionPrompt}

Message to summarize:
---
${content}
---

Summary:`;

        // Use generateRaw with proper parameters
        const result = await generateRaw({
            prompt: fullPrompt,
            use_mancer: false,
            use_openrouter: false,
            max_length: 150, // Limit summary length
        });
        
        if (result) {
            log(`Generated summary: ${result.substring(0, 50)}...`);
            
            const context = getContext();
            if (!context.chat[index].extensions) context.chat[index].extensions = {};
            
            context.chat[index].extensions[extensionName] = {
                summary: result.trim(),
                timestamp: Date.now()
            };
            context.saveChat();
            
            updateMessageVisuals(index);
            refreshContext();
        }
    } catch (err) {
        console.error(`[${extensionName}] Generation failed:`, err);
    }
}

// ============================================================================
// UI LOGIC
// ============================================================================

async function load_html() {
    let module_dir = get_extension_directory();
    let path = `${module_dir}/config.html`;

    try {
        const response = await $.get(path);
        
        if ($('#memory-config-popup').length === 0) {
             const popupHTML = `
            <div id="memory-config-popup" class="memory-config-popup" style="display:none;">
                 ${response}
            </div>`;
            $('body').append(popupHTML);
        } else {
            $('#memory-config-popup').html(response);
        }

        if ($('#memory-summarize-button').length === 0) {
            const buttonHtml = `
                <div id="memory-summarize-button" class="list-group-item flex-container flexGap5" title="Memory Summarize v2.0">
                    <div class="fa-solid fa-brain extensionsMenuExtensionButton"></div> 
                    <span>Memory Summarize</span>
                </div>`;
            $('#extensions_settings').append(buttonHtml);
            $('#memory-summarize-button').on('click', () => toggleConfigPopup());
        }
        return true;
    } catch (err) {
        console.error(`[${extensionName}] Error loading HTML:`, err);
        return false;
    }
}

function bind_ui_listeners() {
    $(document).off('click', '#memory-close-btn, #memory-cancel-btn').on('click', '#memory-close-btn, #memory-cancel-btn', function() {
        $('#memory-config-popup').removeClass('visible').hide();
    });

    $(document).off('click', '.memory-config-tab').on('click', '.memory-config-tab', function() {
        $('.memory-config-tab').removeClass('active');
        $(this).addClass('active');
        const targetSection = $(this).data('tab');
        $('.memory-config-section').removeClass('active');
        $(`.memory-config-section[data-section="${targetSection}"]`).addClass('active');
    });

    // Manual Tools
    $('#memory-summarize-all').off('click').on('click', async () => {
        const chat = getContext().chat;
        toastr.info("Starting summary of all messages...");
        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            const shouldSummarize = 
                (msg.is_user && get_settings('includeUserMessages')) ||
                (msg.is_system && get_settings('includeSystemMessages')) ||
                (!msg.is_user && !msg.is_system && get_settings('includeCharacterMessages'));

            if (shouldSummarize && !msg.extensions?.[extensionName]?.summary && msg.mes.length >= get_settings('messageThreshold')) {
                await generateSummaryForMessage(i, msg.mes);
            }
        }
        toastr.success("Finished summarization.");
    });

    $('#memory-clear-all').off('click').on('click', () => {
        const chat = getContext().chat;
        chat.forEach(msg => {
            if (msg.extensions?.[extensionName]) delete msg.extensions[extensionName];
        });
        getContext().saveChat();
        refreshAllVisuals();
        refreshContext();
        toastr.info("All memories cleared");
    });

    // Bind Settings
    bind_checkbox('#memory-enabled', 'enabled');
    bind_checkbox('#memory-auto-summarize', 'autoSummarize');
    bind_checkbox('#memory-display', 'displayMemories');
    bind_input('#memory-message-threshold', 'messageThreshold');
    bind_textarea('#memory-summary-prompt', 'summaryPrompt');

    // Save
    $('#memory-save-btn').off('click').on('click', () => {
        $('#memory-config-popup').removeClass('visible').hide();
        saveSettingsDebounced();
        refreshAllVisuals(); 
        refreshContext();    
        toastr.success('Settings Saved');
    });
}

function bind_checkbox(selector, key) {
    const el = $(selector);
    if (!el.length) return;
    el.prop('checked', get_settings(key));
    el.off('change').on('change', function() {
        set_settings(key, $(this).prop('checked'));
    });
}

function bind_input(selector, key) {
    const el = $(selector);
    if (!el.length) return;
    el.val(get_settings(key));
    el.off('change input').on('change input', function() {
        set_settings(key, $(this).val());
    });
}

function bind_textarea(selector, key) {
    const el = $(selector);
    if (!el.length) return;
    el.val(get_settings(key));
    el.off('change input').on('change input', function() {
        set_settings(key, $(this).val());
    });
}

function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    if (popup.is(':visible')) {
        popup.removeClass('visible').hide();
    } else {
        popup.addClass('visible').show();
        bind_checkbox('#memory-enabled', 'enabled');
        bind_checkbox('#memory-auto-summarize', 'autoSummarize');
        bind_checkbox('#memory-display', 'displayMemories');
        bind_input('#memory-message-threshold', 'messageThreshold');
        bind_textarea('#memory-summary-prompt', 'summaryPrompt');
    }
}

function initialize_settings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

jQuery(async function () {
    console.log(`[${extensionName}] Loading extension...`);

    initialize_settings();
    await load_html();
    bind_ui_listeners();

    // Initial Render
    setTimeout(() => {
        refreshAllVisuals();
        refreshContext();
    }, 1000);

    const context = getContext();

    if (eventSource) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            log('Chat changed.');
            setTimeout(() => {
                refreshAllVisuals();
                refreshContext();
            }, 500);
        });

        eventSource.on(event_types.MESSAGE_RENDERED, (id) => {
             updateMessageVisuals(id);
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, async (data) => {
            log('Message received. Checking auto-summarize...');
            if (get_settings('autoSummarize')) {
                setTimeout(() => triggerAutoSummarize(), 1000);
            }
        });
        
        eventSource.on(event_types.MESSAGE_SENT, async () => {
             if (get_settings('autoSummarize') && get_settings('includeUserMessages')) {
                 setTimeout(() => triggerAutoSummarize(), 1000);
             }
        });
    }

    console.log(`[${extensionName}] Ready.`);
});
