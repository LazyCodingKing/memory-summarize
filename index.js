// ============================================================================
// IMPORTS
// (We removed eventSource/event_types from here to avoid the crash)
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
// SETUP: Get Events from Global Context (The Safe Way)
// ============================================================================
const context = SillyTavern.getContext();
const eventSource = context.eventSource;
const event_types = context.event_types;
const getContext = () => context; // Helper to match old code

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const extensionName = 'memory-summarize';
const MAX_SUMMARY_WORDS = 350;

// Default settings
const defaultSettings = {
    enabled: true,
    autoSummarize: true,
    messageThreshold: 20,
    master_summary: "",
    debugMode: true
};

// ============================================================================
// HELPER: THE SMART PEELER (HTML/Stats Cleaner)
// ============================================================================
function cleanTextForSummary(text) {
    if (!text) return "";

    // 1. KILL LIST: Remove UI Stats / Info Boxes
    text = text.replace(/User's Stats[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Info Box[\s\S]*?(?=\n\n|$)/g, "");
    text = text.replace(/Present Characters[\s\S]*?(?=\n\n|$)/g, "");

    // 2. UNWRAP HTML: Handle "Bulletin Boards"
    text = text.replace(/```\w*\n?/g, "").replace(/```/g, "");

    // 3. STRIP TAGS: Remove <div...>, <br>, </span> but keep text
    text = text.replace(/<[^>]*>/g, " ");

    // 4. CLEANUP: Squash extra spaces
    text = text.replace(/\s+/g, " ").trim();

    return text;
}

// ============================================================================
// CORE LOGIC: ROLLING SUMMARIZATION
// ============================================================================

async function triggerRollingSummarize() {
    const chat = context.chat;
    const threshold = extension_settings[extensionName].messageThreshold || 20;

    // Safety check
    if (!chat || chat.length === 0) return;

    // Only grab the recent messages
    const recentMessages = chat.slice(-threshold);

    let newEventsText = recentMessages.map(msg => {
        return `${msg.name}: ${cleanTextForSummary(msg.mes)}`;
    }).join('\n');

    if (newEventsText.length < 50) return; // Too short

    let currentMemory = extension_settings[extensionName].master_summary || "No prior history.";

    const prompt = `
    You are an expert Story Summarizer. Update the "Current Story Summary" to include the "New Events".
    
    [Current Story Summary]:
    "${currentMemory}"

    [New Events]:
    "${newEventsText}"

    [INSTRUCTIONS]:
    - Rewrite the summary to be a seamless narrative.
    - Merge new events into the history.
    - Drop very old, irrelevant details if needed.
    - KEEP THE TOTAL LENGTH UNDER ${MAX_SUMMARY_WORDS} WORDS.
    - Do not output any explanation, just the new summary text.
    `;

    console.log(`[${extensionName}] Generating Rolling Summary...`);

    try {
        const newSummary = await generateRaw(prompt, {
            max_length: 500,
            temperature: 0.7
        });

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
// INTERCEPTOR: INJECT MEMORY INTO PROMPT
// ============================================================================
function memory_intercept_messages(chat, ...args) {
    if (!extension_settings[extensionName]?.enabled) return;

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

    const settings = await loadExtensionSettings(extensionName);
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    Object.assign(extension_settings[extensionName], defaultSettings, settings);

    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            const currentContext = SillyTavern.getContext();
            const msgCount = currentContext.chat.length;
            const threshold = extension_settings[extensionName].messageThreshold;

            if (msgCount > 0 && msgCount % threshold === 0) {
                await triggerRollingSummarize();
            }
        });
    }

    // Expose for manifest
    window.memory_intercept_messages = memory_intercept_messages;

    console.log(`[${extensionName}] Ready. 🚀`);
});
