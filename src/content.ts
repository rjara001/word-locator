import { AppState, Match } from './types';

console.error('[Word Locator] Content script cargado y ejecutándose');

let matches: Match[] = [];
let observer: MutationObserver | null = null;
let isProcessing = false;
let searchTimeout: number | null = null;
let currentAppState: AppState | null = null;

async function getAppState(): Promise<AppState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appState'], (result) => {
      const state = result.appState as AppState;
      if (state && state.targetWords && state.targetWords.length > 0 && typeof (state.targetWords[0] as any) === 'string') {
        // Normalizar formato antiguo
        state.targetWords = (state.targetWords as any).map((w: string) => ({
          text: w,
          enabled: true,
          color: state.highlightColor || '#ffff00'
        }));
      }
      resolve(state);
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
  
  return text.toLowerCase()
    .split('')
    .map(char => {
      if (accentMap[char]) return accentMap[char];
      if (/[.*+?^${}()|[\]\\]/.test(char)) return '\\' + char;
      if (/\s/.test(char)) return '\\s+';
      return char;
    })
    .join('')
    .replace(/(\\s\+)+/g, '\\s+');
}

function clearHighlights() {
  // 1. Limpiar resaltados anteriores de forma exhaustiva
  const existingContainers = document.querySelectorAll('.word-locator-container');
  existingContainers.forEach(container => {
    const parent = container.parentNode;
    if (parent) {
      while (container.firstChild) {
        parent.insertBefore(container.firstChild, container);
      }
      parent.removeChild(container);
    }
  });
  
  const existingMarks = document.querySelectorAll('.word-locator-highlight');
  existingMarks.forEach(mark => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    }
  });

  document.body.normalize();
}

function findMatches(state: AppState) {
  if (isProcessing) return;
  isProcessing = true;

  // Desconectar observador temporalmente
  if (observer) observer.disconnect();

  try {
    // LIMPIAR ANTES DE BUSCAR para evitar fragmentación de nodos de texto
    // Esto asegura que el contexto extraído sea lo más completo posible
    clearHighlights();

    log('Iniciando búsqueda con palabras:', state.targetWords);
    log('Estado de resaltado:', state.isHighlightEnabled);
    
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
      let textToSearch = '';
      let isEnabled = true;

      if (typeof word === 'string') {
        textToSearch = word;
      } else if (word && typeof word === 'object') {
        textToSearch = word.text;
        isEnabled = word.enabled;
      }

      if (!isEnabled) return;
      const trimmedWord = textToSearch.trim();
      if (!trimmedWord) return;
      
      const pattern = getAccentInsensitivePattern(trimmedWord);
      const regex = new RegExp(pattern, 'gi');
      
      let match;
      while ((match = regex.exec(text)) !== null) {
        const parent = node.parentElement;
        if (parent) {
          log(`Coincidencia encontrada para "${trimmedWord}" en nodo:`, text);
          
          // 1. Calcular la posición inicial de la coincidencia relativa al PADRE inmediato
          let matchIndexInContext = 0;
          for (const child of parent.childNodes) {
            if (child === node) break;
            matchIndexInContext += (child.textContent || '').length;
          }
          matchIndexInContext += match.index;
          
          let contextText = parent.textContent || '';
          let currentContextEl: HTMLElement | null = parent;
          const MIN_CONTEXT_LENGTH = 160;
          
          log(`Contexto inicial (padre): "${contextText}"`);
          log(`Index inicial en contexto: ${matchIndexInContext}`);
          
          // 2. Subir por el árbol DOM para ampliar el contexto si es necesario
          let depth = 0;
          while (currentContextEl && currentContextEl.tagName !== 'BODY' && contextText.length < MIN_CONTEXT_LENGTH && depth < 5) {
            const parentEl = currentContextEl.parentElement;
            if (!parentEl) break;
            
            let offset = 0;
            let found = false;
            for (const child of parentEl.childNodes) {
              if (child === currentContextEl) {
                found = true;
                break;
              }
              offset += (child.textContent || '').length;
            }
            
            if (found) {
              matchIndexInContext = offset + matchIndexInContext;
              contextText = parentEl.textContent || '';
              log(`Subiendo nivel ${depth + 1} (${parentEl.tagName}). Nuevo contexto: "${contextText.substring(0, 50)}..."`);
            } else {
              break;
            }

            const style = window.getComputedStyle(currentContextEl);
            if (style.display === 'block' || style.display === 'flex' || style.display === 'grid' || style.display === 'table-row') {
              log(`Deteniendo subida en elemento de bloque: ${currentContextEl.tagName}`);
              break;
            }
            
            currentContextEl = parentEl;
            depth++;
          }

          const finalContext = contextText.substring(
            Math.max(0, matchIndexInContext - 100), 
            Math.min(contextText.length, matchIndexInContext + match[0].length + 100)
          ).trim().replace(/\s+/g, ' ');

          log(`Contexto final extraído: "${finalContext}"`);

          newMatches.push({
            id: `match-${newMatches.length}`,
            text: textToSearch,
            context: finalContext,
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
  
  // La limpieza ya se hizo en findMatches o se hace aquí si se llama directamente
  clearHighlights();

  if (!state.isHighlightEnabled || state.targetWords.length === 0) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && (
        parent.tagName === 'SCRIPT' || 
        parent.tagName === 'STYLE' || 
        parent.classList.contains('word-locator-highlight') ||
        parent.classList.contains('word-locator-container')
      )) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes: Node[] = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  textNodes.forEach(textNode => {
    const text = textNode.textContent || '';
    let hasMatch = false;
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    state.targetWords.forEach(word => {
      let textToSearch = '';
      let isEnabled = true;
      let color = state.highlightColor || '#ffff00';

      if (typeof word === 'string') {
        textToSearch = word;
      } else if (word && typeof word === 'object') {
        textToSearch = word.text;
        isEnabled = word.enabled;
        color = word.color || color;
      }

      if (!isEnabled) return;
      const trimmedWord = textToSearch.trim();
      if (!trimmedWord) return;
      
      const pattern = getAccentInsensitivePattern(trimmedWord);
      const regex = new RegExp(`(${pattern})`, 'gi');
      
      if (regex.test(html)) {
        html = html.replace(regex, `<mark class="word-locator-highlight" style="background-color: ${color}; color: black; padding: 0 2px; border-radius: 2px; font-weight: bold; border-bottom: 1px solid rgba(0,0,0,0.2);">$1</mark>`);
        hasMatch = true;
      }
    });

    if (hasMatch) {
      const span = document.createElement('span');
      span.className = 'word-locator-container';
      span.innerHTML = html;
      textNode.parentNode?.replaceChild(span, textNode);
    }
  });
  log('Resaltado completado.');
}

function updateBadge(count: number) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    try {
      // No enviamos 'matches' al background porque no se usan allí y saturan el canal
      chrome.runtime.sendMessage({ type: 'UPDATE_COUNT', count });
    } catch (e) {
      // El contexto de la extensión podría haber sido invalidado (ej. recarga)
    }
  }
}

const debouncedFindMatches = debounce(() => {
  if (currentAppState && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    findMatches(currentAppState);
  }
}, 1500); // Aumentamos un poco el debounce para ser más gentiles con el navegador

// Escuchar mensajes del popup
if (typeof chrome !== 'undefined' && chrome.runtime) {
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
    console.error('[Word Locator] Mensaje STATE_CHANGED recibido en content script');
    getAppState().then(state => {
      currentAppState = state;
      console.error('[Word Locator] Estado actualizado en content script, iniciando búsqueda...', state);
      findMatches(state);
    });
  }
});
}

// Inicializar
try {
  getAppState().then(state => {
    currentAppState = state;
    log('Inicializando con estado:', state);
    findMatches(state);
    
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      debouncedFindMatches();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }).catch(err => {
    console.error('[Word Locator] Error en la inicialización (getAppState):', err);
  });
} catch (e) {
  console.error('[Word Locator] Error crítico en la inicialización:', e);
}
