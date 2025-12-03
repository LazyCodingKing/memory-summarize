import { 
    saveSettingsDebounced, 
    eventSource, 
    event_types
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

// ============================================================================
// CONSTANTS & CONFIGURATION
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
        background-color: var(--black50a, rgba(0, 0, 0, 0.2));
        border-left: 3px solid var(--SmartThemeBodyColor, #22c55e);
        font-style: italic;
        color: var(--SmartThemeBodyColor, #e0e0e0);
        opacity: 0.9;
        cursor: pointer;
        transition: all 0.2s ease-in-out;
    }
    .qvink_memory_text:hover {
        background-color: var(--black70a, rgba(0, 0, 0, 0.4));
        opacity: 1;
    }
    .qvink_memory_loading {
        opacity: 0.5;
        animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.8; }
    }
`;

// Append styles to head
if (!document.getElementById('memory-summarize-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'memory-summarize-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

const defaultSettings = {
    enabled: true,
    autoSummarize: true,

    // Thresholds
    messageThreshold: 20,
    messageLag: 0,

    // Prompting
    summaryPrompt: `Summarize the following message concisely in past tense. Focus on key events, information, and character actions. Do not include any preamble, commentary, or "Summary:" prefix. Output only the summary itself.

Message to summarize:
{{message}}`,

    // Display options
    displayMemories: true,
    showInlineMemories: true,

    // Injection settings
    includeUserMessages: false,
    includeSystemMessages: false,
    includeCharacterMessages: true,

    // Injection template
    memoryTemplate: `[Previous conversation summary]:
{{memories}}
`,

    // Advanced settings
    maxSummaryLength: 200,
    batchSummarize: false,
    debugMode: false
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getSettings(key) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    return extension_settings[extensionName]?.[key] ?? defaultSettings[key];
}

function setSettings(key, value) {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

function log(msg, ...args) {
    if (getSettings('debugMode')) {
        console.log(`[${extensionName}] ${msg}`, ...args);
    }
}

function logError(msg, error) {
    console.error(`[${extensionName}] ${msg}`, error);
}

// ============================================================================
// CORE LOGIC: VISUALS
// ============================================================================

function updateMessageVisuals(index) {
    if (!getSettings('displayMemories') || !getSettings('showInlineMemories')) {
        return;
    }

    const context = getContext();
    if (!context.chat || !context.chat[index]) {
        return;
    }

    const mesElement = $(`#chat .mes[mesid="${index}"]`);
    if (mesElement.length === 0) {
        return;
    }

    mesElement.find(`.${summaryDivClass}`).remove();

    const message = context.chat[index];
    const summary = message.extensions?.[extensionName]?.summary;

    if (summary) {
        const messageTextDiv = mesElement.find('.mes_text');
        const summaryHtml = `
            <div class="${summaryDivClass}" data-message-id="${index}" title="Click to edit summary">
                <i class="fa-solid fa-brain fa-sm"></i> ${summary}
            </div>
        `;
        messageTextDiv.after(summaryHtml);

        mesElement.find(`.${summaryDivClass}`).on('click', () => editSummary(index));
    }
}

function updateAllMessageVisuals() {
    const context = getContext();
    if (!context.chat) return;

    context.chat.forEach((_, index) => {
        updateMessageVisuals(index);
    });
}

// ============================================================================
// CORE LOGIC: SUMMARIZATION
// ============================================================================

async function generateSummary(message, messageIndex) {
    if (!getSettings('enabled')) {
        return null;
    }

    try {
        log('Generating summary for message:', messageIndex);

        const prompt = getSettings('summaryPrompt').replace('{{message}}', message.mes || '');

        // Use the context's generate function
        const context = getContext();
        const quietPrompt = prompt;

        // Call the generation API via the proper method
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                prompt: quietPrompt,
                use_mancer: false,
                use_openrouter: false,
                temperature: 0.7,
                max_length: getSettings('maxSummaryLength'),
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const summary = data.response || data.results?.[0]?.text || '';

        if (!summary || summary.trim().length === 0) {
            logError('Generated summary is empty');
            return null;
        }

        log('Generated summary:', summary);
        return summary.trim();

    } catch (error) {
        logError('Failed to generate summary', error);
        toastr.error(`Failed to generate summary: ${error.message}`, 'Memory Summarize');
        return null;
    }
}

async function saveSummary(messageIndex, summary) {
    const context = getContext();
    if (!context.chat || !context.chat[messageIndex]) {
        return;
    }

    const message = context.chat[messageIndex];

    if (!message.extensions) {
        message.extensions = {};
    }
    if (!message.extensions[extensionName]) {
        message.extensions[extensionName] = {};
    }

    message.extensions[extensionName].summary = summary;
    message.extensions[extensionName].timestamp = Date.now();

    await context.saveChat();
    updateMessageVisuals(messageIndex);

    log('Saved summary for message', messageIndex);
}

async function summarizeMessage(messageIndex) {
    const context = getContext();
    if (!context.chat || !context.chat[messageIndex]) {
        return;
    }

    const message = context.chat[messageIndex];

    if (!shouldSummarizeMessage(message)) {
        return;
    }

    const mesElement = $(`#chat .mes[mesid="${messageIndex}"]`);
    const existingSummary = mesElement.find(`.${summaryDivClass}`);
    if (existingSummary.length > 0) {
        existingSummary.addClass('qvink_memory_loading');
    }

    try {
        const summary = await generateSummary(message, messageIndex);
        if (summary) {
            await saveSummary(messageIndex, summary);
            toastr.success('Summary generated successfully', 'Memory Summarize');
        }
    } finally {
        existingSummary.removeClass('qvink_memory_loading');
    }
}

function shouldSummarizeMessage(message) {
    const includeUser = getSettings('includeUserMessages');
    const includeSystem = getSettings('includeSystemMessages');
    const includeCharacter = getSettings('includeCharacterMessages');

    if (message.is_user && !includeUser) return false;
    if (message.is_system && !includeSystem) return false;
    if (!message.is_user && !message.is_system && !includeCharacter) return false;

    return true;
}

async function autoSummarize() {
    if (!getSettings('enabled') || !getSettings('autoSummarize')) {
        return;
    }

    const context = getContext();
    if (!context.chat || context.chat.length === 0) {
        return;
    }

    const threshold = getSettings('messageThreshold');
    const lag = getSettings('messageLag');

    if (context.chat.length < threshold) {
        return;
    }

    const messagesToSummarize = context.chat
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg, idx }) => 
            !msg.extensions?.[extensionName]?.summary && 
            shouldSummarizeMessage(msg) &&
            idx < context.chat.length - lag
        );

    if (messagesToSummarize.length === 0) {
        return;
    }

    log(`Auto-summarizing ${messagesToSummarize.length} messages`);

    if (getSettings('batchSummarize')) {
        for (const { idx } of messagesToSummarize) {
            await summarizeMessage(idx);
        }
    } else {
        await summarizeMessage(messagesToSummarize[0].idx);
    }
}

async function editSummary(messageIndex) {
    const context = getContext();
    const message = context.chat[messageIndex];
    const currentSummary = message.extensions?.[extensionName]?.summary || '';

    const newSummary = prompt('Edit summary for this message:', currentSummary);

    if (newSummary !== null && newSummary !== '') {
        await saveSummary(messageIndex, newSummary);
        toastr.success('Summary updated', 'Memory Summarize');
    }
}

async function deleteSummary(messageIndex) {
    const context = getContext();
    const message = context.chat[messageIndex];

    if (message.extensions?.[extensionName]) {
        delete message.extensions[extensionName].summary;
        await context.saveChat();
        updateMessageVisuals(messageIndex);
        toastr.info('Summary deleted', 'Memory Summarize');
    }
}

// ============================================================================
// PROMPT INJECTION
// ============================================================================

function getAllSummaries() {
    const context = getContext();
    if (!context.chat) return [];

    return context.chat
        .map((msg, idx) => ({
            index: idx,
            summary: msg.extensions?.[extensionName]?.summary,
            timestamp: msg.extensions?.[extensionName]?.timestamp
        }))
        .filter(item => item.summary);
}

function buildMemoryInjection() {
    if (!getSettings('enabled')) {
        return '';
    }

    const summaries = getAllSummaries();
    if (summaries.length === 0) {
        return '';
    }

    const lag = getSettings('messageLag');
    const context = getContext();
    const maxIndex = context.chat.length - lag - 1;

    const relevantSummaries = summaries
        .filter(item => item.index <= maxIndex)
        .map(item => item.summary)
        .join('\n');

    if (!relevantSummaries) {
        return '';
    }

    const template = getSettings('memoryTemplate');
    return template.replace('{{memories}}', relevantSummaries);
}

// ============================================================================
// UI INTEGRATION
// ============================================================================

function addMessageButtons() {
    $(document).on('mouseenter', '.mes', function() {
        const messageId = $(this).attr('mesid');
        if (!messageId) return;

        const existingButton = $(this).find('.qvink_summarize_button');
        if (existingButton.length > 0) return;

        const context = getContext();
        const message = context.chat[parseInt(messageId)];
        if (!message) return;

        const hasSummary = message.extensions?.[extensionName]?.summary;
        const extraButtons = $(this).find('.extraMesButtons');

        if (extraButtons.length > 0) {
            const buttonHtml = `
                <div class="extraMesButton qvink_summarize_button" title="${hasSummary ? 'Edit summary' : 'Generate summary'}">
                    <i class="fa-solid fa-brain"></i>
                </div>
            `;

            extraButtons.prepend(buttonHtml);

            $(this).find('.qvink_summarize_button').on('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt($(e.target).closest('.mes').attr('mesid'));
                await summarizeMessage(idx);
            });
        }
    });
}

async function loadSettingsHTML() {
    try {
        const settingsHtml = await $.get(`scripts/extensions/third-party/${extensionName}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
        bindSettingsControls();
    } catch (error) {
        logError('Failed to load settings HTML', error);
    }
}

function bindSettingsControls() {
    $('#memory_summarize_enabled').prop('checked', getSettings('enabled')).on('change', function() {
        setSettings('enabled', $(this).prop('checked'));
    });

    $('#memory_summarize_auto').prop('checked', getSettings('autoSummarize')).on('change', function() {
        setSettings('autoSummarize', $(this).prop('checked'));
    });

    $('#memory_summarize_threshold').val(getSettings('messageThreshold')).on('input', function() {
        setSettings('messageThreshold', parseInt($(this).val()));
    });

    $('#memory_summarize_lag').val(getSettings('messageLag')).on('input', function() {
        setSettings('messageLag', parseInt($(this).val()));
    });

    $('#memory_summarize_prompt').val(getSettings('summaryPrompt')).on('input', function() {
        setSettings('summaryPrompt', $(this).val());
    });

    $('#memory_summarize_display').prop('checked', getSettings('displayMemories')).on('change', function() {
        setSettings('displayMemories', $(this).prop('checked'));
        updateAllMessageVisuals();
    });

    $('#memory_summarize_include_user').prop('checked', getSettings('includeUserMessages')).on('change', function() {
        setSettings('includeUserMessages', $(this).prop('checked'));
    });

    $('#memory_summarize_include_character').prop('checked', getSettings('includeCharacterMessages')).on('change', function() {
        setSettings('includeCharacterMessages', $(this).prop('checked'));
    });

    $('#memory_summarize_include_system').prop('checked', getSettings('includeSystemMessages')).on('change', function() {
        setSettings('includeSystemMessages', $(this).prop('checked'));
    });

    $('#memory_summarize_template').val(getSettings('memoryTemplate')).on('input', function() {
        setSettings('memoryTemplate', $(this).val());
    });

    $('#memory_summarize_debug').prop('checked', getSettings('debugMode')).on('change', function() {
        setSettings('debugMode', $(this).prop('checked'));
    });

    $('#memory_summarize_batch').prop('checked', getSettings('batchSummarize')).on('change', function() {
        setSettings('batchSummarize', $(this).prop('checked'));
    });

    $('#memory_summarize_all').on('click', async function() {
        const context = getContext();
        if (!context.chat) return;

        if (confirm(`Summarize all ${context.chat.length} messages? This may take a while.`)) {
            for (let i = 0; i < context.chat.length; i++) {
                await summarizeMessage(i);
            }
            toastr.success('All messages summarized', 'Memory Summarize');
        }
    });

    $('#memory_summarize_clear_all').on('click', async function() {
        if (confirm('Delete all summaries? This cannot be undone.')) {
            const context = getContext();
            context.chat.forEach(msg => {
                if (msg.extensions?.[extensionName]) {
                    delete msg.extensions[extensionName];
                }
            });
            await context.saveChat();
            updateAllMessageVisuals();
            toastr.success('All summaries cleared', 'Memory Summarize');
        }
    });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function setupEventHandlers() {
    eventSource.on(event_types.MESSAGE_RECEIVED, async (messageIndex) => {
        log('Message received:', messageIndex);
        updateMessageVisuals(messageIndex);
        await autoSummarize();
    });

    eventSource.on(event_types.MESSAGE_SENT, async (messageIndex) => {
        log('Message sent:', messageIndex);
        updateMessageVisuals(messageIndex);
        await autoSummarize();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        log('Chat changed');
        updateAllMessageVisuals();
    });

    eventSource.on(event_types.MESSAGE_EDITED, (messageIndex) => {
        log('Message edited:', messageIndex);
        updateMessageVisuals(messageIndex);
    });

    eventSource.on(event_types.MESSAGE_DELETED, (messageIndex) => {
        log('Message deleted:', messageIndex);
    });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

jQuery(async () => {
    try {
        log('Initializing Memory Summarize extension');

        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = { ...defaultSettings };
        }

        await loadSettingsHTML();
        setupEventHandlers();
        addMessageButtons();
        updateAllMessageVisuals();

        log('Memory Summarize extension initialized successfully');
        console.log(`[${extensionName}] Loaded successfully v2.0.0`);

    } catch (error) {
        logError('Failed to initialize extension', error);
        toastr.error('Failed to load Memory Summarize extension', 'Error');
    }
});

// Export for external access
export {
    summarizeMessage,
    deleteSummary,
    editSummary,
    getAllSummaries,
    buildMemoryInjection
};
