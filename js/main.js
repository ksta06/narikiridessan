// ===== 設定 =====
const SIZE = 1024;                       // お題・提出画像をこのサイズに揃える
const MAX_BYTES = 5 * 1024 * 1024;       // アップロード上限 5MB
const COPY_THRESHOLD = 2.0;              // お題との平均差がこれ未満なら「お題そのまま」とみなす（0〜255）
const PASS_KEY = 'aiScoreGame.passphrase';
const REQUIRE_PASSPHRASE = false;        // 運営用の合言葉を使うか（Code.gs の同名の設定と合わせる）
// 配点を変えるときは Code.gs の CRITERIA と合わせる
// 画面の文字は {漢字|よみがな} と書くと、ふりがな付きで表示される（rubyHtml を参照）
const CATEGORIES = [
  { key: 'shape', label: '{形|かたち}', max: 40 },
  { key: 'color', label: '{色|いろ}', max: 30 },
  { key: 'composition', label: 'ばしょ', max: 20 },
  { key: 'detail', label: '{細|こま}かいところ', max: 10 },
];

const state = {
  passphrase: '',
  topics: [],            // 選べるお題の一覧
  userTopics: [],        // 運営が承認したみんなの絵の一覧
  newTopic: null,        // 自分でお題を作る画面で選んだ絵（PNG の data URL）
  selectedTopic: null,   // 「絵を選ぶ」で選んだお題（未選択なら null）
  pendingTopic: null,    // モード選択中のお題
  mode: 'drawing',       // 'drawing'（お絵かき）または 'coloring'（ぬりえ）
  topicId: '',           // プレイ中のお題のファイルID
  topicTitle: '',        // プレイ中のお題のタイトル（線画のファイル名に使う）
  lineArtCache: new Map(), // 一度読み込んだ線画（ファイルID → { mimeType, base64 }）
  topicCache: new Map(), // 一度読み込んだお題画像（ファイルID → data URL）
  topicCanvas: null,     // 1024x1024 に揃えたお題画像
  submission: null,      // 送信する PNG の data URL
  busy: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** 文字を HTML 用にエスケープし、{漢字|よみがな} をふりがな付き（<ruby>）に変える */
function rubyHtml(text) {
  const escaped = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return escaped.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>');
}

// ===== 画面切り替え =====
const SCREENS = ['staff', 'boot', 'fatal', 'menu', 'difficulty', 'select', 'start', 'submit', 'loading', 'error', 'result', 'create', 'created'];
function show(name) {
  if (name === 'menu') {
    $('#menu-selected').textContent = state.selectedTopic ? state.selectedTopic.title : 'なし';
  }
  SCREENS.forEach((s) => $('#screen-' + s).classList.toggle('hidden', s !== name));
  window.scrollTo(0, 0);
}
$$('[data-go]').forEach((el) => el.addEventListener('click', () => show(el.dataset.go)));

// ===== ポップアップ =====
function openPopup(name) {
  $('#popup-' + name).classList.remove('hidden');
}
function closePopups() {
  $$('.popup, #lightbox').forEach((el) => el.classList.add('hidden'));
}
$$('[data-popup]').forEach((el) => el.addEventListener('click', () => openPopup(el.dataset.popup)));

// メニューに戻る（data-menu="reset" なら選んだ絵も未選択に戻す）
$$('[data-menu]').forEach((el) => el.addEventListener('click', () => {
  if (el.dataset.menu === 'reset') state.selectedTopic = null;
  closePopups();
  show('menu');
}));

// ===== サーバー呼び出し（google.script.run を Promise 化） =====
function callServer(fn, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)[fn](...args);
  });
}

// ===== 合言葉の保存 =====
function loadPass() {
  try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return state.passphrase; }
}
function savePass(value) {
  state.passphrase = value;
  try {
    if (value) localStorage.setItem(PASS_KEY, value); else localStorage.removeItem(PASS_KEY);
  } catch (e) { /* 保存できない環境ではこのタブの間だけ有効 */ }
}

$('#staff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = $('#staff-pass').value.trim();
  const msg = $('#staff-message');
  if (!value) return;
  msg.className = 'message';
  msg.textContent = '確認中…';
  try {
    const res = await callServer('verifyPassphrase', value);
    if (!res.ok) {
      msg.className = 'message error';
      msg.textContent = '合言葉が違います。';
      return;
    }
    savePass(value);
    $('#staff-pass').value = '';
    msg.textContent = '';
    boot();
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = '通信エラー：' + err.message;
  }
});

$('#btn-staff').classList.toggle('hidden', !REQUIRE_PASSPHRASE);
$('#btn-staff').addEventListener('click', () => {
  if (!confirm('運営スタッフ用の設定を開きますか？（保存されている合言葉は消去されます）')) return;
  savePass('');
  show('staff');
});

// ===== 起動 =====
async function boot() {
  state.passphrase = REQUIRE_PASSPHRASE ? loadPass() : '';
  if (REQUIRE_PASSPHRASE && !state.passphrase) { show('staff'); return; }
  show('boot');
  try {
    const info = await callServer('getGameInfo', state.passphrase);
    if (!info.ok) {
      if (info.code === 'AUTH') { savePass(''); show('staff'); return; }
      throw new Error(info.message);
    }
    state.topics = info.topics;
    state.userTopics = info.userTopics || [];
    renderMarquee(info.topics);
    show('menu');
  } catch (err) {
    $('#fatal-message').textContent = err.message;
    show('fatal');
  }
}

// ===== メニュー =====
$('#btn-game-start').addEventListener('click', () => {
  if (state.selectedTopic) chooseMode(state.selectedTopic);
  else openPopup('start');
});

// ===== モード選択（お題が決まったあとに、お絵かき／ぬりえを選ぶ） =====
function chooseMode(topic) {
  state.pendingTopic = topic;
  $('#btn-mode-coloring').disabled = !topic.hasLineArt; // 線画がないお題はぬりえモードを選べない
  openPopup('mode');
}
$$('[data-mode]').forEach((el) => el.addEventListener('click', () => {
  state.mode = el.dataset.mode;
  closePopups();
  startTopic(state.pendingTopic);
}));
$('#btn-popup-select').addEventListener('click', () => {
  closePopups();
  show('difficulty');
});

// ===== 難易度の選択（押した難易度の絵だけを一覧に出す） =====
$$('[data-difficulty]').forEach((el) => el.addEventListener('click', () => {
  const difficulty = el.dataset.difficulty;
  $('#select-message').textContent = '';
  renderTopicList(state.topics.filter((t) => t.difficulty === difficulty));
  show('select');
}));
// みんなの絵（難易度は付けず、運営が承認したものだけを出す）
$('#btn-user-topics').addEventListener('click', () => {
  $('#select-message').textContent = '';
  renderTopicList(state.userTopics);
  show('select');
});
$('#btn-random').addEventListener('click', () => {
  closePopups();
  chooseMode(state.topics[Math.floor(Math.random() * state.topics.length)]);
});

// ===== お題選択（絵を押したらメニューに戻る） =====
function renderTopicList(topics) {
  const grid = $('#topic-grid');
  grid.innerHTML = '';
  $('#topic-empty').classList.toggle('hidden', topics.length > 0);
  topics.forEach((topic) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'topic-card';
    card.innerHTML = '<div class="thumb"></div><div class="title"></div>';
    if (topic.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = topic.thumbnailUrl;
      img.alt = '';
      img.draggable = false;
      card.querySelector('.thumb').appendChild(img);
    } else {
      card.querySelector('.thumb').textContent = '？';
    }
    card.querySelector('.title').textContent = topic.title;
    card.addEventListener('click', () => {
      state.selectedTopic = topic;
      show('menu');
    });
    grid.appendChild(card);
  });
}

// ===== メニュー下部の流れる絵（見せるだけ） =====
const MARQUEE_ITEM_WIDTH = 136; // 絵の幅 120px ＋ 間隔 16px（style の .marquee-track img と合わせる）
const MARQUEE_SPEED = 50;       // 1 秒に動く距離（px）

function renderMarquee(topics) {
  const track = $('#topic-marquee');
  track.innerHTML = '';
  const urls = topics.map((t) => t.thumbnailUrl).filter(Boolean);
  if (urls.length === 0) {
    track.parentElement.classList.add('hidden');
    return;
  }
  // 画面幅より長くなるまで絵を繰り返し、その並びを 2 つ続けて途切れないようにする
  const repeat = Math.ceil(Math.max(window.innerWidth, 1200) / (MARQUEE_ITEM_WIDTH * urls.length));
  const half = [];
  for (let i = 0; i < repeat; i++) half.push(...urls);
  [...half, ...half].forEach((url) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    track.appendChild(img);
  });
  track.style.setProperty('--marquee-duration', (half.length * MARQUEE_ITEM_WIDTH / MARQUEE_SPEED) + 's');
}

/** お題の画像を読み込んで、②（お題と作り方）の画面を表示する */
async function startTopic(topic) {
  $('#select-message').textContent = '';
  show('boot');
  try {
    let dataUrl = state.topicCache.get(topic.id);
    if (!dataUrl) {
      const res = await callServer('getTopic', state.passphrase, topic.id);
      if (!res.ok) {
        if (res.code === 'AUTH') { savePass(''); show('staff'); return; }
        throw new Error(res.message);
      }
      dataUrl = res.dataUrl;
      state.topicCache.set(topic.id, dataUrl);
    }
    state.topicId = topic.id;
    state.topicTitle = topic.title;
    state.topicCanvas = toSquareCanvas(await loadImage(dataUrl));
    $('#btn-lineart').classList.toggle('hidden', state.mode !== 'coloring');
    $('#lineart-message').textContent = '';
    $$('.topic-title').forEach((el) => { el.textContent = topic.title; });
    $$('.topic-img').forEach((el) => { el.src = dataUrl; });
    $('#lightbox-img').src = dataUrl;
    resetSubmission();
    setFileMessage('');
    show('start');
  } catch (err) {
    $('#select-message').textContent = err.message || 'お題を読み込めませんでした。';
    show('select');
  }
}

// ===== ぬりえモードの線画をダウンロードする =====
$('#btn-lineart').addEventListener('click', async () => {
  const button = $('#btn-lineart');
  button.disabled = true;
  $('#lineart-message').textContent = '';
  try {
    let lineArt = state.lineArtCache.get(state.topicId);
    if (!lineArt) {
      const res = await callServer('getLineArt', state.passphrase, state.topicId);
      if (!res.ok) {
        if (res.code === 'AUTH') { savePass(''); show('staff'); return; }
        throw new Error(res.message);
      }
      lineArt = { mimeType: res.mimeType, base64: res.base64 };
      state.lineArtCache.set(state.topicId, lineArt);
    }
    const bytes = Uint8Array.from(atob(lineArt.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: lineArt.mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = state.topicTitle + '_線画.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    $('#lineart-message').textContent = err.message || '線画をダウンロードできませんでした。';
  } finally {
    button.disabled = false;
  }
});

// ===== お題の拡大表示・保存しにくくする =====
$$('[data-zoom]').forEach((el) => el.addEventListener('click', () => $('#lightbox').classList.remove('hidden')));
$('#lightbox').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').classList.add('hidden'); });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.topic-img, #lightbox')) e.preventDefault(); });

// ===== 画像処理 =====
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    img.src = src;
  });
}

/** 白背景の 1024x1024 キャンバスに、縦横比を保って中央に配置する（透明部分は白になる） */
function toSquareCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const scale = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return canvas;
}

/** 2枚のキャンバスを 64x64 に縮小し、RGB の平均絶対差（0〜255）を返す */
function meanDifference(a, b) {
  const n = 64;
  const read = (src) => {
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, n, n);
    return ctx.getImageData(0, 0, n, n).data;
  };
  const da = read(a);
  const db = read(b);
  let sum = 0;
  for (let i = 0; i < da.length; i += 4) {
    sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
  }
  return sum / (n * n * 3);
}

async function isPng(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((v, i) => head[i] === v);
}

// ===== ファイル選択（採点の提出と、お題を作る画面で共通） =====
/** ファイル選択とドラッグ＆ドロップで選ばれたファイルを onFile に渡す */
function setupDropzone(zone, input, onFile) {
  input.addEventListener('change', () => {
    if (input.files[0]) onFile(input.files[0]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  });
}

/** PNG を確認して読み込み、1024x1024・白背景のキャンバスにする（だめなときはメッセージ付きのエラー） */
async function prepareImage(file) {
  if (!(await isPng(file))) {
    throw new Error('PNG形式の画像を選んでください。（JPEGやPSDは提出できません）');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('ファイルサイズが大きすぎます（' + (file.size / 1024 / 1024).toFixed(1) + 'MB）。5MB以下にしてください。');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { canvas: toSquareCanvas(img), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 大きさを揃えたときの注意（揃える必要がなかったら空文字） */
function resizeNote(w, h) {
  if (w !== h) return 'ましかくではない{絵|え}（' + w + '×' + h + '）だったので、まわりに{白|しろ}をたしたよ。';
  if (w !== SIZE) return '{絵|え}の{大|おお}きさを ' + SIZE + '×' + SIZE + ' にかえたよ。';
  return '';
}

function setMessage(el, text, type) {
  el.className = 'message' + (type ? ' ' + type : '');
  el.innerHTML = rubyHtml(text);
}

const fileInput = $('#file-input');
const dropzone = $('#dropzone');
setupDropzone(dropzone, fileInput, handleFile);
$('#btn-change').addEventListener('click', () => fileInput.click());

function setFileMessage(text, type) {
  setMessage($('#file-message'), text, type);
}

function resetSubmission() {
  state.submission = null;
  $('#btn-score').disabled = true;
  $('#preview-wrap').classList.add('hidden');
  dropzone.classList.remove('hidden');
  $('#btn-change').classList.add('hidden');
}

async function handleFile(file) {
  resetSubmission();
  setFileMessage('');
  let prepared;
  try {
    prepared = await prepareImage(file);
  } catch (err) {
    setFileMessage(err.message, 'error');
    return;
  }

  const canvas = prepared.canvas;
  if (state.topicCanvas && meanDifference(canvas, state.topicCanvas) < COPY_THRESHOLD) {
    setFileMessage('お題画像とまったく同じ画像は提出できません。自分で作った作品を選んでね！', 'error');
    return;
  }

  state.submission = canvas.toDataURL('image/png');
  $('#preview-img').src = state.submission;
  $('#preview-wrap').classList.remove('hidden');
  dropzone.classList.add('hidden');
  $('#btn-change').classList.remove('hidden');
  $('#btn-score').disabled = false;

  const note = resizeNote(prepared.width, prepared.height);
  if (note) setFileMessage(note, 'warn');
  else setFileMessage('じゅんびOK！「{AI|エーアイ}に{点|てん}をつけてもらう」をおしてね。');
}

// ===== 自分でお題を作る（保存したお題は、運営が承認すると「みんなの絵」に出る） =====
const USER_TITLE_MAX = 20;        // タイトルの最大文字数（Code.gs の同名の設定と合わせる）
const CREATED_RETURN_MS = 5000;   // 保存したあと、自動でメニューに戻るまでの時間
const createInput = $('#create-file');
const createDropzone = $('#create-dropzone');
let createdTimer = null;

function setCreateMessage(text, type) {
  setMessage($('#create-message'), text, type);
}

function updateCreateButton() {
  $('#btn-create-save').disabled = !(state.newTopic && $('#create-title').value.trim());
}

function resetCreate() {
  state.newTopic = null;
  $('#create-title').value = '';
  $('#create-preview-wrap').classList.add('hidden');
  createDropzone.classList.remove('hidden');
  $('#btn-create-change').classList.add('hidden');
  setCreateMessage('');
  updateCreateButton();
}

async function handleCreateFile(file) {
  state.newTopic = null;
  $('#create-preview-wrap').classList.add('hidden');
  createDropzone.classList.remove('hidden');
  $('#btn-create-change').classList.add('hidden');
  setCreateMessage('');
  updateCreateButton();
  let prepared;
  try {
    prepared = await prepareImage(file);
  } catch (err) {
    setCreateMessage(err.message, 'error');
    return;
  }
  state.newTopic = prepared.canvas.toDataURL('image/png');
  $('#create-preview-img').src = state.newTopic;
  $('#create-preview-wrap').classList.remove('hidden');
  createDropzone.classList.add('hidden');
  $('#btn-create-change').classList.remove('hidden');
  updateCreateButton();
  const note = resizeNote(prepared.width, prepared.height);
  if (note) setCreateMessage(note, 'warn');
}

setupDropzone(createDropzone, createInput, handleCreateFile);
$('#btn-create-change').addEventListener('click', () => createInput.click());
$('#create-title').addEventListener('input', updateCreateButton);
$('#btn-create').addEventListener('click', () => {
  resetCreate();
  show('create');
});

$('#btn-create-save').addEventListener('click', async () => {
  const title = $('#create-title').value.trim().slice(0, USER_TITLE_MAX);
  if (!state.newTopic || !title || state.busy) return;
  state.busy = true;
  show('boot');
  try {
    const res = await callServer('submitUserTopic', state.passphrase, title, state.newTopic);
    if (res.ok) {
      show('created');
      clearTimeout(createdTimer);
      createdTimer = setTimeout(() => {
        if (!$('#screen-created').classList.contains('hidden')) show('menu');
      }, CREATED_RETURN_MS);
    } else if (res.code === 'AUTH') {
      savePass('');
      show('staff');
    } else {
      show('create');
      setCreateMessage(res.message, 'error');
    }
  } catch (err) {
    show('create');
    setCreateMessage('通信エラーが発生しました。インターネット接続を確認して、もう一度お試しください。', 'error');
  } finally {
    state.busy = false;
  }
});

// ===== 採点 =====
const LOADING_TEXTS = [
  '{AI|エーアイ}が{点|てん}をつけているよ…',
  '{形|かたち}をくらべているよ…',
  '{色|いろ}を{見|み}ているよ…',
  '{細|こま}かいところを{見|み}ているよ…',
  'コメントを{考|かんが}えているよ…',
];
let loadingTimer = null;

function startLoading() {
  const started = Date.now();
  $('#loading-sec').textContent = '0';
  $('#loading-text').innerHTML = rubyHtml(LOADING_TEXTS[0]);
  loadingTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - started) / 1000);
    $('#loading-sec').textContent = sec;
    $('#loading-text').innerHTML = rubyHtml(LOADING_TEXTS[Math.floor(sec / 5) % LOADING_TEXTS.length]);
  }, 1000);
  show('loading');
}
function stopLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

async function score() {
  if (!state.submission || state.busy) return;
  state.busy = true;
  startLoading();
  try {
    const res = await callServer('scoreImage', state.passphrase, state.topicId, state.submission);
    stopLoading();
    if (res.ok) {
      renderResult(res.result);
    } else if (res.code === 'AUTH') {
      savePass('');
      show('staff');
    } else {
      showError(res.message, res.code !== 'LIMIT');
    }
  } catch (err) {
    stopLoading();
    showError('通信エラーが発生しました。インターネット接続を確認して、もう一度お試しください。', true);
  } finally {
    state.busy = false;
  }
}

function showError(message, retryable) {
  $('#error-message').textContent = message;
  $('#btn-retry').classList.toggle('hidden', !retryable);
  show('error');
}

$('#btn-score').addEventListener('click', score);
$('#btn-retry').addEventListener('click', score);
$('#btn-again').addEventListener('click', () => {
  resetSubmission();
  setFileMessage('');
  show('submit');
});

// ===== 結果表示 =====
function rankFor(total) {
  if (total >= 90) return 'すごい！ほとんど{同|おな}じだよ 🏆';
  if (total >= 75) return 'とても{上手|じょうず}！そっくりだね ✨';
  if (total >= 60) return 'いいね！よくにているよ 👍';
  if (total >= 40) return 'おしい！あと{少|すこ}し！ 💪';
  return 'チャレンジありがとう！もう{一回|いっかい}やってみよう 🎨';
}

function renderResult(result) {
  $('#result-img').src = state.submission;
  // AI のコメントも {漢字|よみがな} の形で返ってくるので、ふりがな付きで表示する
  $('#good-points').innerHTML = rubyHtml(result.goodPoints);
  $('#improvements').innerHTML = rubyHtml(result.improvements);
  $('#overall').innerHTML = rubyHtml(result.overall);
  $('#rank').innerHTML = rubyHtml(rankFor(result.total));

  const bars = $('#bars');
  bars.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const value = result.scores[c.key];
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = '<div></div><div class="bar"><span></span></div><div class="pts"></div>';
    row.children[0].innerHTML = rubyHtml(c.label);
    row.children[2].textContent = value + ' / ' + c.max;
    bars.appendChild(row);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.querySelector('.bar > span').style.width = (value / c.max * 100) + '%';
    }));
  });

  show('result');
  countUp($('#total-score'), result.total);
}

function countUp(el, target) {
  const duration = 1200;
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - started) / duration));
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

boot();
