import { AppState, DEFAULT_STATE } from './types';

// Escuchar mensajes del content script para actualizar el badge
chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('[Word Locator] Mensaje recibido en background:', message.type);
  if (message.type === 'UPDATE_COUNT' && sender.tab?.id) {
    const count = message.count;
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: count > 0 ? count.toString() : '',
    });
    chrome.action.setBadgeBackgroundColor({
      tabId: sender.tab.id,
      color: '#EF4444', // Red-500
    });
  }
});

// Inicializar estado por defecto
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['appState'], (result) => {
    if (!result.appState) {
      chrome.storage.local.set({ appState: DEFAULT_STATE });
    }
  });
});
