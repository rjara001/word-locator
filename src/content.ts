import { AppState, Match } from './types';

let matches: Match[] = [];
let observer: MutationObserver | null = null;
let isProcessing = false;
let searchTimeout: number | null = null;

async function getAppState(): Promise<AppState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appState'], (result) => {
      resolve(result.appState as AppState);
    });
  });
}

function log(message: string, data?: any) {
  console.log(`[Word Locator] ${message}`, data || '');
}

function debounce(func: Function, wait: number) {
  return (...args: any[]) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => func(...args), wait);
  };
}

function getAccentInsensitivePattern(text: string): string {
  const accentMap: { [key: string]: string } = {
    'a': '[aáàâäãå]',
    'e': '[eéèêë]',
    'i': '[iíìîï]',
    'o': '[oóòôöõ]',
    'u': '[uúùûü]',
    'c': '[cç]',
    'n': '[nñ]'
  };
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
  const withFlexibleSpaces = escaped.replace(/\s+/g, '\\s+');
  return withFlexibleSpaces.split('').map(char => accentMap[char] || char).join('');
}

function findMatches(state: AppState) {
  if (isProcessing) return;
  isProcessing = true;

  // Desconectar observador temporalmente para evitar bucles infinitos por nuestras propias modificaciones
  if (observer) observer.disconnect();

  try {
    log('Iniciando búsqueda con palabras:', state.targetWords);
    
    if (state.targetWords.length === 0) {
      log('No hay palabras para buscar.');
      matches = [];
      updateBadge(0);
      return;
    }

    const newMatches: Match[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        // Solo rechazamos scripts y estilos. Permitimos buscar dentro de nuestros propios resaltados.
        if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      state.targetWords.forEach((word) => {
        const trimmedWord = word.trim();
        if (!trimmedWord) return;
        
        const pattern = getAccentInsensitivePattern(trimmedWord);
        const regex = new RegExp(pattern, 'gi');
        
        let match;
        while ((match = regex.exec(text)) !== null) {
          const parent = node.parentElement;
          if (parent) {
            newMatches.push({
              id: `match-${newMatches.length}`,
              text: word,
              context: text.substring(Math.max(0, match.index - 30), Math.min(text.length, match.index + match[0].length + 30)),
              selector: getUniqueSelector(parent),
              index: match.index
            });
          }
        }
      });
    }

    log(`Búsqueda finalizada. Encontradas ${newMatches.length} coincidencias.`);
    matches = newMatches;
    updateBadge(matches.length);
    
    // Solo aplicamos resaltados si no estamos ya en medio de uno (aunque isProcessing ya lo cubre)
    if (state.isHighlightEnabled) {
      applyHighlights(state);
    }
  } catch (error) {
    console.error('[Word Locator] Error durante la búsqueda:', error);
  } finally {
    isProcessing = false;
    // Reconectar observador
    if (observer) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
}

function getUniqueSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const path = [];
  let current: HTMLElement | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();
    if (current.id) {
      selector += `#${CSS.escape(current.id)}`;
      path.unshift(selector);
      break;
    } else {
      let sib: Element | null = current;
      let nth = 1;
      while (sib = sib.previousElementSibling) {
        if (sib.nodeName.toLowerCase() == selector) nth++;
      }
      if (nth != 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

function applyHighlights(state: AppState) {
  log('Aplicando resaltado...');
  
  const existingHighlights = document.querySelectorAll('.word-locator-highlight');
  existingHighlights.forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });

  if (!state.isHighlightEnabled || state.targetWords.length === 0) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.classList.contains('word-locator-highlight'))) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  textNodes.forEach(textNode => {
    const text = textNode.textContent || '';
    let hasMatch = false;
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    state.targetWords.forEach(word => {
      const trimmedWord = word.trim();
      if (!trimmedWord) return;
      
      const pattern = getAccentInsensitivePattern(trimmedWord);
      const regex = new RegExp(`(${pattern})`, 'gi');
      
      if (regex.test(html)) {
        html = html.replace(regex, `<mark class="word-locator-highlight" style="background-color: ${state.highlightColor}; color: black; padding: 0 2px; border-radius: 2px; font-weight: bold; border-bottom: 1px solid rgba(0,0,0,0.2);">$1</mark>`);
        hasMatch = true;
      }
    });

    if (hasMatch) {
      const span = document.createElement('span');
      span.innerHTML = html;
      textNode.parentNode?.replaceChild(span, textNode);
    }
  });
  log('Resaltado completado.');
}

function updateBadge(count: number) {
  chrome.runtime.sendMessage({ type: 'UPDATE_COUNT', count, matches });
}

const debouncedFindMatches = debounce((state: AppState) => {
  findMatches(state);
}, 1000); // Esperar 1 segundo de inactividad antes de buscar

// Escuchar mensajes del popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_MATCHES') {
    sendResponse({ matches });
  } else if (message.type === 'SCROLL_TO') {
    try {
      const el = document.querySelector(message.selector) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '3px solid #EF4444';
        setTimeout(() => el.style.outline = '', 2000);
      }
    } catch (e) {
      console.error('[Word Locator] Error al hacer scroll:', e);
    }
  } else if (message.type === 'STATE_CHANGED') {
    getAppState().then(findMatches);
  }
});

// Inicializar
getAppState().then(state => {
  findMatches(state);
  
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    debouncedFindMatches(state);
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
