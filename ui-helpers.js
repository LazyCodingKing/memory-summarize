/**
 * Memory Summarize v2.0 - UI Helper Functions
 * Functions for UI components, popups, and visual updates
 */

/**
 * Create default config HTML if template not found
 */
export function createDefaultConfigHTML() {
  return `
    <div class="memory-config-wrapper">
      <div class="memory-config-header">
        <div class="memory-config-title">
          <i class="fa-solid fa-brain"></i> Memory Summarize
        </div>
        <button class="memory-config-close" id="memory-close-btn">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      <div class="memory-config-content" style="padding: 20px;">
        <p>Configuration interface loading... If this persists, check console for errors.</p>
      </div>
    </div>
  `;
}

/**
 * Toggle config popup visibility
 */
export function toggleConfigPopup() {
  const popup = $('#memory-config-popup');
  popup.toggleClass('visible');
  
  if (popup.hasClass('visible')) {
    // Focus first input
    popup.find('input, select, textarea').first().focus();
  }
}

/**
 * Show progress bar with current status
 */
export function showProgress(current, total) {
  let progressContainer = $('.memory-progress-container');
  
  if (progressContainer.length === 0) {
    progressContainer = $(`
      <div class="memory-progress-container">
        <div class="memory-progress-title">
          <i class="fa-solid fa-spinner"></i>
          Summarizing Messages
        </div>
        <div class="memory-progress-bar">
          <div class="memory-progress-fill"></div>
        </div>
        <div class="memory-progress-text">0 / 0</div>
        <button class="memory-btn danger memory-progress-stop">
          <i class="fa-solid fa-stop"></i>
          Stop
        </button>
      </div>
    `);
    
    $('body').append(progressContainer);
    
    // Bind stop button
    progressContainer.find('.memory-progress-stop').on('click', () => {
      window.MemorySummarize?.stopProcessing?.();
    });
  }
  
  progressContainer.addClass('visible');
  
  const percentage = total > 0 ? (current / total) * 100 : 0;
  progressContainer.find('.memory-progress-fill').css('width', `${percentage}%`);
  progressContainer.find('.memory-progress-text').text(`${current} / ${total}`);
}

/**
 * Hide progress bar
 */
export function hideProgress() {
  $('.memory-progress-container').removeClass('visible');
  
  // Remove after animation
  setTimeout(() => {
    $('.memory-progress-container').remove();
  }, 300);
}

/**
 * Update memory display on all messages
 */
export function updateMemoryDisplay() {
  const context = SillyTavern.getContext();
  const chat = context.chat;
  
  if (!chat) return;
  
  // Remove existing memory displays
  $('.message-memory').remove();
  
  // Add memory displays to messages
  $('#chat').find('.mes').each(function(index) {
    const messageDiv = $(this);
    const memory = window.MemorySummarize?.getMemory?.(index);
    
    if (memory && window.MemorySummarize?.settings?.displayMemories) {
      const memoryDiv = createMemoryDisplay(memory, index);
      messageDiv.find('.mes_text').after(memoryDiv);
    }
  });
}

/**
 * Create memory display element
 */
function createMemoryDisplay(memory, messageIndex) {
  const statusClass = getMemoryStatusClass(memory);
  
  const memoryDiv = $(`
    <div class="message-memory ${statusClass}" data-message-index="${messageIndex}">
      <span class="memory-text">${escapeHtml(memory.summary)}</span>
      <div class="message-memory-actions">
        <button class="memory-action-btn memory-edit" title="Edit">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="memory-action-btn memory-toggle-lt" title="Toggle Long-Term">
          <i class="fa-solid fa-bookmark"></i>
        </button>
        <button class="memory-action-btn memory-regenerate" title="Regenerate">
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>
    </div>
  `);
  
  // Bind click handlers
  memoryDiv.find('.memory-edit').on('click', (e) => {
    e.stopPropagation();
    editMemory(messageIndex);
  });
  
  memoryDiv.find('.memory-toggle-lt').on('click', (e) => {
    e.stopPropagation();
    window.MemorySummarize?.toggleLongTermMemory?.(messageIndex);
  });
  
  memoryDiv.find('.memory-regenerate').on('click', (e) => {
    e.stopPropagation();
    window.MemorySummarize?.summarizeMessage?.(messageIndex);
  });
  
  // Click on memory text to edit
  memoryDiv.find('.memory-text').on('click', () => {
    editMemory(messageIndex);
  });
  
  return memoryDiv;
}

/**
 * Get CSS class for memory status
 */
function getMemoryStatusClass(memory) {
  if (memory.manuallyExcluded) return 'excluded';
  if (memory.isLongTerm) return 'long-term';
  
  // Check if in short-term or out of context
  const shortTermMemories = window.MemorySummarize?.getShortTermMemories?.() || [];
  const isInShortTerm = shortTermMemories.some(m => m.messageId === memory.messageId);
  
  if (isInShortTerm) return 'short-term';
  
  return 'default';
}

/**
 * Edit memory inline
 */
function editMemory(messageIndex) {
  const memory = window.MemorySummarize?.getMemory?.(messageIndex);
  if (!memory) return;
  
  const currentText = memory.summary;
  
  // Show inline editor
  const newText = prompt('Edit memory summary:', currentText);
  
  if (newText !== null && newText !== currentText) {
    memory.summary = newText;
    window.MemorySummarize?.saveMemories?.();
    updateMemoryDisplay();
    
    toastr.success('Memory updated');
  }
}

/**
 * Bind settings to UI elements
 */
export function bindSettingsToUI() {
  const settings = window.MemorySummarize?.settings;
  if (!settings) return;
  
  // Bind all inputs to settings
  $('#memory-enabled').prop('checked', settings.enabled).on('change', function() {
    settings.enabled = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-enable-new-chats').prop('checked', settings.enableInNewChats).on('change', function() {
    settings.enableInNewChats = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-global-toggle').prop('checked', settings.useGlobalToggleState).on('change', function() {
    settings.useGlobalToggleState = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-short-term-limit').val(settings.shortTermLimit).on('change', function() {
    settings.shortTermLimit = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-long-term-limit').val(settings.longTermLimit).on('change', function() {
    settings.longTermLimit = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-message-threshold').val(settings.messageThreshold).on('change', function() {
    settings.messageThreshold = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-summary-prompt').val(settings.summaryPrompt).on('change', function() {
    settings.summaryPrompt = $(this).val();
    saveSettingsDebounced();
  });
  
  $('#memory-max-tokens').val(settings.summaryMaxTokens).on('change', function() {
    settings.summaryMaxTokens = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-temperature').val(settings.summaryTemperature).on('change', function() {
    settings.summaryTemperature = parseFloat($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-separate-preset').prop('checked', settings.useSeparatePreset).on('change', function() {
    settings.useSeparatePreset = $(this).prop('checked');
    $('#memory-preset-name-row').toggle(settings.useSeparatePreset);
    saveSettingsDebounced();
  });
  
  $('#memory-preset-name').val(settings.presetName).on('change', function() {
    settings.presetName = $(this).val();
    saveSettingsDebounced();
  });
  
  $('#memory-batch-size').val(settings.batchSize).on('change', function() {
    settings.batchSize = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-message-lag').val(settings.messageLag).on('change', function() {
    settings.messageLag = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-delay').val(settings.delayBetweenSummaries).on('change', function() {
    settings.delayBetweenSummaries = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-auto-summarize').prop('checked', settings.autoSummarize).on('change', function() {
    settings.autoSummarize = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-timing').val(settings.summarizeTiming).on('change', function() {
    settings.summarizeTiming = $(this).val();
    saveSettingsDebounced();
  });
  
  $('#memory-smart-batch').prop('checked', settings.smartBatching).on('change', function() {
    settings.smartBatching = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-inject-after').val(settings.startInjectingAfter).on('change', function() {
    settings.startInjectingAfter = parseInt($(this).val());
    saveSettingsDebounced();
  });
  
  $('#memory-remove-messages').prop('checked', settings.removeMessagesAfterThreshold).on('change', function() {
    settings.removeMessagesAfterThreshold = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-static-mode').prop('checked', settings.staticMemoryMode).on('change', function() {
    settings.staticMemoryMode = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-context-aware').prop('checked', settings.contextAwareInjection).on('change', function() {
    settings.contextAwareInjection = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-short-position').val(settings.shortTermInjectionPosition).on('change', function() {
    settings.shortTermInjectionPosition = $(this).val();
    saveSettingsDebounced();
  });
  
  $('#memory-long-position').val(settings.longTermInjectionPosition).on('change', function() {
    settings.longTermInjectionPosition = $(this).val();
    saveSettingsDebounced();
  });
  
  $('#memory-include-char').prop('checked', settings.includeCharacterMessages).on('change', function() {
    settings.includeCharacterMessages = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-include-user').prop('checked', settings.includeUserMessages).on('change', function() {
    settings.includeUserMessages = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-include-system').prop('checked', settings.includeSystemMessages).on('change', function() {
    settings.includeSystemMessages = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-include-hidden').prop('checked', settings.includeHiddenMessages).on('change', function() {
    settings.includeHiddenMessages = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-display').prop('checked', settings.displayMemories).on('change', function() {
    settings.displayMemories = $(this).prop('checked');
    updateMemoryDisplay();
    saveSettingsDebounced();
  });
  
  $('#memory-color-short').val(settings.colorShortTerm).on('change', function() {
    settings.colorShortTerm = $(this).val();
    applyCSSVariables();
    saveSettingsDebounced();
  });
  
  $('#memory-color-long').val(settings.colorLongTerm).on('change', function() {
    settings.colorLongTerm = $(this).val();
    applyCSSVariables();
    saveSettingsDebounced();
  });
  
  $('#memory-color-old').val(settings.colorOutOfContext).on('change', function() {
    settings.colorOutOfContext = $(this).val();
    applyCSSVariables();
    saveSettingsDebounced();
  });
  
  $('#memory-color-excluded').val(settings.colorExcluded).on('change', function() {
    settings.colorExcluded = $(this).val();
    applyCSSVariables();
    saveSettingsDebounced();
  });
  
  $('#memory-debug').prop('checked', settings.debugMode).on('change', function() {
    settings.debugMode = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  $('#memory-incremental').prop('checked', settings.incrementalUpdates).on('change', function() {
    settings.incrementalUpdates = $(this).prop('checked');
    saveSettingsDebounced();
  });
  
  // Bind button actions
  bindButtonActions();
  
  // Bind tab switching
  bindTabSwitching();
}

/**
 * Bind button click handlers
 */
function bindButtonActions() {
  $('#memory-close-btn, #memory-cancel-btn').on('click', () => {
    $('#memory-config-popup').removeClass('visible');
  });
  
  $('#memory-save-btn').on('click', () => {
    saveSettingsDebounced();
    toastr.success('Settings saved!');
    $('#memory-config-popup').removeClass('visible');
  });
  
  $('#memory-summarize-all').on('click', async () => {
    if (confirm('Summarize all messages in this chat? This may take a while.')) {
      await window.MemorySummarize?.triggerAutoSummarization?.();
    }
  });
  
  $('#memory-clear-all').on('click', async () => {
    if (confirm('Delete all memories in this chat? This cannot be undone.')) {
      window.MemorySummarize?.memoryCache?.clear();
      await window.MemorySummarize?.saveMemories?.();
      updateMemoryDisplay();
      toastr.success('All memories cleared');
    }
  });
  
  $('#memory-reset-prompt').on('click', () => {
    const defaultPrompt = 'Summarize the following message concisely in 1-2 sentences:\n\n{{message}}';
    $('#memory-summary-prompt').val(defaultPrompt);
    window.MemorySummarize.settings.summaryPrompt = defaultPrompt;
    saveSettingsDebounced();
    toastr.info('Prompt reset to default');
  });
  
  $('#memory-open-console').on('click', () => {
    console.log('Opening developer console...');
    // Most browsers open console with F12, can't do it programmatically
    alert('Press F12 to open the developer console');
  });
}

/**
 * Bind tab switching
 */
function bindTabSwitching() {
  $('.memory-config-tab').on('click', function() {
    const tabName = $(this).data('tab');
    
    // Update tab buttons
    $('.memory-config-tab').removeClass('active');
    $(this).addClass('active');
    
    // Update sections
    $('.memory-config-section').removeClass('active');
    $(`.memory-config-section[data-section="${tabName}"]`).addClass('active');
  });
}

/**
 * Apply CSS variables for colors
 */
export function applyCSSVariables() {
  const settings = window.MemorySummarize?.settings;
  if (!settings) return;
  
  const root = document.documentElement;
  root.style.setProperty('--qm-short', settings.colorShortTerm);
  root.style.setProperty('--qm-long', settings.colorLongTerm);
  root.style.setProperty('--qm-old', settings.colorOutOfContext);
  root.style.setProperty('--qm-excluded', settings.colorExcluded);
}

/**
 * Handle settings updated from other sources
 */
export function handleSettingsUpdated() {
  // Refresh UI to match current settings
  bindSettingsToUI();
  applyCSSVariables();
  updateMemoryDisplay();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Debounced settings save
 */
let saveTimeout;
function saveSettingsDebounced() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    import('../../../script.js').then(module => {
      module.saveSettingsDebounced();
    });
  }, 500);
}
