// ローカル確認用の「偽物の GAS」。google.script.run の代わりに固定の結果を返す。
// GAS には貼り付けない。
(function () {
  // ダミーのお題（id → 描き方）
  const TOPICS = [
    { id: 'dummy-1', title: '赤い円と青い四角（ダミー）', draw: (x) => {
      x.fillStyle = '#e8553e'; x.beginPath(); x.arc(400, 450, 220, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2b6cb0'; x.fillRect(560, 560, 300, 300);
    } },
    { id: 'dummy-2', title: '黄色い三角（ダミー）', draw: (x) => {
      x.fillStyle = '#f2b705'; x.beginPath(); x.moveTo(512, 160); x.lineTo(860, 820); x.lineTo(164, 820); x.closePath(); x.fill();
    } },
    { id: 'dummy-3', title: '緑のしま模様（ダミー）', draw: (x) => {
      x.fillStyle = '#2f9e6e'; for (let i = 0; i < 5; i++) x.fillRect(120 + i * 170, 160, 90, 700);
    } },
  ];

  function render(topic, size) {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 1024, 1024);
    topic.draw(x);
    if (size === 1024) return c.toDataURL('image/png');
    const t = document.createElement('canvas');
    t.width = t.height = size;
    t.getContext('2d').drawImage(c, 0, 0, size, size);
    return t.toDataURL('image/png');
  }

  // コンソールで window.mockFailNext = true にすると、次の採点がエラーになる
  window.mockFailNext = false;

  const handlers = {
    verifyPassphrase: () => ({ ok: true }),
    // 難易度はすべて「かんたん」、線画は最初の 2 つのお題だけにある
    getGameInfo: () => ({
      ok: true,
      topics: TOPICS.map((t, i) => ({
        id: t.id, title: t.title, difficulty: 'かんたん', hasLineArt: i < 2, thumbnailUrl: render(t, 220),
      })),
      // 「使う」にチェックが入ったみんなの絵（確認用に 1 つ）
      userTopics: [{ id: 'dummy-3', title: 'みんなの絵（ダミー）', hasLineArt: false, thumbnailUrl: render(TOPICS[2], 220) }],
    }),
    // 自分で作ったお題の保存（プレビューでは保存せず、成功だけを返す）
    submitUserTopic: (pass, title) => (title ? { ok: true } : { ok: false, code: 'INVALID', message: 'タイトルを入力してください。' }),
    getTopic: (pass, id) => {
      const topic = TOPICS.find((t) => t.id === id);
      if (!topic) return { ok: false, code: 'CONFIG', message: 'このお題は選べません。お題を選び直してください' };
      return { ok: true, id: topic.id, title: topic.title, dataUrl: render(topic, 1024) };
    },
    getLineArt: (pass, id) => {
      const topic = TOPICS.slice(0, 2).find((t) => t.id === id);
      if (!topic) return { ok: false, code: 'CONFIG', message: 'このお題には線画がありません' };
      return { ok: true, mimeType: 'image/png', base64: render(topic, 1024).split(',')[1] };
    },
    scoreImage: () => {
      if (window.mockFailNext) {
        window.mockFailNext = false;
        return { ok: false, code: 'AI', message: 'AIの採点でエラーが発生しました。もう一度お試しください。' };
      }
      return {
        ok: true,
        result: {
          total: 72,
          scores: { shape: 30, color: 22, composition: 14, detail: 6 },
          goodPoints: '形の大きさと位置がよく似ています。',
          improvements: '色が少し明るすぎます。もう少し濃くすると近づきます。',
          overall: '全体の雰囲気がよく出ています！（これはダミーの結果です）',
        },
      };
    },
  };

  function runner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: (_, name) => {
        if (name === 'withSuccessHandler') return (h) => runner(h, onFailure);
        if (name === 'withFailureHandler') return (h) => runner(onSuccess, h);
        return (...args) => setTimeout(() => {
          try {
            if (onSuccess) onSuccess(handlers[name](...args));
          } catch (e) {
            if (onFailure) onFailure(e);
          }
        }, name === 'scoreImage' ? 2000 : 300);
      },
    });
  }

  window.google = { script: { get run() { return runner(null, null); } } };
})();
