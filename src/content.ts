import { AppState, Match } from './types';

let matches: Match[] = [];
let observer: MutationObserver | null = null;

async function getAppState(): Promise<AppState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appState'], (result) => {
      resolve(result.appState as AppState);
    });
  });
}

function findMatches(state: AppState) {
  if (state.targetWords.length === 0) {
    matches = [];
    updateBadge(0);
    return;
  }

  const newMatches: Match[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent || '';
    state.targetWords.forEach((word) => {
      if (!word.trim()) return;
      
      const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        const parent = node.parentElement;
        if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
          newMatches.push({
            id: `match-${newMatches.length}`,
            text: word,
            context: text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + word.length + 20)),
            selector: getUniqueSelector(parent),
            index: match.index
          });
        }
      }
    });
  }

  matches = newMatches;
  updateBadge(matches.length);
  if (state.isHighlightEnabled) {
    applyHighlights(state);
  }
}

function getUniqueSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  const path = [];
  while (el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += `#${el.id}`;
      path.unshift(selector);
      break;
    } else {
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling as HTMLElement) {
        if (sib.nodeName.toLowerCase() == selector) nth++;
      }
      if (nth != 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    el = el.parentNode as HTMLElement;
  }
  return path.join(' > ');
}

function applyHighlights(state: AppState) {
  // Limpiar resaltados anteriores
  document.querySelectorAll('.word-locator-highlight').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });

  if (!state.isHighlightEnabled || state.targetWords.length === 0) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    nodes.push(node);
  }

  nodes.forEach(textNode => {
    const text = textNode.textContent || '';
    let hasMatch = false;
    let html = text;

    state.targetWords.forEach(word => {
      if (!word.trim()) return;
      const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      if (regex.test(html)) {
        html = html.replace(regex, `<mark class="word-locator-highlight" style="background-color: ${state.highlightColor}; color: black; padding: 0 2px; border-radius: 2px;">$1</mark>`);
        hasMatch = true;
      }
    });

    if (hasMatch) {
      const span = document.createElement('span');
      span.innerHTML = html;
      textNode.parentNode?.replaceChild(span, textNode);
    }
  });
}

function updateBadge(count: number) {
  chrome.runtime.sendMessage({ type: 'UPDATE_COUNT', count });
}

// Escuchar mensajes del popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_MATCHES') {
    sendResponse({ matches });
  } else if (message.type === 'SCROLL_TO') {
    const el = document.querySelector(message.selector) as HTMLElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '3px solid #EF4444';
      setTimeout(() => el.style.outline = '', 2000);
    }
  } else if (message.type === 'STATE_CHANGED') {
    getAppState().then(findMatches);
  }
});

// Inicializar
getAppState().then(state => {
  findMatches(state);
  
  // Observar cambios en el DOM para sitios dinámicos
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    findMatches(state);
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
