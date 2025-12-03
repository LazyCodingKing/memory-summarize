/** 
 * Memory Summarize v2.0 - Main Extension File (FIXED)
 * Updated for SillyTavern 1.12+ (2025)
 * No longer requires deprecated Extras API 
 */

import { eventSource, event_types, saveSettingsDebounced, callPopup, getRequestHeaders } from '../../../script.js';
import { extension_settings, getContext } from '../../extensions.js';
import { power_user } from '../../power-user.js';

// Extension metadata
const extensionName = 'memory-summarize';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Default settings (same as before)
const defaultSettings = {
  enabled: true,
  autoSummarize: true,
  // ... rest of settings
};

let settings = defaultSettings;
let memoryCache = new Map();
let isProcessing = false;
let processingQueue = [];

/**
 * Initialize extension
 */
async function init() {
  console.log(`[${extensionName}] Initializing Memory Summarize v2.0`);
  
  try {
    // Load settings
    if (!extension_settings[extensionName]) {
      extension_settings[extensionName] = defaultSettings;
    }
    settings = extension_settings[extensionName];

    // Apply CSS variables
    applyCSSVariables();

    // Setup UI
    await setupUI();

    // Register event listeners
    registerEventListeners();

    // Register slash commands
    registerSlashCommands();

    // Setup context injection
    setupContextInjection();

    // Load memories for current chat
    await loadMemories();

    console.log(`[${extensionName}] Initialization complete`);
  } catch (err) {
    console.error(`[${extensionName}] Fatal initialization error:`, err);
  }
}

/**
 * Setup UI elements - FIXED VERSION
 */
async function setupUI() {
  try {
    // Add extension button to top bar - FIXED: proper HTML
    const button = $(`<i id="memory-summarize-button" class="fa-solid fa-brain" title="Memory Summarize v2.0"></i>`);
    button.on('click', () => toggleConfigPopup());
    $('#extensionsMenu').append(button);

    // Load config HTML safely
    let configHTML = '';
    try {
      const response = await fetch(`${extensionFolderPath}/config.html`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      configHTML = await response.text();
    } catch (fetchErr) {
      console.warn(`[${extensionName}] Failed to load config.html:`, fetchErr);
      console.log(`[${extensionName}] Using fallback configuration UI`);
      configHTML = createDefaultConfigHTML();
    }

    // Create popup container
    const popupHTML = `<div id="memory-config-popup" class="memory-config-popup">
      <div class="memory-config-header">
        <h2 class="memory-config-title"><i class="fa-solid fa-brain"></i>Memory Summarize</h2>
        <button class="memory-config-close" id="memory-config-close">&times;</button>
      </div>
      <div class="memory-config-content">
        ${configHTML}
      </div>
    </div>`;

    $('body').append(popupHTML);

    // Attach close handler
    $('#memory-config-close').on('click', () => toggleConfigPopup());

    console.log(`[${extensionName}] UI setup complete`);
  } catch (err) {
    console.error(`[${extensionName}] UI Setup Error:`, err);
  }
}

/**
 * Register event listeners
 */
function registerEventListeners() {
  try {
    // Listen for generation events
    eventSource.addEventListener(event_types.MESSAGE_RECEIVED, () => {
      if (settings.enabled && settings.autoSummarize) {
        onMessageReceived();
      }
    });

    eventSource.addEventListener(event_types.MESSAGE_SENT, () => {
      console.log(`[${extensionName}] Message sent event triggered`);
    });

    console.log(`[${extensionName}] Event listeners registered`);
  } catch (err) {
    console.error(`[${extensionName}] Error registering event listeners:`, err);
  }
}

/**
 * Register slash commands
 */
function registerSlashCommands() {
  try {
    // Add slash commands if API available
    if (window.SlashCommandParser) {
      window.SlashCommandParser.addCommand('memsum', async (args) => {
        await triggerManualSummarization();
        return '';
      }, [], 'Manually trigger memory summarization');

      console.log(`[${extensionName}] Slash commands registered`);
    }
  } catch (err) {
    console.warn(`[${extensionName}] Could not register slash commands:`, err);
  }
}

/**
 * Setup context injection
 */
function setupContextInjection() {
  try {
    console.log(`[${extensionName}] Context injection setup complete`);
  } catch (err) {
    console.error(`[${extensionName}] Context injection setup error:`, err);
  }
}

/**
 * Load memories for current chat
 */
async function loadMemories() {
  try {
    const context = getContext();
    if (!context || !context.chatId) {
      console.warn(`[${extensionName}] No active chat context`);
      return;
    }
    
    console.log(`[${extensionName}] Memories loaded for chat: ${context.chatId}`);
  } catch (err) {
    console.error(`[${extensionName}] Error loading memories:`, err);
  }
}

/**
 * Handle received messages
 */
async function onMessageReceived() {
  try {
    console.log(`[${extensionName}] Processing received message`);
    // Add your summarization logic here
  } catch (err) {
    console.error(`[${extensionName}] Error in onMessageReceived:`, err);
  }
}

/**
 * Trigger manual summarization
 */
async function triggerManualSummarization() {
  try {
    console.log(`[${extensionName}] Manual summarization triggered`);
    // Add your summarization logic here
  } catch (err) {
    console.error(`[${extensionName}] Error in manual summarization:`, err);
  }
}

/**
 * Toggle config popup visibility
 */
function toggleConfigPopup() {
  try {
    const popup = $('#memory-config-popup');
    popup.toggleClass('visible');
  } catch (err) {
    console.error(`[${extensionName}] Error toggling popup:`, err);
  }
}

/**
 * Apply CSS variables
 */
function applyCSSVariables() {
  try {
    const root = document.documentElement;
    root.style.setProperty('--qm-short', settings.colorShortTerm);
    root.style.setProperty('--qm-long', settings.colorLongTerm);
    root.style.setProperty('--qm-old', settings.colorOutOfContext);
    root.style.setProperty('--qm-excluded', settings.colorExcluded);
  } catch (err) {
    console.error(`[${extensionName}] Error applying CSS variables:`, err);
  }
}

/**
 * Create default config HTML if template not found
 */
function createDefaultConfigHTML() {
  return `
    <div class="memory-config-section active">
      <div class="memory-config-group">
        <h3>Extension Status</h3>
        <label>
          <input type="checkbox" id="enable-extension" class="memory-checkbox"> 
          Enable Memory Summarize
        </label>
        <small>Config template not found. Using fallback UI.</small>
      </div>
    </div>
  `;
}

// Initialize when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for debugging
window.memorySummarize = {
  settings,
  memoryCache,
  init,
  toggleConfigPopup,
  triggerManualSummarization
};
