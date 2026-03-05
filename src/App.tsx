import React, { useState, useEffect } from 'react';
import { Search, Settings, List, Plus, Trash2, ChevronRight, Highlighter, Info, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppState, Match, DEFAULT_STATE } from './types';

export default function App() {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [matches, setMatches] = useState<Match[]>([]);
  const [newWord, setNewWord] = useState('');
  const [activeTab, setActiveTab] = useState<'matches' | 'settings'>('matches');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchMatches = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_MATCHES' }, (response) => {
            if (response?.matches) {
              setMatches(response.matches);
            }
          });
        }
      });
    }
  };

  const refreshSearch = () => {
    setIsRefreshing(true);
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'STATE_CHANGED' });
          // Esperar un poco a que termine la búsqueda antes de pedir los resultados
          setTimeout(() => {
            fetchMatches();
            setIsRefreshing(false);
          }, 1500);
        } else {
          setIsRefreshing(false);
        }
      });
    } else {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Cargar estado desde storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['appState'], (result) => {
        if (result.appState) {
          setState(result.appState);
        }
        setIsLoading(false);
      });

      // Obtener matches iniciales
      fetchMatches();

      // Escuchar actualizaciones en tiempo real desde el content script
      const messageListener = (message: any) => {
        if (message.type === 'UPDATE_COUNT' && message.matches) {
          console.log('[Word Locator] Recibidos matches actualizados:', message.matches.length);
          setMatches(message.matches);
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    } else {
      // Mock para desarrollo local
      setIsLoading(false);
    }
  }, []);

  const saveState = (newState: AppState) => {
    console.log('[Word Locator] Guardando nuevo estado:', newState);
    setState(newState);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ appState: newState }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            console.log('[Word Locator] Enviando mensaje STATE_CHANGED a la pestaña:', tabs[0].id);
            chrome.tabs.sendMessage(tabs[0].id, { type: 'STATE_CHANGED' });
          }
        });
      });
    }
  };

  const addWord = () => {
    if (newWord.trim() && !state.targetWords.includes(newWord.trim())) {
      const newState = {
        ...state,
        targetWords: [...state.targetWords, newWord.trim()]
      };
      saveState(newState);
      setNewWord('');
    }
  };

  const removeWord = (word: string) => {
    const newState = {
      ...state,
      targetWords: state.targetWords.filter(w => w !== word)
    };
    saveState(newState);
  };

  const scrollToMatch = (selector: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SCROLL_TO', selector });
        }
      });
    }
  };

  const groupedMatches = React.useMemo(() => {
    const groups: Record<string, Match[]> = {};
    matches.forEach(match => {
      if (!groups[match.text]) {
        groups[match.text] = [];
      }
      groups[match.text].push(match);
    });
    return groups;
  }, [matches]);

  if (isLoading) return <div className="w-[400px] h-[500px] flex items-center justify-center bg-zinc-50">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
  </div>;

  return (
    <div className="w-[400px] h-[500px] flex flex-col bg-zinc-50 text-zinc-900 font-sans overflow-hidden">
      {/* Header */}
      <header className="px-4 py-3 bg-white border-b border-zinc-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Search className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">Word Locator</h1>
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab('matches')}
            className={`p-1.5 rounded-md transition-all ${activeTab === 'matches' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <List className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`p-1.5 rounded-md transition-all ${activeTab === 'settings' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {activeTab === 'matches' ? (
            <motion.div
              key="matches"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-4"
            >
              {/* Add Word Input */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addWord()}
                    placeholder="Añadir palabra o frase..."
                    className="w-full pl-3 pr-10 py-2 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  />
                  <button 
                    onClick={addWord}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Target Words Tags */}
              <div className="flex flex-wrap gap-2">
                {state.targetWords.map(word => (
                  <span key={word} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full border border-indigo-100">
                    {word}
                    <button onClick={() => removeWord(word)} className="hover:text-indigo-900">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {state.targetWords.length === 0 && (
                  <p className="text-sm text-zinc-400 italic">No hay palabras configuradas.</p>
                )}
              </div>

              {/* Matches List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    Resultados en esta página ({matches.length})
                  </h2>
                  <button 
                    onClick={refreshSearch}
                    disabled={isRefreshing}
                    className={`p-1.5 rounded-md transition-all hover:bg-zinc-100 text-zinc-500 hover:text-indigo-600 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`}
                    title="Refrescar búsqueda"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  {Object.keys(groupedMatches).length > 0 ? (
                    Object.entries(groupedMatches).map(([word, wordMatches]: [string, Match[]]) => (
                      <div key={word} className="space-y-2">
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-xs font-bold text-indigo-600 px-1.5 py-0.5 bg-indigo-50 rounded border border-indigo-100">
                            {word}
                          </span>
                          <span className="text-[10px] font-medium text-zinc-400 uppercase">
                            {wordMatches.length} {wordMatches.length === 1 ? 'coincidencia' : 'coincidencias'}
                          </span>
                        </div>
                        <div className="space-y-1.5 pl-2 border-l-2 border-zinc-100 ml-1">
                          {wordMatches.map((match) => (
                            <button
                              key={match.id}
                              onClick={() => scrollToMatch(match.selector)}
                              className="w-full text-left p-2.5 bg-white border border-zinc-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all group"
                            >
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-zinc-600 line-clamp-2 italic flex-1">
                                  "...{match.context}..."
                                </p>
                                <ChevronRight className="w-3.5 h-3.5 text-zinc-300 group-hover:text-indigo-500 transition-colors shrink-0 ml-2" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center space-y-2">
                      <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center mx-auto">
                        <Info className="w-6 h-6 text-zinc-400" />
                      </div>
                      <p className="text-sm text-zinc-500">No se encontraron coincidencias.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-6"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-white border border-zinc-200 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                      <Highlighter className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">Resaltado automático</h3>
                      <p className="text-xs text-zinc-500">Resalta las palabras en la página</p>
                    </div>
                  </div>
                  <button
                    onClick={() => saveState({ ...state, isHighlightEnabled: !state.isHighlightEnabled })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${state.isHighlightEnabled ? 'bg-indigo-600' : 'bg-zinc-200'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${state.isHighlightEnabled ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1">
                    Color de resaltado
                  </label>
                  <div className="grid grid-cols-5 gap-2 p-4 bg-white border border-zinc-200 rounded-2xl">
                    {['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ff9900'].map(color => (
                      <button
                        key={color}
                        onClick={() => saveState({ ...state, highlightColor: color })}
                        className={`aspect-square rounded-lg border-2 transition-all ${state.highlightColor === color ? 'border-indigo-600 scale-110 shadow-md' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                <h4 className="text-xs font-bold text-indigo-700 uppercase mb-1">Tip</h4>
                <p className="text-xs text-indigo-600 leading-relaxed">
                  Puedes añadir frases completas. La extensión buscará coincidencias exactas ignorando mayúsculas y minúsculas.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="px-4 py-3 bg-white border-t border-zinc-200 flex items-center justify-center shrink-0">
        <p className="text-[10px] text-zinc-400 font-medium tracking-widest uppercase">
          Word Locator v1.0
        </p>
      </footer>
    </div>
  );
}
