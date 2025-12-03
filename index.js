// ============================================================================
// IMPORTS: Absolute Paths (Fixes your MIME/Folder Depth error)
// ============================================================================
import {
    saveSettingsDebounced,
    generateRaw,
    getRequestHeaders,
} from '/scripts/script.js'; 

import {
    extension_settings,
    getContext,
    loadExtensionSettings,
} from '/scripts/extensions.js';

// ============================================================================
// SETUP: Use Global Context (Like NoAss does - Best Practice)
// ============================================================================
const context = SillyTavern.getContext();
const eventSource = context.eventSource;
const event_types = context.event_types;

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const extensionName = 'memory-summarize';
const summaryDivClass = 'qvink_memory_text';
const MAX_SUMMARY_WORDS = 350; // TOKEN SAVER: Hard limit on summary size

// Default settings
const defaultSettings = {
    enabled: true,
    autoSummarize: true,
    messageThreshold: 20, // Summarize every 20 messages
    master_summary: "",   // The "Rolling Memory" lives here
    debugMode: true
};

// ============================================================================
// HELPER: THE SMART PEELER (HTML/Stats Cleaner)
// ============================================================================
function cleanTextForSummary(text) {
    if (!text) return "";

    // 1. SPECIFIC KILL LIST: Remove UI Stats / Info Boxes
    // Adjust these regexes if your preset uses different headers.
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
    const chat = context.chat; // Grab chat from global context
    const threshold = extension_settings[extensionName].messageThreshold || 20;

    // Only grab the recent messages
    const recentMessages = chat.slice(-threshold); 

    // 1. Prepare the Text (Cleaned!)
    let newEventsText = recentMessages.map(msg => {
        return `${msg.name}: ${cleanTextForSummary(msg.mes)}`;
    }).join('\n');

    if (newEventsText.length < 50) return; // Too short to summarize

    // 2. Get the Old Memory
    let currentMemory = extension_settings[extensionName].master_summary || "No prior history.";

    // 3. Build the "Updater" Prompt
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

    // 4. Call the AI
    try {
        const newSummary = await generateRaw(prompt, {
            max_length: 500,
            temperature: 0.7
        });

        if (newSummary && newSummary.length > 10) {
            // 5. Update the Master Memory
            extension_settings[extensionName].master_summary = newSummary.trim();
            saveSettingsDebounced();
            console.log(`[${extensionName}] Memory Updated!`);
            
            // Visual Feedback
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
        
        // Insert at Top of context
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

    // 2. Register Listeners
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            const context = SillyTavern.getContext(); // Refresh context
            const msgCount = context.chat.length;
            const threshold = extension_settings[extensionName].messageThreshold;
            
            // Trigger check
            if (msgCount > 0 && msgCount % threshold === 0) {
                await triggerRollingSummarize();
            }
        });
    }

    // 3. Expose Global Function for Manifest
    window.memory_intercept_messages = memory_intercept_messages;

    console.log(`[${extensionName}] Ready. 🚀`);
});
