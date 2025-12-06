import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'memory_summarize';

// Settings structure
const default_settings = {
  enabled: true,
  auto_summarize: true,
  summary_length: 'medium',
  max_history: 50,
  update_interval: 5,
  api_endpoint: '',
  api_key: '',
};

let settings = structuredClone(default_settings);

function log(message) {
  console.log(`[${MODULE_NAME}]`, message);
}

function debug(message) {
  if (settings.debug) {
    log(`[DEBUG] ${message}`);
  }
}

function error(message) {
  console.error(`[${MODULE_NAME}]`, message);
}

// Initialize extension settings
function initialize_settings() {
  if (extension_settings[MODULE_NAME] === undefined) {
    extension_settings[MODULE_NAME] = structuredClone(default_settings);
  }
  settings = extension_settings[MODULE_NAME];
  log('Settings initialized');
}

// Save settings
function save_settings() {
  Object.assign(extension_settings[MODULE_NAME], settings);
  saveSettingsDebounced();
}

// Load settings.html
async function load_settings_html() {
  try {
    const url = import.meta.url;
    const extension_dir = url.substring(0, url.lastIndexOf('/'));
    const settings_path = `${extension_dir}/settings.html`;
    
    const response = await fetch(settings_path);
    if (response.ok) {
      const html = await response.text();
      $('#extensions_settings2').append(html);
      log('Settings UI loaded');
      setup_settings_ui();
    } else {
      error(`Failed to load settings.html: ${response.status}`);
    }
  } catch (err) {
    error(`Error loading settings: ${err.message}`);
  }
}

// Setup settings UI bindings
function setup_settings_ui() {
  // Enable checkbox
  $(document).on('change', '#ms-enabled', function() {
    settings.enabled = this.checked;
    save_settings();
    update_status(settings.enabled ? 'Enabled' : 'Disabled');
  });

  // Auto-summarize checkbox
  $(document).on('change', '#ms-auto-summarize', function() {
    settings.auto_summarize = this.checked;
    save_settings();
    update_status(settings.auto_summarize ? 'Auto-summarize enabled' : 'Auto-summarize disabled');
  });

  // Summary length select
  $(document).on('change', '#ms-length', function() {
    settings.summary_length = $(this).val();
    save_settings();
    update_status('Summary length updated');
  });

  // Summarize button
  $(document).on('click', '#ms-summarize-btn', async function() {
    $(this).prop('disabled', true);
    update_status('Summarizing...');
    try {
      const summary = await summarize_memory();
      if (summary) {
        update_status('Summary complete');
        log(`Generated summary: ${summary.substring(0, 50)}...`);
      } else {
        update_status('No content to summarize');
      }
    } catch (err) {
      error(`Summarization failed: ${err.message}`);
      update_status('Error during summarization');
    } finally {
      $(this).prop('disabled', false);
    }
  });

  // Reset button
  $(document).on('click', '#ms-reset-btn', function() {
    memory_buffer = [];
    last_summary_time = 0;
    update_status('Memory buffer reset');
    update_display();
  });

  // Set initial values
  $('#ms-enabled').prop('checked', settings.enabled);
  $('#ms-auto-summarize').prop('checked', settings.auto_summarize);
  $('#ms-length').val(settings.summary_length);
}

// Memory buffer
let memory_buffer = [];
let last_summary_time = 0;

// Simple summarizer
async function summarize_memory() {
  if (memory_buffer.length === 0) {
    return null;
  }

  const text = memory_buffer
    .map(msg => `${msg.speaker}: ${msg.text}`)
    .join('\n');

  // Simple extractive summarization
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return text;

  const ratio = settings.summary_length === 'short' ? 0.3 : 
                settings.summary_length === 'medium' ? 0.5 : 0.7;
  const numSentences = Math.max(1, Math.ceil(sentences.length * ratio));

  const summary = sentences
    .slice(0, numSentences)
    .map(s => s.trim())
    .join('. ') + '.';

  last_summary_time = Date.now();
  memory_buffer = [];
  update_display();

  return summary;
}

function update_status(message) {
  $('#ms-status-text').text(message);
}

function update_display() {
  $('#ms-buffer-count').text(memory_buffer.length);
  if (last_summary_time > 0) {
    const time = new Date(last_summary_time).toLocaleTimeString();
    $('#ms-last-summary').text(time);
  } else {
    $('#ms-last-summary').text('Never');
  }
}

// Listen for messages
function setup_event_listeners() {
  if (!window.eventSource) {
    setTimeout(setup_event_listeners, 1000);
    return;
  }

  // Listen for new messages
  window.eventSource.addEventListener('message_received', (event) => {
    if (!settings.enabled) return;
    
    try {
      const message = event.detail;
      if (!message || !message.text) return;

      memory_buffer.push({
        timestamp: Date.now(),
        text: message.text,
        speaker: message.name || 'Unknown',
      });

      update_display();

      // Auto-summarize if conditions are met
      if (settings.auto_summarize && memory_buffer.length >= settings.max_history) {
        const timeSinceLastSummary = (Date.now() - last_summary_time) / 1000 / 60; // minutes
        if (timeSinceLastSummary >= settings.update_interval || last_summary_time === 0) {
          summarize_memory();
          log('Auto-summarize triggered');
        }
      }
    } catch (err) {
      error(`Error processing message: ${err.message}`);
    }
  });

  log('Event listeners registered');
}

// Hook for loading settings on extension enable
function hook_settings() {
  // This will be called when extension is activated
  $('#extensions_settings2').find(`[data-id="${MODULE_NAME}"]`).each(function() {
    load_settings_html();
  });
}

// Main initialization
export async function setup() {
  try {
    log('Setting up extension...');
    
    initialize_settings();
    setup_event_listeners();
    
    // Load settings when extension settings are shown
    $(document).on('click', '#extensions', function() {
      // Delayed to ensure DOM is ready
      setTimeout(load_settings_html, 100);
    });

    log('Extension setup complete');
  } catch (err) {
    error(`Setup failed: ${err.message}`);
  }
}

// Module exports

