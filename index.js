/**
 * Memory Summarize v2.0 - Main Extension File
 * Fixed & Merged for SillyTavern
 */

// Get SillyTavern context API
const { eventSource, event_types, saveSettingsDebounced } = SillyTavern.getContext();
const { extension_settings } = SillyTavern.getContext();

// Extension metadata
const extensionName = 'memory-summarize';
const extensionFolderPath = `third-party/${extensionName}`;

// Default settings
const defaultSettings = {
    enabled: true,
    autoSummarize: true,
    summarizeTiming: 'after_generation',
    shortTermLimit: 2000,
    longTermLimit: 4000,
    messageThreshold: 50,
    summaryPrompt: 'Summarize the following message concisely in 1-2 sentences:\n\n{{message}}',
    summaryMaxTokens: 150,
    summaryTemperature: 0.1,
    useSeparatePreset: false,
    presetName: '',
    batchSize: 5,
    delayBetweenSummaries: 1000,
    messageLag: 0,
    displayMemories: true,
    colorShortTerm: '#22c55e',
    colorLongTerm: '#3b82f6',
    colorOutOfContext: '#ef4444',
    colorExcluded: '#9ca3af',
    startInjectingAfter: 3,
    removeMessagesAfterThreshold: false,
    staticMemoryMode: false,
    includeCharacterMessages: true,
    includeUserMessages: false,
    includeHiddenMessages: false,
    includeSystemMessages: false,
    shortTermInjectionPosition: 'after_scenario',
    longTermInjectionPosition: 'after_scenario',
    debugMode: false,
    enableInNewChats: true,
    useGlobalToggleState: false,
    incrementalUpdates: true,
    smartBatching: true,
    contextAwareInjection: true,
    profiles: {},
    activeProfile: 'default'
};

// Extension state
let settings = { ...defaultSettings };
let memoryCache = new Map();

/**
 * Initialize extension
 */
async function init() {
    console.log(`[${extensionName}] Starting initialization...`);

    try {
        // Initialize settings
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = { ...defaultSettings };
        }
        settings = extension_settings[extensionName];

        console.log(`[${extensionName}] Settings loaded`);

        // Apply CSS variables
        applyCSSVariables();

        // Setup UI
        await setupUI();

        // Register event listeners
        registerEventListeners();

        // Register slash commands
        registerSlashCommands();

        // Trigger an initial memory display update
        updateMemoryDisplay();

        console.log(`[${extensionName}] ✅ Initialization complete`);
    } catch (err) {
        console.error(`[${extensionName}] Fatal initialization error:`, err);
    }
}

/**
 * Setup UI elements
 */
async function setupUI() {
    try {
        console.log(`[${extensionName}] Setting up UI...`);

        // Add extension button to top bar
        const button = $(`<div id="memory-summarize-button" class="list-group-item flex-container flex-gap-10" title="Memory Summarize v2.0"><i class="fa-solid fa-brain"></i> Memory Summarize</div>`);
        button.on('click', () => toggleConfigPopup());
        
        // Check if we should append to the extensions menu or create a new one
        // Standard ST extensions usually append a button in the extensions menu
        $('#extensions_settings').append(button);
        
        // Also add a quick access icon if desired, or stick to the menu
        const quickButton = $(`<i id="memory-summarize-icon" class="fa-solid fa-brain" title="Memory Summarize" style="cursor:pointer; margin: 0 5px;"></i>`);
        quickButton.on('click', () => toggleConfigPopup());
        $('#extensionsMenu').append(quickButton);

        // Load config HTML
        let configHTML = '';
        try {
            const response = await fetch(`${extensionFolderPath}/config.html`);
            if (response.ok) {
                configHTML = await response.text();
            } else {
                throw new Error('Config file not found');
            }
        } catch (fetchErr) {
            console.warn(`[${extensionName}] Failed to load config.html, using fallback.`);
            configHTML = createDefaultConfigHTML();
        }

        // Create popup container
        const popupHTML = `
            <div id="memory-config-popup" class="memory-config-popup">
                 ${configHTML}
            </div>`;

        $('body').append(popupHTML);

        // Bind all the UI actions from the helpers
        bindSettingsToUI();
        bindButtonActions();
        bindTabSwitching();

        console.log(`[${extensionName}] UI setup complete`);
    } catch (err) {
        console.error(`[${extensionName}] UI Setup Error:`, err);
    }
}

/**
 * Register event listeners
 */
function registerEventListeners() {
    if (!eventSource || !event_types) return;

    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
        if (settings.enabled && settings.autoSummarize) {
            // Placeholder for processing logic
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        updateMemoryDisplay();
    });
}

/**
 * Register slash commands
 */
function registerSlashCommands() {
    if (window.SlashCommandParser) {
        window.SlashCommandParser.addCommand('memsum', async (args) => {
            return 'Memory summarization triggered (Logic Pending)';
        }, [], 'Manually trigger memory summarization');
    }
}

/**
 * Toggle config popup visibility
 */
function toggleConfigPopup() {
    const popup = $('#memory-config-popup');
    popup.toggleClass('visible');
    
    // Refresh UI state when opening
    if (popup.hasClass('visible')) {
        bindSettingsToUI();
    }
}

/* ==================== UI HELPER FUNCTIONS (Merged) ==================== */

function bindSettingsToUI() {
    // Bind all inputs to settings object
    $('#memory-enabled').prop('checked', settings.enabled).off('change').on('change', function() {
        settings.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#memory-enable-new-chats').prop('checked', settings.enableInNewChats).off('change').on('change', function() {
        settings.enableInNewChats = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#memory-short-term-limit').val(settings.shortTermLimit).off('change').on('change', function() {
        settings.shortTermLimit = parseInt($(this).val());
        saveSettingsDebounced();
    });

    $('#memory-summary-prompt').val(settings.summaryPrompt).off('change').on('change', function() {
        settings.summaryPrompt = $(this).val();
        saveSettingsDebounced();
    });

    // Display Tab
    $('#memory-display').prop('checked', settings.displayMemories).off('change').on('change', function() {
        settings.displayMemories = $(this).prop('checked');
        updateMemoryDisplay();
        saveSettingsDebounced();
    });

    // Colors
    $('#memory-color-short').val(settings.colorShortTerm).off('change').on('change', function() {
        settings.colorShortTerm = $(this).val();
        applyCSSVariables();
        saveSettingsDebounced();
    });
    
    // ... (Add other bindings as needed based on config.html IDs)
}

function bindButtonActions() {
    $('#memory-close-btn, #memory-cancel-btn').on('click', () => {
        $('#memory-config-popup').removeClass('visible');
    });

    $('#memory-save-btn').on('click', () => {
        saveSettingsDebounced();
        if (typeof toastr !== 'undefined') toastr.success('Settings saved!');
        $('#memory-config-popup').removeClass('visible');
    });

    $('#memory-reset-prompt').on('click', () => {
        const defaultPrompt = defaultSettings.summaryPrompt;
        $('#memory-summary-prompt').val(defaultPrompt);
        settings.summaryPrompt = defaultPrompt;
        saveSettingsDebounced();
    });
}

function bindTabSwitching() {
    $('.memory-config-tab').on('click', function() {
        const tabName = $(this).data('tab');
        $('.memory-config-tab').removeClass('active');
        $(this).addClass('active');
        $('.memory-config-section').removeClass('active');
        $(`.memory-config-section[data-section="${tabName}"]`).addClass('active');
    });
}

function applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', settings.colorShortTerm);
    root.style.setProperty('--qm-long', settings.colorLongTerm);
    root.style.setProperty('--qm-old', settings.colorOutOfContext);
    root.style.setProperty('--qm-excluded', settings.colorExcluded);
}

function updateMemoryDisplay() {
    // Basic placeholder for the visual display logic
    // In a full version, this would iterate over chat messages and append the summary divs
    if (!settings.displayMemories) {
        $('.message-memory').remove();
        return;
    }
}

function createDefaultConfigHTML() {
    return `<div style="padding:20px; color:white;">Config file could not be loaded. Please check extension installation.</div>`;
}

// Export for debugging/global access (Fixed capitalization)
window.memorySummarize = {
    settings,
    memoryCache,
    init,
    toggleConfigPopup
};

// Initialize when jQuery is ready
jQuery(async () => {
    await init();
});
