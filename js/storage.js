// Локальное хранилище (localStorage) с запасным вариантом в памяти,
// если браузер запрещает запись (приватный режим, переполнение).

const PREFIX = 'hsk2:';
const HISTORY_LIMIT = 500;
const memory = new Map();

function read(key, fallback) {
  let raw = memory.has(key) ? memory.get(key) : null;
  if (raw === null) {
    try { raw = localStorage.getItem(PREFIX + key); } catch { raw = null; }
  }
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function write(key, value) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try { localStorage.setItem(PREFIX + key, raw); } catch { /* остаётся в памяти */ }
}

function remove(key) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

function isEntry(x) {
  return x && typeof x === 'object'
    && Number.isFinite(x.percent) && Number.isFinite(x.total) && x.total > 0
    && Number.isFinite(x.correct);
}

export const storage = {
  getHistory() {
    const list = read('history', []);
    return Array.isArray(list) ? list.filter(isEntry) : [];
  },
  addHistory(entry) {
    const list = storage.getHistory();
    list.unshift(entry);
    write('history', list.slice(0, HISTORY_LIMIT));
  },
  clearHistory() { remove('history'); },

  getSound() { return read('sound', true) !== false; },
  setSound(on) { write('sound', !!on); },

  getCombo() {
    const ids = read('combo', []);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  },
  setCombo(ids) { write('combo', ids); },

  getFlag(name) { return read(`flag.${name}`, false) === true; },
  setFlag(name) { write(`flag.${name}`, true); },
};
