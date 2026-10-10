import { storage } from './storage.js';
import * as audio from './audio.js';
import { celebrate } from './celebrate.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionQuery.matches;

const CELEBRATE_FROM = 96;          // % для поздравления
const RING_C = 2 * Math.PI * 52;    // длина окружности кольца результата

const ICONS = {
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};

const state = {
  words: [],             // все слова в порядке: урок, затем порядок в файле
  lessons: [],           // [{ n, words }]
  byId: new Map(),
  loadError: null,
  screen: null,
  test: null,            // идущий тест
  result: null,          // последний завершённый тест
  combo: new Set(),      // выбранные слова (id) для комбинированного теста
  expanded: new Set(),   // раскрытые уроки на экране выбора
  exitAsking: false,
  stopConfetti: null,
};

/* ===================== Утилиты ===================== */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const nWords = (n) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;
const nLessons = (n) => `${n} ${plural(n, 'урок', 'урока', 'уроков')}`;
const scoreClass = (p) => (p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'bad');

function hanziSize(h) {
  const len = Array.from(h.replace(/\.{2,}|…/g, '…')).length;
  if (len <= 2) return 'xl';
  if (len === 3) return 'l';
  if (len === 4) return 'm';
  return 's';
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sameDay = (x, y) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  if (sameDay(d, today)) return `Сегодня, ${time}`;
  if (sameDay(d, yesterday)) return `Вчера, ${time}`;
  const opts = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString('ru-RU', opts)}, ${time}`;
}

function announce(text) {
  const live = $('#live');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

/* ===================== Данные ===================== */

async function loadWords() {
  const res = await fetch('data/words.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error('words.json: ожидается массив');

  const seen = new Map();
  const words = [];
  raw.forEach((w, idx) => {
    const lesson = Number(w && w.lesson);
    const hanzi = String((w && w.hanzi) || '').trim();
    const pinyin = String((w && w.pinyin) || '').trim();
    const translation = String((w && w.translation) || '').trim();
    if (!Number.isFinite(lesson) || !hanzi || !pinyin || !translation) return;
    let id = `${lesson}|${hanzi}|${pinyin}`;
    const k = seen.get(id) || 0;
    seen.set(id, k + 1);
    if (k) id += `#${k}`;
    words.push({ id, idx, lesson, hanzi, pinyin, translation });
  });
  if (!words.length) throw new Error('В words.json нет слов');

  words.sort((a, b) => a.lesson - b.lesson || a.idx - b.idx);
  const groups = new Map();
  for (const w of words) {
    if (!groups.has(w.lesson)) groups.set(w.lesson, []);
    groups.get(w.lesson).push(w);
  }
  state.words = words;
  state.lessons = Array.from(groups, ([n, list]) => ({ n, words: list }));
  state.byId = new Map(words.map((w) => [w.id, w]));
}

/* ===================== Навигация ===================== */
// Каждый экран — запись в history, чтобы работала кнопка «Назад» (Android, браузер).

const nav = {
  stack: [],
  init(name) {
    this.stack = [name];
    history.replaceState({ screen: name, depth: 0 }, '');
    render(name);
  },
  push(name) {
    this.stack.push(name);
    history.pushState({ screen: name, depth: this.stack.length - 1 }, '');
    render(name);
  },
  replace(name) {
    this.stack[this.stack.length - 1] = name;
    history.replaceState({ screen: name, depth: this.stack.length - 1 }, '');
    render(name);
  },
  back(fallback = 'welcome') {
    if (this.stack.length > 1) history.back();
    else this.replace(fallback);
  },
  backTo(name) {
    const i = this.stack.lastIndexOf(name);
    const last = this.stack.length - 1;
    if (i === -1) this.replace(name);
    else if (i === last) render(name);
    else history.go(i - last);
  },
};

const screens = {
  welcome: renderWelcome,
  menu: renderMenu,
  combo: renderCombo,
  test: renderTest,
  result: renderResult,
  history: renderHistory,
};

window.addEventListener('popstate', (e) => {
  const st = e.state && typeof e.state.depth === 'number' && screens[e.state.screen]
    ? e.state
    : { screen: 'welcome', depth: 0 };
  nav.stack.length = st.depth + 1;
  nav.stack[st.depth] = st.screen;

  // «Назад» при открытом окне подтверждения: просто закрываем окно
  // «Назад» во время теста: остаёмся и спрашиваем подтверждение
  const stay = isModalOpen() || (state.screen === 'test' && state.test);
  if (stay) {
    const wasTest = state.screen === 'test' && state.test && !state.exitAsking;
    if (isModalOpen()) closeModal(false);
    nav.stack.push(state.screen);
    history.pushState({ screen: state.screen, depth: nav.stack.length - 1 }, '');
    if (wasTest) requestExitTest();
    return;
  }

  let target = st.screen;
  if ((target === 'test' && !state.test) || (target === 'result' && !state.result)) {
    target = state.words.length ? 'menu' : 'welcome';
    nav.stack[st.depth] = target;
    history.replaceState({ screen: target, depth: st.depth }, '');
  }
  render(target);
});

function render(name) {
  if (state.screen === 'result' && name !== 'result') stopCelebration();
  state.screen = name;
  for (const el of $$('.screen')) {
    el.hidden = el.dataset.screen !== name;
    el.classList.remove('enter');
  }
  const el = $(`.screen[data-screen="${name}"]`);
  void el.offsetWidth;
  el.classList.add('enter');
  document.body.dataset.screen = name;
  window.scrollTo(0, 0);
  screens[name]();
}

/* ===================== Модальное окно ===================== */

const modal = { resolve: null, returnFocus: null };
const isModalOpen = () => modal.resolve !== null;

function confirmDialog({ title, text, ok, cancel = 'Отмена', danger = false }) {
  if (modal.resolve) closeModal(false);
  return new Promise((resolve) => {
    modal.resolve = resolve;
    modal.returnFocus = state.screen === 'test' ? null : document.activeElement;
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    const okBtn = $('#modal-ok');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    $('#modal-cancel').textContent = cancel;
    $('#modal').hidden = false;
    $('#modal-cancel').focus({ preventScroll: true });
  });
}

function closeModal(result) {
  if (!modal.resolve) return;
  const resolve = modal.resolve;
  const back = modal.returnFocus;
  modal.resolve = null;
  modal.returnFocus = null;
  $('#modal').hidden = true;
  if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  resolve(result);
}

/* ===================== Звук ===================== */

function syncSoundButtons() {
  const on = audio.isEnabled();
  for (const b of $$('.sound-toggle')) {
    b.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Звук включён. Выключить' : 'Звук выключен. Включить');
    b.title = on ? 'Звук: вкл' : 'Звук: выкл';
  }
}

function toggleSound() {
  const on = !audio.isEnabled();
  audio.setEnabled(on);
  if (on) {
    audio.unlock();
    audio.play('toggle');
  }
  syncSoundButtons();
}

/* ===================== 1. Приветствие ===================== */

let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function updateInstallUi() {
  $('#btn-install').hidden = !installPrompt || isStandalone();
  $('#ios-hint').hidden = !(isIOS() && !isStandalone() && !storage.getFlag('iosHintClosed'));
}

function renderWelcome() {
  const stats = $('#welcome-stats');
  if (state.loadError) {
    stats.textContent = 'Не удалось загрузить слова (data/words.json)';
    stats.classList.add('error');
    $('#btn-start').disabled = true;
  } else {
    stats.textContent = `${nWords(state.words.length)} · ${nLessons(state.lessons.length)}`;
    stats.classList.remove('error');
    $('#btn-start').disabled = false;
  }
  updateInstallUi();
}

/* ===================== 2. Меню ===================== */

function renderMenu() {
  const lastScore = new Map();
  for (const h of storage.getHistory()) {
    if (h.kind === 'lesson' && !lastScore.has(h.lesson)) lastScore.set(h.lesson, h.percent);
  }
  $('#lesson-grid').innerHTML = state.lessons.map((l) => {
    const p = lastScore.get(l.n);
    const preview = l.words.slice(0, 4).map((w) => esc(w.hanzi)).join(' · ');
    return `<button type="button" class="lesson-card" data-lesson="${l.n}">
        <span class="lesson-title">Урок ${l.n}</span>
        <span class="lesson-meta">${nWords(l.words.length)}</span>
        <span class="lesson-preview" lang="zh-CN">${preview}</span>
        ${p === undefined ? '' : `<span class="score-pill ${scoreClass(p)}" title="Последний результат">${p}%</span>`}
      </button>`;
  }).join('');
}

function startLesson(n) {
  const lesson = state.lessons.find((l) => l.n === n);
  if (lesson) startTest({ kind: 'lesson', lesson: n, title: `Урок ${n}`, words: lesson.words });
}

/* ===================== 3. Комбинированный ===================== */

function renderCombo() {
  $('#combo-list').innerHTML = state.lessons.map((l) => {
    const open = state.expanded.has(l.n);
    const words = l.words.map((w) => `<li>
        <label class="combo-word">
          <input type="checkbox" class="check word-check" data-id="${esc(w.id)}">
          <span class="cw-hanzi" lang="zh-CN">${esc(w.hanzi)}</span>
          <span class="cw-meta"><span class="cw-pinyin">${esc(w.pinyin)}</span><span class="cw-tr">${esc(w.translation)}</span></span>
        </label>
      </li>`).join('');
    return `<li class="combo-lesson${open ? ' open' : ''}" data-lesson="${l.n}">
        <div class="combo-row">
          <label class="check-hit"><input type="checkbox" class="check lesson-check" aria-label="Выбрать все слова урока ${l.n}"></label>
          <button type="button" class="combo-toggle" aria-expanded="${open}" aria-controls="combo-words-${l.n}">
            <span class="combo-title">Урок ${l.n}</span>
            <span class="combo-count"></span>
            ${ICONS.chevron}
          </button>
        </div>
        <ul class="combo-words" id="combo-words-${l.n}"${open ? '' : ' hidden'}>${words}</ul>
      </li>`;
  }).join('');
  syncCombo(false);
}

function syncCombo(save = true) {
  for (const l of state.lessons) {
    const li = $(`.combo-lesson[data-lesson="${l.n}"]`);
    if (!li) continue;
    let selected = 0;
    for (const w of l.words) if (state.combo.has(w.id)) selected++;
    const box = $('.lesson-check', li);
    box.checked = selected === l.words.length;
    box.indeterminate = selected > 0 && selected < l.words.length;
    $('.combo-count', li).textContent = `${selected} / ${l.words.length}`;
    li.classList.toggle('has-selection', selected > 0);
    for (const cb of $$('.word-check', li)) cb.checked = state.combo.has(cb.dataset.id);
  }
  const n = state.combo.size;
  const start = $('#combo-start');
  start.disabled = n === 0;
  start.setAttribute('aria-label', `Начать: ${nWords(n)}`);
  $('#combo-start-count').textContent = n;
  $('#combo-all').disabled = n === state.words.length;
  $('#combo-none').disabled = n === 0;
  if (save) storage.setCombo(Array.from(state.combo));
}

function onComboChange(e) {
  const box = e.target;
  if (box.classList.contains('lesson-check')) {
    const n = Number(box.closest('.combo-lesson').dataset.lesson);
    const lesson = state.lessons.find((l) => l.n === n);
    for (const w of lesson.words) {
      if (box.checked) state.combo.add(w.id);
      else state.combo.delete(w.id);
    }
  } else if (box.classList.contains('word-check')) {
    if (box.checked) state.combo.add(box.dataset.id);
    else state.combo.delete(box.dataset.id);
  }
  syncCombo();
}

function onComboClick(e) {
  const toggle = e.target.closest('.combo-toggle');
  if (!toggle) return;
  const li = toggle.closest('.combo-lesson');
  const n = Number(li.dataset.lesson);
  const open = !state.expanded.has(n);
  if (open) state.expanded.add(n);
  else state.expanded.delete(n);
  li.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  $('.combo-words', li).hidden = !open;
}

function startCombo() {
  // Исходный порядок: урок, затем порядок в файле (state.words уже так отсортирован)
  const words = state.words.filter((w) => state.combo.has(w.id));
  if (words.length) startTest({ kind: 'combined', lesson: null, title: 'Комбинированный', words });
}

/* ===================== 4. Тест ===================== */

function startTest(cfg, mode = 'push') {
  if (!cfg.words.length) return;
  stopCelebration();
  state.test = {
    kind: cfg.kind,
    lesson: cfg.lesson ?? null,
    title: cfg.title,
    baseTitle: cfg.baseTitle || cfg.title,
    words: cfg.words.slice(),
    index: 0,
    answers: [],
    flipped: false,
    revealed: false,
    busy: false,
  };
  if (mode === 'replace') nav.replace('test');
  else nav.push('test');
}

function renderTest() {
  const t = state.test;
  if (!t) return;
  $('#test-title').textContent = t.title;
  $('#progress').setAttribute('aria-valuemax', String(t.words.length));
  showCard(false);
  t.busy = false;
}

function fillCard(w) {
  const front = $('#card-hanzi');
  front.textContent = w.hanzi;
  front.dataset.size = hanziSize(w.hanzi);
  $('#card-hanzi-back').textContent = w.hanzi;
  $('#card-pinyin').textContent = w.pinyin;
  $('#card-translation').textContent = w.translation;
  for (const chip of $$('.card-chip')) chip.textContent = `Урок ${w.lesson}`;
  $('#card').setAttribute('aria-label', `Карточка: ${w.hanzi}. Нажмите, чтобы перевернуть`);
}

/** Показать текущую карточку лицевой стороной (с анимацией появления или без). */
function showCard(animate) {
  const t = state.test;
  const card = $('#card');
  card.classList.add('no-anim');
  card.classList.remove('flipped', 'leave-left', 'leave-right');
  t.flipped = false;
  t.revealed = false;
  $('#card-front').setAttribute('aria-hidden', 'false');
  $('#card-back').setAttribute('aria-hidden', 'true');
  fillCard(t.words[t.index]);
  if (animate) card.classList.add('entering');
  void card.offsetWidth;
  card.classList.remove('no-anim', 'entering');
  updateProgress();
  updateAnswerButtons();
}

function updateProgress() {
  const t = state.test;
  const total = t.words.length;
  $('#test-progress-text').textContent = `Слово ${Math.min(t.index + 1, total)} из ${total}`;
  $('#progress-fill').style.width = `${(t.answers.length / total) * 100}%`;
  $('#progress').setAttribute('aria-valuenow', String(t.answers.length));
}

function updateAnswerButtons() {
  const t = state.test;
  const off = !t || !t.revealed;
  $('#btn-right').disabled = off;
  $('#btn-wrong').disabled = off;
}

function flip() {
  const t = state.test;
  if (!t || t.busy) return;
  t.flipped = !t.flipped;
  $('#card').classList.toggle('flipped', t.flipped);
  $('#card-front').setAttribute('aria-hidden', String(t.flipped));
  $('#card-back').setAttribute('aria-hidden', String(!t.flipped));
  audio.play('flip');
  if (t.flipped) {
    const w = t.words[t.index];
    announce(`${w.pinyin}. ${w.translation}`);
    if (!t.revealed) {
      t.revealed = true;
      updateAnswerButtons();
    }
  }
}

function answer(correct) {
  const t = state.test;
  if (!t || !t.revealed || t.busy) return;
  t.busy = true;
  t.answers.push({ word: t.words[t.index], correct });
  if (correct) {
    audio.play('correct');
  } else {
    audio.play('wrong');
    audio.vibrate(60);
  }
  t.index++;
  $('#btn-right').disabled = true;
  $('#btn-wrong').disabled = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  $('#progress-fill').style.width = `${(t.answers.length / t.words.length) * 100}%`;

  const card = $('#card');
  const leaveMs = reducedMotion() ? 0 : 190;
  if (leaveMs) card.classList.add(correct ? 'leave-right' : 'leave-left');
  setTimeout(() => {
    if (state.test !== t) return;
    if (t.index >= t.words.length) {
      finishTest();
      return;
    }
    showCard(!reducedMotion());
    setTimeout(() => { if (state.test === t) t.busy = false; }, reducedMotion() ? 0 : 170);
  }, leaveMs);
}

async function requestExitTest() {
  if (!state.test || state.exitAsking) return;
  state.exitAsking = true;
  const ok = await confirmDialog({
    title: 'Выйти из теста?',
    text: 'Результат незаконченного теста не сохранится в истории.',
    ok: 'Выйти',
    cancel: 'Продолжить',
    danger: true,
  });
  state.exitAsking = false;
  if (!ok || !state.test) return;
  state.test = null;
  nav.back('menu');
}

function finishTest() {
  const t = state.test;
  const total = t.answers.length;
  const correct = t.answers.filter((a) => a.correct).length;
  const percent = Math.round((correct / total) * 100);
  const result = {
    kind: t.kind,
    lesson: t.lesson,
    title: t.title,
    baseTitle: t.baseTitle,
    words: t.words,
    mistakes: t.answers.filter((a) => !a.correct).map((a) => a.word),
    total,
    correct,
    percent,
  };
  storage.addHistory({
    date: new Date().toISOString(),
    kind: t.kind,
    lesson: t.lesson,
    title: t.title,
    total,
    correct,
    percent,
  });
  state.result = result;
  state.test = null;
  nav.replace('result');

  if (percent >= CELEBRATE_FROM) {
    setTimeout(() => {
      if (state.screen !== 'result' || state.result !== result) return;
      audio.play('victory');
      stopCelebration();
      state.stopConfetti = celebrate({ reduced: reducedMotion() });
    }, 320);
  }
}

/* ===================== 5. Результат ===================== */

function resultMessage(p) {
  if (p === 100) return 'Идеально!';
  if (p >= CELEBRATE_FROM) return 'Блестяще!';
  if (p >= 80) return 'Отличная работа!';
  if (p >= 60) return 'Хороший результат';
  if (p >= 40) return 'Неплохо, но стоит повторить';
  return 'Нужно ещё потренироваться';
}

let countRaf = 0;
function animateRing(p) {
  const fill = $('#ring-fill');
  const label = $('#result-percent');
  const target = RING_C * (1 - p / 100);
  fill.style.strokeDasharray = String(RING_C);
  fill.style.opacity = p === 0 ? '0' : '1';
  cancelAnimationFrame(countRaf);
  if (reducedMotion()) {
    fill.style.strokeDashoffset = String(target);
    label.textContent = p;
    return;
  }
  fill.style.transition = 'none';
  fill.style.strokeDashoffset = String(RING_C);
  void fill.getBoundingClientRect();
  fill.style.transition = '';
  requestAnimationFrame(() => { fill.style.strokeDashoffset = String(target); });

  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / 1000);
    label.textContent = Math.round(p * (1 - Math.pow(1 - k, 3)));
    if (k < 1) countRaf = requestAnimationFrame(step);
  };
  label.textContent = '0';
  countRaf = requestAnimationFrame(step);
}

function wordRow(w) {
  return `<li class="word-row">
      <span class="wr-hanzi" lang="zh-CN">${esc(w.hanzi)}</span>
      <span class="wr-meta"><span class="wr-pinyin">${esc(w.pinyin)}</span><span class="wr-tr">${esc(w.translation)}</span></span>
    </li>`;
}

function renderResult() {
  const r = state.result;
  if (!r) return;
  $('#result-hero').dataset.score = scoreClass(r.percent);
  $('#result-message').textContent = resultMessage(r.percent);
  $('#result-sub').textContent = `${r.title} · ${nWords(r.total)}`;
  $('#result-correct').textContent = r.correct;
  $('#result-wrong').textContent = r.total - r.correct;
  $('#claude-badge').hidden = r.percent < CELEBRATE_FROM;
  $('#btn-repeat-mistakes').hidden = r.mistakes.length === 0;
  $('#mistakes-title').textContent = r.mistakes.length ? `Ошибки · ${r.mistakes.length}` : 'Ошибки';
  $('#mistakes-list').innerHTML = r.mistakes.length
    ? r.mistakes.map(wordRow).join('')
    : '<li class="no-mistakes">Ошибок нет — все слова отмечены как верные!</li>';
  animateRing(r.percent);
}

function repeatTest() {
  const r = state.result;
  if (r) startTest({ kind: r.kind, lesson: r.lesson, title: r.title, baseTitle: r.baseTitle, words: r.words }, 'replace');
}

function repeatMistakes() {
  const r = state.result;
  if (!r || !r.mistakes.length) return;
  startTest({
    kind: 'mistakes',
    lesson: r.lesson,
    title: `Ошибки · ${r.baseTitle}`,
    baseTitle: r.baseTitle,
    words: r.mistakes,
  }, 'replace');
}

function stopCelebration() {
  if (state.stopConfetti) {
    state.stopConfetti();
    state.stopConfetti = null;
  }
}

/* ===================== 6. История ===================== */

function renderHistory() {
  const items = storage.getHistory();
  const has = items.length > 0;
  if (has) {
    const avg = items.reduce((s, h) => s + h.correct / h.total, 0) / items.length;
    $('#avg-value').textContent = `${Math.round(avg * 100)}%`;
    $('#avg-sub').textContent = `Пройдено тестов: ${items.length}`;
  } else {
    $('#avg-value').textContent = '—';
    $('#avg-sub').textContent = 'Пока нет пройденных тестов';
  }
  $('#history-list').innerHTML = items.map((h) => `<li class="history-item">
      <div class="hi-main">
        <span class="hi-title">${esc(h.title || 'Тест')} · ${nWords(h.total)}</span>
        <span class="hi-date">${esc(formatDate(h.date))} · верно ${h.correct} из ${h.total}</span>
      </div>
      <span class="hi-score ${scoreClass(h.percent)}">${h.percent}%</span>
    </li>`).join('');
  $('#history-empty').hidden = has;
  $('#btn-clear-history').hidden = !has;
}

async function clearHistory() {
  const ok = await confirmDialog({
    title: 'Очистить историю?',
    text: 'Все результаты будут удалены без возможности восстановления.',
    ok: 'Очистить',
    danger: true,
  });
  if (!ok) return;
  storage.clearHistory();
  renderHistory();
}

/* ===================== События ===================== */

function bindEvents() {
  // Разблокировка звука для iOS: на каждом жесте пользователя
  for (const type of ['touchend', 'click', 'keydown']) {
    document.addEventListener(type, audio.unlock, { capture: true, passive: true });
  }
  // Запрет случайного зума щипком в Safari
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  document.addEventListener('click', (e) => {
    const sound = e.target.closest('.sound-toggle');
    if (sound) { toggleSound(); return; }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    switch (action.dataset.action) {
      case 'back': nav.back('welcome'); break;
      case 'history': nav.push('history'); break;
      case 'exit-test': requestExitTest(); break;
      default: break;
    }
  });

  $('#btn-start').addEventListener('click', () => {
    audio.unlock();
    nav.push('menu');
  });
  $('#btn-history').addEventListener('click', () => nav.push('history'));
  $('#btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch { /* ignore */ }
    installPrompt = null;
    updateInstallUi();
  });
  $('#ios-hint-close').addEventListener('click', () => {
    storage.setFlag('iosHintClosed');
    updateInstallUi();
  });

  $('#btn-combo').addEventListener('click', () => nav.push('combo'));
  $('#lesson-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.lesson-card');
    if (card) startLesson(Number(card.dataset.lesson));
  });

  $('#combo-list').addEventListener('change', onComboChange);
  $('#combo-list').addEventListener('click', onComboClick);
  $('#combo-all').addEventListener('click', () => {
    for (const w of state.words) state.combo.add(w.id);
    syncCombo();
  });
  $('#combo-none').addEventListener('click', () => {
    state.combo.clear();
    syncCombo();
  });
  $('#combo-start').addEventListener('click', startCombo);

  $('#card').addEventListener('click', flip);
  $('#btn-right').addEventListener('click', () => answer(true));
  $('#btn-wrong').addEventListener('click', () => answer(false));

  $('#btn-repeat').addEventListener('click', repeatTest);
  $('#btn-repeat-mistakes').addEventListener('click', repeatMistakes);
  $('#btn-to-menu').addEventListener('click', () => nav.backTo('menu'));

  $('#btn-clear-history').addEventListener('click', clearHistory);
  $('#btn-empty-start').addEventListener('click', () => nav.backTo('menu'));

  $('#modal-ok').addEventListener('click', () => closeModal(true));
  $('#modal-cancel').addEventListener('click', () => closeModal(false));
  $('#modal-backdrop').addEventListener('click', () => closeModal(false));

  document.addEventListener('keydown', onKeyDown);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    updateInstallUi();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateInstallUi();
  });
}

function onKeyDown(e) {
  if (isModalOpen()) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(false); }
    if (e.key === 'Tab') {
      // Фокус не выходит за пределы окна
      e.preventDefault();
      const next = document.activeElement === $('#modal-cancel') ? $('#modal-ok') : $('#modal-cancel');
      next.focus();
    }
    return;
  }
  if (state.screen !== 'test' || !state.test) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;

  switch (e.key) {
    case ' ':
    case 'Spacebar':
    case 'Enter': {
      const el = document.activeElement;
      if (el && el.tagName === 'BUTTON') {
        // Кнопка, выбранная с клавиатуры (Tab), срабатывает как обычно;
        // если фокус остался после клика мышью, клавиша переворачивает карточку
        let keyboardFocus = false;
        try { keyboardFocus = el.matches(':focus-visible'); } catch { /* старый браузер */ }
        if (keyboardFocus) return;
        el.blur();
      }
      e.preventDefault();
      flip();
      break;
    }
    case 'ArrowRight':
    case '1':
      e.preventDefault();
      answer(true);
      break;
    case 'ArrowLeft':
    case '2':
      e.preventDefault();
      answer(false);
      break;
    case 'Escape':
      e.preventDefault();
      requestExitTest();
      break;
    default:
      break;
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
  });
}

/* ===================== Запуск ===================== */

async function init() {
  bindEvents();
  syncSoundButtons();
  try {
    await loadWords();
    state.combo = new Set(storage.getCombo().filter((id) => state.byId.has(id)));
  } catch (err) {
    state.loadError = err;
    console.error('Не удалось загрузить слова:', err);
  }
  nav.init('welcome');
}

registerServiceWorker();
init();
