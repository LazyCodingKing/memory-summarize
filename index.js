// ============================================================================
// IMPORTS
// ============================================================================
import {
    saveSettingsDebounced,
    generateRaw,
    getRequestHeaders,
} from '../../../../script.js';

import {
    extension_settings,
    loadExtensionSettings,
} from '../../../extensions.js';

// ============================================================================
// SETUP
// ============================================================================
const context = SillyTavern.getContext();
const eventSource = context.eventSource;
const event_types = context.event_types;
const renderExtensionTemplateAsync = context.renderExtensionTemplateAsync;

const extensionName = 'memory-summarize';
const extensionPath = 'third-party/memory-summarize';

// Clean Defaults (Matching HTML IDs now!)
const defaultSettings = {
    auto_summarize: true,
    message_threshold: 20,    // "Update Frequency"
    max_summary_words: 350,   // "Max Summary Words"
    master_summary: "",
    debugMode: false
};

// ============================================================================
// HELPER: CLEANER
// ============================================================================
function cleanTextForSummary(text) {
    if (!text) return "";
    text = text.replace(/User's Stats[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Info Box[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Present Characters[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/```\w*\n?/g, "").replace(/```/g, "");
    text = text.replace(/<[^>]*>/g, " ");
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

// ============================================================================
// CORE LOGIC
// ============================================================================
async function triggerRollingSummarize() {
    const chat = context.chat;
    
    // DIRECT MAPPING - No more MacGyver tricks
    const threshold = extension_settings[extensionName].message_threshold || 20;
    const maxWords = extension_settings[extensionName].max_summary_words || 350;

    if (!chat || chat.length < threshold) return;

    // Only grab the recent messages based on threshold
    const recentMessages = chat.slice(-threshold);
    let newEventsText = recentMessages.map(msg => `${msg.name}: ${cleanTextForSummary(msg.mes)}`).join('\n');

    if (newEventsText.length < 50) return;

    let currentMemory = extension_settings[extensionName].master_summary || "No prior history.";

    const prompt = `
    You are an expert Story Summarizer. Update the "Current Story Summary" to include the "New Events".
    [Current Story Summary]: "${currentMemory}"
    [New Events]: "${newEventsText}"
    [INSTRUCTIONS]:
    - Rewrite the summary to be a seamless narrative.
    - Merge new events into the history.
    - KEEP THE TOTAL LENGTH UNDER ${maxWords} WORDS.
    `;

    console.log(`[${extensionName}] Generating Rolling Summary...`);
    if(extension_settings[extensionName].debugMode) console.log(prompt);

    try {
        const newSummary = await generateRaw(prompt, { max_length: 500, temperature: 0.7 });

        if (newSummary && newSummary.length > 10) {
            extension_settings[extensionName].master_summary = newSummary.trim();
            saveSettingsDebounced();
            console.log(`[${extensionName}] Memory Updated!`);
            toastr.success("Memory Updated", "Rolling Summary");
        }
    } catch (e) {
        console.error(`[${extensionName}] Summarization Failed:`, e);
    }
}

// ============================================================================
// API BRIDGE
// ============================================================================
const qvink_memory_api = {
    getSettings: async () => {
        return extension_settings[extensionName];
    },
    setSettings: async (newSettings) => {
        Object.assign(extension_settings[extensionName], newSettings);
        saveSettingsDebounced();
        if (newSettings.debugMode !== undefined) {
            console.log(`[${extensionName}] Debug Mode: ${newSettings.debugMode}`);
        }
    },
    refreshMemory: async () => {
        toastr.info("Force triggering summary...", "Memory");
        await triggerRollingSummarize();
    },
    getContext: () => context
};

// ============================================================================
// INTERCEPTOR
// ============================================================================
function memory_intercept_messages(chat, ...args) {
    if (!extension_settings[extensionName]?.auto_summarize) return;

    const memory = extension_settings[extensionName].master_summary;
    if (memory && memory.length > 5) {
        const memoryBlock = {
            name: "System",
            is_system: true,
            mes: `[STORY SUMMARY SO FAR: ${memory}]`,
            force_avatar: "system.png"
        };
        chat.unshift(memoryBlock);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
jQuery(async function () {
    console.log(`[${extensionName}] Initializing...`);

    // 1. Load Settings
    const settings = await loadExtensionSettings(extensionName);
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    Object.assign(extension_settings[extensionName], defaultSettings, settings);

    // 2. EXPOSE API
    window.qvink_memory = qvink_memory_api;

    // 3. Inject HTML
    try {
        const settingsHtml = await renderExtensionTemplateAsync(extensionPath, 'settings');
        $('#extensions_settings').append(settingsHtml);
    } catch (e) {
        console.error(`[${extensionName}] Failed to load HTML:`, e);
    }

    // 4. Listeners
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            const currentContext = SillyTavern.getContext();
            const msgCount = currentContext.chat.length;
            
            // USE THE NEW CLEAN VARIABLE NAME
            const threshold = extension_settings[extensionName].message_threshold || 20;
            
            if (msgCount > 0 && msgCount % threshold === 0) {
                if (extension_settings[extensionName].auto_summarize) {
                    await triggerRollingSummarize();
                }
            }
        });
    }

    window.memory_intercept_messages = memory_intercept_messages;
    console.log(`[${extensionName}] Ready. Clean Refactor. 🚀`);
});
