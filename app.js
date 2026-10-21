(function () {
  'use strict';

  var D = window.GAME_DATA,
    E = window.TalkCardsEngine,
    A = window.TalkCardsArt,
    F = window.TableFX;
  var app = document.getElementById('app'),
    dialog = document.getElementById('confirm-dialog');
  var view = 'home',
    scene = null,
    session = null,
    busy = false,
    holding = null;
  var ritualTimeout = null,
    countdownTimeout = null,
    timerInterval = null,
    toastTimeout = null;
  var timerRemaining = 0,
    timerPaused = false,
    audio = null,
    soloDay = null;
  var choosingFan = false;
  var drawOrigin = null;
  var fanStageStates = Object.create(null), currentFanSlot = null;
  var fanGesture = null, fanScrollFrame = null, suppressFanClickUntil = 0;
  var memoryPrefs = {},
    discoveries = {},
    preferenceStorageOK = true;
  try {
    memoryPrefs = JSON.parse(localStorage.getItem('talkcards:preferences') || '{}');
    discoveries = JSON.parse(localStorage.getItem('talkcards:discoveries') || '{}');
  } catch (error) {
    preferenceStorageOK = false;
  }
  if (!memoryPrefs || typeof memoryPrefs !== 'object') memoryPrefs = {};
  if (!discoveries || typeof discoveries !== 'object') discoveries = {};
  var settings = Object.assign({
    language: 'bilingual',
    deckMode: 'curated',
    modeId: 'standard',
    names: '',
    online: false,
    plugin: false,
    timer: 0,
    sound: false,
    projection: false
  }, memoryPrefs);
  // 旧设置或被手动改坏的本机数据不应阻塞重新开局。
  if (['zh', 'en', 'bilingual'].indexOf(settings.language) === -1) settings.language = 'bilingual';
  if (['curated', 'fullBox'].indexOf(settings.deckMode) === -1) settings.deckMode = 'curated';
  if (typeof settings.names !== 'string') settings.names = '';
  if ([0, 60, 120, 180].indexOf(settings.timer) === -1) settings.timer = 0;
  ['online', 'plugin', 'sound', 'projection'].forEach(function (key) {
    settings[key] = settings[key] === true;
  });
  var sceneDecor = {
    strangers: ['weather', '#96b9cc'],
    friends: ['imagination', '#b09fc9'],
    confidants: ['shadow', '#c78b93'],
    partners: ['intimacy', '#d5a183'],
    solo: ['future', '#9cbaa5']
  };
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (s) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[s];
    });
  }
  function savePrefs() {
    try {
      localStorage.setItem('talkcards:preferences', JSON.stringify(settings));
    } catch (error) {
      preferenceStorageOK = false;
    }
  }
  function saveDiscoveries() {
    try {
      localStorage.setItem('talkcards:discoveries', JSON.stringify(discoveries));
    } catch (error) {
      preferenceStorageOK = false;
      toast('本机存储写入失败，导出文字可保留这次记录。');
    }
  }
  function storageNotice() {
    var status = E.storageStatus();
    return status.ok && preferenceStorageOK ? '' : '<p class="storage-warning">' + esc(status.message || '本机存储暂时不可用，刷新后记录可能丢失。') + '</p>';
  }
  function toast(message) {
    var el = document.getElementById('toast');
    clearTimeout(toastTimeout);
    el.textContent = message;
    el.classList.add('visible');
    toastTimeout = setTimeout(function () {
      el.classList.remove('visible');
    }, 3500);
  }
  function confirm(title, message, yes, no) {
    cancelHold();
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-message').textContent = message;
    document.getElementById('dialog-yes').textContent = yes || '大家都同意';
    document.getElementById('dialog-no').textContent = no || '先跳过';
    return new Promise(function (resolve) {
      function finish(value) {
        dialog.close();
        dialog.oncancel = null;
        document.getElementById('dialog-yes').onclick = null;
        document.getElementById('dialog-no').onclick = null;
        resolve(value);
      }
      dialog.oncancel = function (event) {
        event.preventDefault();
        finish(false);
      };
      document.getElementById('dialog-yes').onclick = function () {
        finish(true);
      };
      document.getElementById('dialog-no').onclick = function () {
        finish(false);
      };
      dialog.showModal();
      document.getElementById('dialog-no').focus();
    });
  }
  function applyProjection() {
    document.body.classList.toggle('projection', !!settings.projection);
    var b = document.getElementById('projection-button');
    b.classList.toggle('active', !!settings.projection);
    b.setAttribute('aria-pressed', String(!!settings.projection));
    b.setAttribute('aria-label', settings.projection ? '关闭投屏大字模式' : '开启投屏大字模式');
  }
  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRemaining = 0;
    timerPaused = false;
  }
  function cleanOverlays() {
    if (F) F.cleanup();
    document.querySelectorAll('#ending-light,#round-memory-transition').forEach(function (el) { el.remove(); });
    document.body.classList.remove('ending-warm');
    clearTimeout(ritualTimeout);
    clearTimeout(countdownTimeout);
    document.querySelectorAll('.ritual,.countdown').forEach(function (e) {
      e.remove();
    });
    cancelHold();
    stopTimer();
    busy = false;
    document.getElementById('home-button').disabled = false;
    document.getElementById('projection-button').disabled = false;
  }
  function mount(html, scroll) {
    cancelHold();
    app.innerHTML = html;
    applyProjection();
    if (scroll !== false) {
      window.scrollTo(0, 0);
      app.focus({
        preventScroll: true
      });
    }
  }
  function listen(id, fn, event) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event || 'click', fn);
  }
  function sceneName() {
    return scene ? scene.name : '';
  }
  function sceneCount() {
    var counts = scene.counts;
    if (scene.id === 'partners') counts = counts[settings.modeId];
    return counts ? counts[settings.deckMode] : 0;
  }
  function poolDescription() {
    return '本次牌池 ' + sceneCount() + ' 张' + (scene.id === 'partners' ? ' · 亲密阶段按所选玩法分配' : '') + (settings.plugin && scene.counts.plugin ? ' + 插件 ' + scene.counts.plugin[settings.deckMode] + ' 张' : '');
  }
  function home() {
    cleanOverlays();
    view = 'home';
    session = null;
    scene = null;
    fanStageStates = Object.create(null); currentFanSlot = null;
    mount('<section class="home-hero"><div class="hero-copy"><p class="eyebrow">PUT THE WORLD ON PAUSE</p><h1>把时间，<br>留给<span>彼此。</span></h1><p>从一张卡开始，聊聊那些没来得及说的话。<br>没有标准答案，只需要一点好奇和愿意倾听的心。</p></div><div class="hero-art" aria-hidden="true">' + ['weather', 'story', 'intimacy'].map(function (k, i) {
      return '<div class="mini-card" style="--x:' + (i - 1) * 76 + 'px;--r:' + (i - 1) * 17 + 'deg">' + A.back(k) + '</div>';
    }).join('') + '</div></section>' + '<section aria-labelledby="scene-heading"><div class="section-heading"><h2 id="scene-heading">今晚，和谁聊？</h2><p>' + D.cards.length + ' 张卡 · ' + D.series.length + ' 个系列 · 5 种相处方式</p></div><div class="scene-grid">' + D.scenes.map(function (s, i) {
      var dec = sceneDecor[s.id];
      return '<button class="scene-card" data-scene="' + s.id + '" style="--scene-color:' + dec[1] + '"><span class="scene-top"><span class="scene-icon" aria-hidden="true">' + A.icon(dec[0]) + '</span><span class="scene-number">0' + (i + 1) + ' / 05</span></span><h3>' + esc(s.name) + '</h3><span class="english">' + esc(s.nameEn.toUpperCase()) + '</span><p class="scene-for">' + esc(s.for) + '</p><span class="scene-meta"><span>' + esc(s.players) + ' 人</span><span>·</span><span>' + esc(s.duration) + '</span></span><span class="scene-level">' + esc(s.levelText) + '</span></button>';
    }).join('') + '</div></section><div class="home-note"><span>✦ 不急着回答，也不急着评判。</span><span>一台设备，轮流抽牌。可以“过”，不用解释。</span></div>' + storageNotice());
    app.querySelectorAll('[data-scene]').forEach(function (b) {
      b.onclick = function () {
        selectScene(b.dataset.scene);
      };
    });
  }
  function selectScene(id) {
    scene = E.scene(id);
    view = 'settings';
    settings.modeId = scene.modes.length ? scene.modes[0].id : 'solo';
    settings.online = false;
    settings.plugin = false;
    renderSettings();
  }
  function choices(name, items, current) {
    return '<div class="choice-row">' + items.map(function (it) {
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + esc(it[0]) + '" ' + (String(current) === String(it[0]) ? 'checked' : '') + '><span>' + esc(it[1]) + '</span></label>';
    }).join('') + '</div>';
  }
  function renderSettings() {
    cleanOverlays();
    var solo = scene.id === 'solo';
    view = 'settings';
    mount('<section class="page-shell"><button class="back-link" id="back-home">← 选择其他场景</button><div class="page-heading"><p class="eyebrow">MAKE YOURSELF COMFORTABLE</p><h1>' + esc(scene.name) + '</h1><p>' + esc(scene.for) + '</p></div>' + storageNotice() + '<form id="settings-form"><div class="settings-panel">' + (solo ? '' : '<div class="setting-group"><label class="field-title" for="player-names">谁在这里 <small>可不填，最多 10 人；用逗号或换行分隔</small></label><textarea id="player-names" rows="2" maxlength="400" placeholder="例如：小林，阿青，小南">' + esc(settings.names) + '</textarea><p class="help-text">填了名字，会按顺序提示轮到谁，并记住每人剩下的“过”。</p></div>') + '<div class="setting-group"><span class="field-title">卡面语言</span>' + choices('language', [['zh', '中文'], ['en', 'English'], ['bilingual', '双语']], settings.language) + '</div>' + (scene.modes.length > 1 ? '<div class="setting-group"><span class="field-title">今晚的节奏</span>' + choices('modeId', scene.modes.map(function (m) {
      return [m.id, m.name];
    }), settings.modeId) + '<p id="mode-desc" class="setting-description">' + esc(scene.modes.find(function (m) {
      return m.id === settings.modeId;
    }).desc) + '</p></div>' : '') + (solo ? '' : '<div class="setting-group"><span class="field-title">卡组</span>' + choices('deckMode', Object.keys(D.deckModes).map(function (k) {
      return [k, D.deckModes[k].name];
    }), settings.deckMode) + '<p id="deck-desc" class="setting-description">' + esc(D.deckModes[settings.deckMode].desc) + '</p><p id="pool-count" class="help-text">' + poolDescription() + '</p></div>') + (solo ? '' : '<div class="setting-group"><label class="field-title" for="answer-timer">回答计时器 <small>只轻轻提醒，不打断回答</small></label><select id="answer-timer"><option value="0">关闭</option><option value="60">1 分钟</option><option value="120">2 分钟</option><option value="180">3 分钟</option></select></div>') + '</div><div class="settings-panel">' + (scene.id === 'strangers' ? '<div class="toggle-row"><label for="online-mode">线上模式<small>显示共享屏幕时的玩法提示</small></label><input id="online-mode" type="checkbox" ' + (settings.online ? 'checked' : '') + '></div><div id="online-tips" class="help-text" ' + (settings.online ? '' : 'hidden') + '>' + scene.onlineTips.map(function (t) {
      return '<p>· ' + esc(t) + '</p>';
    }).join('') + '</div>' : '') + (scene.plugins.length ? '<div class="toggle-row"><label for="plugin-mode">' + esc(scene.plugins[0].name) + '<small>进入前需要全员同意，随时可以跳过</small></label><input id="plugin-mode" type="checkbox" ' + (settings.plugin ? 'checked' : '') + '></div>' : '') + '<div class="toggle-row"><label for="sound-mode">轻声音效<small>抽牌和计时提醒，默认关闭</small></label><input id="sound-mode" type="checkbox" ' + (settings.sound ? 'checked' : '') + '></div><div class="toggle-row"><label for="screen-mode">投屏大字模式<small>视频会议共享屏幕时更容易读</small></label><input id="screen-mode" type="checkbox" ' + (settings.projection ? 'checked' : '') + '></div><div class="toggle-row"><label>已抽记录<small>只重置这个场景的抽牌记录和顺序进度' + (solo ? '；日记保留' : '') + '</small></label><button class="text-button" type="button" id="reset-history">重置</button></div></div><div class="page-actions"><button type="submit" class="button primary">看看玩法 →</button></div><p class="rules-footer">所有记录都留在这台设备的当前浏览器里。</p></form></section>');
    var form = document.getElementById('settings-form');
    if (!solo) document.getElementById('answer-timer').value = String(settings.timer);
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name) settings[t.name] = t.value;else if (t.id === 'answer-timer') settings.timer = Number(t.value);else if (t.id === 'online-mode') {
        settings.online = t.checked;
        document.getElementById('online-tips').hidden = !t.checked;
      } else if (t.id === 'sound-mode') {
        settings.sound = t.checked;
        if (t.checked) sound('flip');
      } else if (t.id === 'screen-mode') {
        settings.projection = t.checked;
        applyProjection();
      }
      if (t.name === 'deckMode') document.getElementById('deck-desc').textContent = D.deckModes[settings.deckMode].desc;
      if (t.name === 'modeId') document.getElementById('mode-desc').textContent = scene.modes.find(function (m) {
        return m.id === settings.modeId;
      }).desc;
      if (document.getElementById('pool-count')) document.getElementById('pool-count').textContent = poolDescription();
      savePrefs();
    });
    listen('plugin-mode', async function (e) {
      if (e.target.checked) {
        var yes = await confirm('全员都同意吗？', scene.plugins[0].howTo, '全员同意，加入', '这次先不加');
        settings.plugin = yes;
        e.target.checked = yes;
      } else settings.plugin = false;
      savePrefs();
      document.getElementById('pool-count').textContent = poolDescription();
    }, 'change');
    listen('reset-history', async function () {
      if (await confirm('重置已抽记录？', '会清空' + scene.name + '的已抽记录与顺序进度。下次从头抽起。' + (solo ? '已写的日记会保留。' : ''), '确认重置', '保留记录')) {
        E.resetSceneHistory(scene.id);
        toast('这个场景的抽牌记录已重置。');
      }
    });
    listen('back-home', home);
    form.onsubmit = function (e) {
      e.preventDefault();
      if (dialog.open) return;
      if (!solo) {
        settings.names = document.getElementById('player-names').value;
        var names = parseNames();
        if (names.length > 10) {
          toast('最多 10 位玩家，请减少一些名字。');
          return;
        }
      }
      savePrefs();
      renderRules();
    };
  }
  function parseNames() {
    return settings.names.split(/[，,、\n]+/).map(function (n) {
      return n.trim().slice(0, 30);
    }).filter(Boolean);
  }
  function list(items, ordered) {
    return '<' + (ordered ? 'ol' : 'ul') + '>' + items.map(function (t) {
      return '<li>' + esc(t) + '</li>';
    }).join('') + '</' + (ordered ? 'ol' : 'ul') + '>';
  }
  function renderRules() {
    view = 'rules';
    mount('<section class="page-shell"><button class="back-link" id="back-settings">← 调整设置</button><div class="page-heading"><p class="eyebrow">A LITTLE SPACE FOR HONESTY</p><h1>先约定，后开口。</h1><p>' + esc(scene.name) + ' · ' + (scene.id === 'solo' ? '今日一张' : esc(D.deckModes[settings.deckMode].name) + (scene.id === 'partners' ? ' · ' + esc(scene.modes.find(function (m) {
      return m.id === settings.modeId;
    }).name) : '')) + '</p></div><div class="rule-panel"><h2>今晚怎么玩</h2>' + list(scene.playNotes) + '</div><div class="rule-panel"><h2>我们的小约定</h2>' + list(D.rules, true) + '</div>' + (scene.notIncluded.length ? '<div class="rule-panel"><h2>这个场景暂时不聊</h2>' + list(scene.notIncluded) + '</div>' : '') + (settings.online && scene.onlineTips.length ? '<div class="rule-panel"><h2>线上小提示</h2>' + list(scene.onlineTips) + '</div>' : '') + '<div class="page-actions"><button class="button primary" id="begin-game">' + (scene.id === 'solo' ? '留一点时间给自己' : '大家准备好了，开始') + ' →</button></div></section>');
    listen('back-settings', renderSettings);
    listen('begin-game', startGame);
  }
  function startGame() {
    if (busy) return;
    view = 'ritual';
    if (scene.id !== 'solo') {
      fanStageStates = Object.create(null); currentFanSlot = null;
      session = E.createSession({
      sceneId: scene.id,
      modeId: settings.modeId,
      deckMode: settings.deckMode,
      players: parseNames(),
      pluginIds: settings.plugin ? scene.plugins.map(function (p) {
        return p.id;
      }) : []
      });
    }
    busy = true;
    var ritual = document.createElement('div');
    ritual.className = 'ritual';
    ritual.tabIndex = 0;
    ritual.setAttribute('role', 'button');
    ritual.setAttribute('aria-label', '跳过开场仪式');
    ritual.innerHTML = '<div class="ritual-orbit"></div><p>深呼吸。<br>今晚，我们只说真话。</p><small>点击任意处跳过</small>';
    document.body.appendChild(ritual);
    ritual.focus();
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(ritualTimeout);
      ritual.remove();
      busy = false;
      if (scene.id === 'solo') renderSolo(true);else enterStage(0, true);
    }
    ritual.onclick = finish;
    ritual.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finish();
      }
    };
    ritualTimeout = setTimeout(finish, 4000);
  }
  function cardMarkup(card, options) {
    options = options || {};
    var s = D.series.find(function (x) {
        return x.key === card.series;
      }),
      lang = settings.language;
    return '<article class="conversation-card ' + (options.pending ? 'pending' : options.animate ? '' : 'revealed') + ' ' + (card.level >= 4 ? 'deep' : '') + '" style="--series-color:' + s.color + ';--series-light:' + s.color2 + '" aria-label="' + (options.pending ? '等待同意后翻牌' : esc(s.zh + ' ' + card.code)) + '">' + (options.pending ? '' : '<div class="card-face ' + (card.series === 'shadow' ? 'shadow-face' : '') + '"><div class="card-head"><span class="card-series">' + esc(lang === 'en' ? s.en : s.zh) + (lang === 'bilingual' ? '<small>' + esc(s.en) + '</small>' : '') + '</span><span class="card-level">' + esc(card.levelLabel) + '</span></div>' + (lang !== 'en' ? '<p class="card-question">' + esc(card.zh) + '</p>' : '') + (lang !== 'zh' ? '<p class="card-question-en ' + (lang === 'en' ? 'english-main' : '') + '">' + esc(card.en) + '</p>' : '') + '<div class="card-foot"><span>' + esc(card.tag) + '</span><span>' + esc(card.code) + '</span></div>' + (options.everyone ? '<div class="everyone-label">所有人都答</div>' : '') + '</div>') + '<div class="card-reverse" aria-hidden="true">' + A.back(card.series, {
      language: lang
    }) + '</div></article>';
  }
  function hints(card) {
    var out = [];
    scene.hints.forEach(function (h) {
      if (h.onlineOnly && !settings.online) return;
      if (h.series === card.series || (h.match || []).some(function (word) {
        return card.zh.indexOf(word) !== -1;
      })) out.push('<p>' + esc(h.hint) + '</p>');
    });
    if (card.level >= 4) {
      out.push('<p class="care-hint">答完后，听的人先说一句：谢谢你告诉我</p>');
      if (card.levelType === 'spice' && card.level === 5) out.push('<p class="care-hint">坦白局：听的人只听，不辩解</p>');
    }
    if (card.series === 'views') out.push('<p>' + ((card.tag || '').indexOf('滑杆') !== -1 ? (settings.online ? '同时在聊天框发 0–3（0 表示哪一档都不会）' : '同时伸出 0–3 根手指（0 表示哪一档都不会）') : '同时亮态度，少数派先说') + '</p>');
    return out.join('');
  }
  // 动画只更新桌面的局部节点；业务选牌仍由引擎决定。
  function setGameBusy(value) {
    busy = value;
    document.getElementById('home-button').disabled = value;
    document.getElementById('projection-button').disabled = value;
    if (view === 'game') syncGameUI();
  }
  function availability() { return session.drawAvailability(); }
  function talkedRecords() {
    return session.state.history.filter(function (r) { return r.status !== 'passed' && r.status !== 'current'; });
  }
  function fanState() {
    var key = session.stage.id + ':' + session.state.stageIndex;
    if (!fanStageStates[key]) {
      // 每个阶段首次只分配当局未消耗的库存；内部题目映射不决定随机抽题。
      var slots = availability().allCards.map(function (card, index) {
        return {key: 'slot-' + session.state.stageIndex + '-' + index, cardId: card.id, status: 'available'};
      });
      for (var i = slots.length - 1; i > 0; i -= 1) {
        var j = Math.floor(Math.random() * (i + 1)), swap = slots[i]; slots[i] = slots[j]; slots[j] = swap;
      }
      slots.forEach(function (slot, index) { slot.index = index; });
      fanStageStates[key] = {key: key, slots: slots, rejectedIds: new Set(), prepared: false,
        scrollLeft: null, signature: null, single: session.stage.draw === 'fixed' || slots.length === 1};
    }
    return fanStageStates[key];
  }
  function fanStock(model) {
    return model.slots.filter(function (slot) { return slot.status === 'available'; }).length;
  }
  function reconcileFan(model, replayPick) {
    var used = new Set(session.state.history.filter(function (r) { return r.status !== 'passed'; }).map(function (r) { return r.cardId; }));
    model.slots.forEach(function (slot) {
      if (model.rejectedIds.has(slot.cardId)) slot.status = 'rejected';
      else if (used.has(slot.cardId)) slot.status = 'drawn';
      else if (slot.status !== 'pending') slot.status = 'available';
    });
    // 引擎换阶段会清临时拒绝；只在空闲时重放曾经明确拒绝的选牌决定。
    if (replayPick && session.stage.draw === 'pick' && !busy && !session.state.current && !session.state.pending) {
      for (var attempt = 0; attempt < model.rejectedIds.size; attempt += 1) {
        var a = availability();
        if (!a.canDraw) break;
        var rejected = a.cards.find(function (card) { return card.level >= 4 && model.rejectedIds.has(card.id); });
        if (!rejected) break;
        var result = session.draw(rejected.id);
        if (!result.ok || !result.needsConsent) break;
        session.rejectPending();
      }
    }
    var candidates = new Set(availability().cards.map(function (card) { return card.id; }));
    model.slots.forEach(function (slot) {
      slot.kind = slot.status !== 'available' ? 'hole'
        : session.stage.draw === 'pick' && !candidates.has(slot.cardId) ? 'latent' : 'card';
    });
    return model;
  }
  function fanCanDraw() {
    return !!session && !busy && !dialog.open && availability().canDraw && fanStock(fanState()) > 0
      && (!session.state.current || choosingFan);
  }
  function slotMarkup(model) {
    var pick = session.stage.draw === 'pick';
    var commonSeries = session.pool().length ? session.pool()[0].series : 'weather';
    return model.slots.map(function (slot) {
      var attrs = ' data-slot="' + slot.key + '" data-slot-index="' + slot.index + '"';
      if (slot.kind === 'hole') return '<span class="fan-hole"' + attrs + ' aria-hidden="true"></span>';
      var series = pick ? E.card(slot.cardId).series : commonSeries;
      if (slot.kind === 'latent') return '<span class="fan-latent"' + attrs + ' inert role="img" aria-label="这张卡暂不可选，尚未抽走">' + A.back(series, {language: settings.language}) + '</span>';
      var tag = pick ? 'button' : 'span';
      return '<' + tag + ' class="fan-card"' + attrs + (pick
        ? ' data-pick="' + slot.cardId + '" aria-label="选择这张卡（第 ' + (slot.index + 1) + ' 张，共 ' + model.slots.length + ' 张）"'
        : ' aria-hidden="true"') + '>' + A.back(series, {language: settings.language}) + '</' + tag + '>';
    }).join('');
  }
  function fanCaption(model) {
    var wheel = !model.single && model.slots.length > (window.innerWidth <= 600 ? 7 : 9);
    return '本阶段还有 ' + fanStock(model) + ' 张' + (wheel ? ' · 左右滑动查看' : session.stage.draw === 'pick' && fanStock(model) ? ' · 选一张有感觉的卡' : '');
  }
  function fanMarkup() {
    if (session.stage.draw === 'none') return '';
    var model = reconcileFan(fanState(), true), pick = session.stage.draw === 'pick';
    var viewportLabel = pick ? '卡牌区，可左右查看，点选一张卡' : '卡牌区，可左右查看，长按空格翻开中心附近的卡';
    var deckLabel = pick ? '点选一张卡背，翻开你的选择' : '按住一张卡约 0.8 秒，松手翻开';
    model.signature = slotMarkup(model);
    return '<div class="fan-wheel-wrap"><button type="button" class="fan-wheel-arrow" data-fan-direction="-1" aria-label="向左查看卡牌">←</button><div class="fan-wheel-viewport" tabindex="0" role="group" aria-label="' + viewportLabel + '"><div id="deck" class="table-fan ' + (model.single ? 'single-ritual ' : '') + (pick ? 'pick-fan' : 'hold-fan') + '" role="' + (pick ? 'group' : 'button') + '" tabindex="' + (pick ? '-1' : '0') + '" aria-label="' + deckLabel + '" data-slot-count="' + model.slots.length + '" data-count="' + fanStock(model) + '">' + model.signature + '</div></div><button type="button" class="fan-wheel-arrow" data-fan-direction="1" aria-label="向右查看卡牌">→</button></div>' + (!pick ? '<svg class="fan-hold-arc" viewBox="0 0 300 30" aria-hidden="true"><path d="M 10 8 Q 150 32 290 8"/><path class="fan-hold-progress" pathLength="1" d="M 10 8 Q 150 32 290 8"/></svg>' : '') + '<p class="fan-caption">' + esc(fanCaption(model)) + '</p>';
  }
  function saveFanScroll() {
    var viewport = app.querySelector('.fan-wheel-viewport');
    if (viewport && session && session.stage.draw !== 'none') fanState().scrollLeft = viewport.scrollLeft;
  }
  function updateFanArrows() {
    var viewport = app.querySelector('.fan-wheel-viewport');
    if (!viewport) return;
    app.querySelectorAll('[data-fan-direction]').forEach(function (button) {
      var left = Number(button.dataset.fanDirection) < 0;
      button.disabled = busy || (left ? viewport.scrollLeft <= 1 : viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth - 1);
    });
  }
  function moveFan(direction) {
    var viewport = app.querySelector('.fan-wheel-viewport');
    if (!viewport || busy) return;
    cancelHold();
    viewport.scrollLeft += direction * Math.max(80, viewport.clientWidth * .6);
    saveFanScroll(); F.updateWheel(app.querySelector('.table-fan')); updateFanArrows();
  }
  function bindPickButtons() {
    app.querySelectorAll('[data-pick]').forEach(function (button) {
      button.onclick = function (event) {
        event.preventDefault();
        if (event.detail && performance.now() < suppressFanClickUntil) return;
        if (fanCanDraw()) drawCard(button.dataset.pick, button);
      };
    });
  }
  function paintFan(replayPick) {
    var fan = app.querySelector('.table-fan');
    if (!fan || session.stage.draw === 'none') return;
    var model = reconcileFan(fanState(), replayPick), markup = slotMarkup(model);
    saveFanScroll();
    if (markup !== model.signature) {
      fan.innerHTML = markup; model.signature = markup;
      bindPickButtons();
    }
    fan.dataset.count = fanStock(model); fan.dataset.slotCount = model.slots.length;
    var wrap = app.querySelector('.fan-wheel-wrap');
    wrap.classList.toggle('is-exhausted', fanStock(model) === 0);
    var caption = app.querySelector('.fan-caption');
    if (caption) caption.textContent = fanCaption(model);
    F.layout(fan, {scrollLeft: model.scrollLeft}); updateFanArrows();
  }
  function wireFan() {
    var fan = app.querySelector('.table-fan');
    if (!fan) return;
    var model = fanState(), viewport = app.querySelector('.fan-wheel-viewport');
    F.layout(fan, {initialCenter: model.scrollLeft === null, scrollLeft: model.scrollLeft});
    saveFanScroll(); bindPickButtons();
    viewport.onscroll = function () {
      saveFanScroll();
      if (fanScrollFrame) return;
      fanScrollFrame = requestAnimationFrame(function () {
        fanScrollFrame = null;
        if (fan.isConnected) { F.updateWheel(fan); updateFanArrows(); }
      });
    };
    viewport.addEventListener('wheel', function (event) {
      if (busy || !viewport.parentElement.classList.contains('is-wheel')) return;
      var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      var before = viewport.scrollLeft;
      viewport.scrollLeft += delta * (event.deltaMode === 1 ? 16 : 1);
      if (viewport.scrollLeft !== before || event.deltaX) event.preventDefault();
    }, {passive: false});
    app.querySelectorAll('[data-fan-direction]').forEach(function (button) {
      button.onclick = function () { moveFan(Number(button.dataset.fanDirection)); };
    });
    viewport.onpointerdown = function (event) {
      if (event.button !== 0 || busy || fanGesture || holding || dialog.open) return;
      var source = null;
      if (fanCanDraw()) {
        if (session.stage.draw === 'pick') {
          var hit = event.target.closest('.fan-card');
          if (hit && fan.contains(hit) && !hit.disabled) source = hit;
        } else source = sourceAtPress(fan, event);
      }
      fanGesture = {pointerId: event.pointerId, source: source, startX: event.clientX, startY: event.clientY,
        startScroll: viewport.scrollLeft, mode: 'press', captureEl: viewport};
      if (session.stage.draw === 'pick') { if (source) selectFanSource(source); }
      else if (source) beginHold(fan, source, event.pointerId, viewport);
      viewport.setPointerCapture(event.pointerId);
      if (event.pointerType === 'mouse') event.preventDefault();
    };
    viewport.onpointermove = function (event) {
      var gesture = fanGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      var dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
      if (gesture.mode === 'press' && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        cancelHold(false, true); gesture.mode = Math.abs(dx) > Math.abs(dy) ? 'pan' : 'vertical';
        suppressFanClickUntil = performance.now() + 500;
      }
      if (gesture.mode === 'pan') {
        viewport.scrollLeft = gesture.startScroll - dx; event.preventDefault();
      }
    };
    viewport.onpointerup = function (event) {
      var gesture = fanGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      fanGesture = null; suppressFanClickUntil = performance.now() + 500;
      if (gesture.mode === 'press' && gesture.source && fanCanDraw()) {
        event.preventDefault();
        if (session.stage.draw === 'pick') {
          if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
          drawCard(gesture.source.dataset.pick, gesture.source);
        } else releaseHold();
      } else cancelHold();
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    };
    viewport.onpointercancel = function (event) { if (fanGesture && fanGesture.pointerId === event.pointerId) cancelHold(); };
    viewport.onlostpointercapture = function (event) { if (fanGesture && fanGesture.pointerId === event.pointerId) cancelHold(); };
    fan.onclick = function (event) { if (session.stage.draw !== 'pick') event.preventDefault(); };
  }
  async function refreshFan() {
    paintFan(false); syncGameUI();
    var fan = app.querySelector('.table-fan');
    if (fan) await F.prepare(fan, {initial: false});
  }
  function syncGameUI() {
    if (!session || view !== 'game') return;
    if (!busy) paintFan(true);
    var st = session.state, a = availability(), current = !!st.current && !choosingFan;
    var stock = session.stage.draw === 'none' ? 0 : fanStock(fanState());
    var passLeft = st.players.length ? 2 - st.passCounts[st.playerIndex] : null;
    var turn = document.getElementById('turn-name');
    if (!turn) return;
    turn.textContent = st.players.length ? '轮到 ' + session.playerName : session.stage.everyoneAnswers ? '所有人都答' : '轮流聊聊';
    document.getElementById('draw-count').textContent = '已抽 ' + session.stageDrawCount + (session.stage.maxDraws != null ? ' / ' + session.stage.maxDraws : '') + ' 张';
    // 忙碌动画期间隐藏计时器，翻稳后再显示回答时间。
    var timerSlot = document.getElementById('timer-slot'), showTimer = settings.timer && current && !busy;
    if (showTimer && !document.getElementById('timer-button')) {
      timerSlot.innerHTML = '<button id="timer-button" class="timer-button" aria-label="暂停或继续计时"></button>';
      listen('timer-button', function () { if (!busy) { timerPaused = !timerPaused; updateTimer(); } });
    } else if (!showTimer) timerSlot.innerHTML = '';
    var next = document.getElementById('next-player'), pass = document.getElementById('pass-card');
    next.disabled = busy || !current;
    pass.disabled = busy || !current || passLeft === 0;
    pass.textContent = '过' + (passLeft !== null ? ' · ' + passLeft + '/2' : '');
    document.getElementById('draw-again').disabled = busy || !a.canDraw || !stock;
    document.getElementById('previous-stage').disabled = busy || st.stageIndex === 0;
    document.getElementById('next-stage').disabled = busy;
    document.getElementById('end-early').disabled = busy;
    app.querySelectorAll('[data-stage]').forEach(function (b) { b.disabled = busy; });
    app.querySelectorAll('[data-pick]').forEach(function (b) { b.disabled = busy || !a.canDraw || current || !stock; });
    var deck = document.getElementById('deck');
    if (deck) {
      deck.setAttribute('aria-disabled', String(busy || !a.canDraw || current || !stock));
      deck.classList.toggle('unavailable', !a.canDraw || current || !stock);
    }
    updateFanArrows();
    var hint = st.pending ? '先确认，再慢慢翻开。' : current ? '先听完，再回应。' : session.stage.draw === 'none' ? '把今晚想记住的那句话，留给彼此。' : a.reason === 'limit' ? '本阶段已到抽牌上限，进入下一阶段吧。' : !stock || a.reason === 'empty' ? (a.declinedCount ? '这一阶段的卡都放回了，可以进入下一阶段。' : '这一阶段的卡已抽完，可以进入下一阶段。') : session.stage.draw === 'pick' ? '点选一张卡背，翻开你的选择。' : '按住一张卡，松手翻开 · 电脑也可以长按空格';
    document.getElementById('draw-hint').textContent = hint;
    document.getElementById('card-hints').innerHTML = current ? hints(st.current) : '';
    var views = document.getElementById('views-action');
    if (current && st.current.series === 'views') {
      if (!document.getElementById('views-countdown')) {
        views.innerHTML = '<button id="views-countdown" class="button secondary">同时亮态度 · 3、2、1</button>';
        listen('views-countdown', viewsCountdown);
      }
      document.getElementById('views-countdown').disabled = busy;
    } else views.innerHTML = '';
    var completed = talkedRecords();
    document.getElementById('talked-count').textContent = '已聊 ' + completed.length + ' 张';
    var pile = document.getElementById('pile-back');
    pile.innerHTML = completed.length ? A.back(E.card(completed[completed.length - 1].cardId).series) : '';
    app.setAttribute('aria-busy', String(busy));
    updateTimer();
  }
  function setCentral(card, pending, animate) {
    var slot = document.getElementById('central-card');
    slot.innerHTML = card ? cardMarkup(card, {pending: pending, everyone: session.stage.everyoneAnswers, animate: animate}) : '';
    var el = slot.querySelector('.conversation-card');
    if (el) {
      el.classList.add('table-big-card');
      if (pending) {
        // 在屏幕外测量最终卡面，确认前桌面和辅助阅读均只有卡背。
        var measure = document.createElement('div');
        measure.setAttribute('aria-hidden', 'true');
        Object.assign(measure.style, {position: 'fixed', left: '-10000px', visibility: 'hidden', width: el.getBoundingClientRect().width + 'px'});
        measure.innerHTML = cardMarkup(card, {everyone: session.stage.everyoneAnswers});
        measure.firstElementChild.style.width = '100%';
        document.body.appendChild(measure);
        el.style.minHeight = measure.firstElementChild.getBoundingClientRect().height + 'px';
        measure.remove();
      }
    }
    return el;
  }
  function renderGame(scroll) {
    var st = session.state, stage = session.stage;
    mount('<section class="game-shell"><div class="game-topline"><div class="game-title"><strong>' + esc(scene.name) + '</strong>' + esc(st.mode.name) + ' · ' + esc(D.deckModes[settings.deckMode].name) + '</div><button id="end-early" class="text-button">结束这一局 ↗</button></div><nav class="stage-tabs" aria-label="阶段进度">' + st.stages.map(function (s, i) {
      return '<button class="stage-tab ' + (i === st.stageIndex ? 'active' : i < st.stageIndex ? 'done' : '') + '" data-stage="' + i + '" ' + (i === st.stageIndex ? 'aria-current="step"' : '') + '>' + esc(s.name) + '</button>';
    }).join('') + '</nav><div class="stage-intro"><p class="eyebrow">' + String(st.stageIndex + 1).padStart(2, '0') + ' / ' + String(st.stages.length).padStart(2, '0') + '</p><h1>' + esc(stage.name) + '</h1><p>' + esc(stage.howTo) + (stage.minutes ? '<span class="stage-time">' + esc(stage.minutes) + '</span>' : '') + '</p></div><div class="turn-bar"><strong id="turn-name"></strong><span id="draw-count"></span><span id="timer-slot"></span></div><div class="table-stage"><div id="talked-pile" class="talked-pile" aria-label="已聊牌堆"><div id="pile-back" aria-hidden="true"></div><span id="talked-count"></span></div><div id="central-card" class="table-card-slot"></div>' + (stage.draw === 'none' ? '<div class="empty-stage">' + esc(stage.howTo) + '</div>' : '') + '<div id="fan-rail" class="fan-rail">' + fanMarkup() + '</div></div><p id="draw-hint" class="draw-hint"></p><div id="card-hints" class="card-hints"></div><div id="views-action"></div><div class="game-controls"><button id="next-player" class="button primary">' + (st.players.length ? '下一位 →' : '答完了 →') + '</button><button id="pass-card" class="button secondary">过</button><button id="draw-again" class="button secondary">再抽一张</button></div><div class="stage-navigation"><button class="text-button" id="previous-stage">← 上一阶段</button><button class="text-button" id="next-stage">' + (st.stageIndex === st.stages.length - 1 ? '聊完了，结束 →' : '下一阶段 →') + '</button></div></section>', scroll);
    if (st.current || st.pending) setCentral(st.current || st.pending, !!st.pending, false);
    wireFan(); syncGameUI();
    app.querySelectorAll('[data-stage]').forEach(function (b) { b.onclick = function () { if (Number(b.dataset.stage) !== st.stageIndex) enterStage(Number(b.dataset.stage)); }; });
    listen('next-stage', function () { enterStage(st.stageIndex + 1); });
    listen('previous-stage', function () { enterStage(st.stageIndex - 1); });
    listen('end-early', async function () {
      if (busy) return;
      setGameBusy(true);
      var yes = await confirm('结束这一局？', '已抽的卡会排成这一局的回顾。', '结束并回顾', '再聊一会');
      setGameBusy(false);
      if (yes) endGame();
    });
    listen('draw-again', drawAgain);
    listen('next-player', answerCard);
    listen('pass-card', passCard);
  }
  async function enterStage(index) {
    if (busy || !session) return;
    if (index >= session.state.stages.length) { endGame(); return; }
    if (index < 0) return;
    var target = session.state.stages[index];
    if (target.requiresConsent) {
      setGameBusy(true);
      var yes = await confirm('进入「' + target.name + '」？', target.howTo + '\n只有全员同意，才继续这一阶段。', '全员同意，继续', '跳过这一阶段');
      setGameBusy(false);
      if (!yes) return enterStage(Math.max(0, index + (index < session.state.stageIndex ? -1 : 1)));
    }
    setGameBusy(true); stopTimer();
    try {
      saveFanScroll();
      var current = app.querySelector('.table-big-card');
      if (current) await F.collect({card: current, targetPile: document.getElementById('talked-pile')});
      choosingFan = false; drawOrigin = null; currentFanSlot = null; session.goStage(index); view = 'game';
      renderGame(true);
      var fan = app.querySelector('.table-fan'), model = fan ? fanState() : null;
      if (fan && fanStock(model)) {
        await F.prepare(fan, {initial: !model.prepared}); model.prepared = true;
      }
    } finally { setGameBusy(false); }
  }
  async function answerCard() {
    if (busy || !session.state.current) return;
    setGameBusy(true); stopTimer();
    try {
      var result = session.nextPlayer();
      if (result.cardComplete) {
        await F.collect({card: app.querySelector('.table-big-card'), targetPile: document.getElementById('talked-pile')});
        setCentral(null); currentFanSlot = null; await refreshFan();
      } else startTimer();
    } finally { setGameBusy(false); }
  }
  async function drawAgain() {
    if (busy || !availability().canDraw) return;
    setGameBusy(true); stopTimer();
    try {
      if (session.state.current) {
        await F.collect({card: app.querySelector('.table-big-card'), targetPile: document.getElementById('talked-pile')});
        // 先结束当前回答；选牌阶段等待下一次点选时也已经收牌。
        session.completeCurrent();
        setCentral(null); currentFanSlot = null;
      }
      choosingFan = true;
      await refreshFan(true);
    } finally { setGameBusy(false); }
    if (session.stage.draw !== 'pick') drawCard();
  }
  async function returnCentral() {
    var card = app.querySelector('.table-big-card');
    var target = currentFanSlot && app.querySelector('[data-slot="' + currentFanSlot.slotKey + '"]');
    if (!target) { await F.discardCard({card: card}); return; }
    scrollFanSlotIntoView(target);
    // 回牌目标以现在可见的原空位为准，中央卡撑高页面后也不沿用旧坐标。
    var box = target.getBoundingClientRect();
    await F.returnCard({card: card, targetPile: target, targetRect: box});
  }
  async function passCard() {
    if (busy || !session.state.current) return;
    setGameBusy(true); stopTimer();
    var redraw = false, returnedSlot = currentFanSlot && currentFanSlot.slotKey;
    try {
      var result = session.pass();
      if (!result.ok) { toast('这位玩家的两次“过”已经用完了。'); return; }
      if (result.replacement) {
        await returnCentral(); setCentral(null); choosingFan = true;
        currentFanSlot = null; await refreshFan();
        redraw = result.action === 'redraw';
        if (!redraw) toast('这张放回去，由同一位重新选一张。');
      } else if (result.cardComplete) {
        await F.collect({card: app.querySelector('.table-big-card'), targetPile: document.getElementById('talked-pile')});
        setCentral(null); currentFanSlot = null; await refreshFan();
        toast(session.state.players.length ? '已跳过这张卡，轮到下一位。' : '这张先跳过了。');
      } else { startTimer(); toast('已记为“过”，这张卡交给下一位。'); }
    } finally { setGameBusy(false); }
    if (redraw) drawCard(undefined, sourceAtPress(app.querySelector('.table-fan'), null, returnedSlot));
  }
  function selectFanSource(source) {
    app.querySelectorAll('.fan-card.is-selected').forEach(function (card) {
      if (card !== source) card.classList.remove('is-selected');
    });
    if (source) source.classList.add('is-selected');
  }
  function scrollFanSlotIntoView(slot) {
    var viewport = app.querySelector('.fan-wheel-viewport');
    if (!viewport || !slot) return;
    var box = slot.getBoundingClientRect(), viewBox = viewport.getBoundingClientRect();
    if (box.left < viewBox.left || box.right > viewBox.right) {
      viewport.scrollLeft += (box.left + box.right - viewBox.left - viewBox.right) / 2;
      F.updateWheel(app.querySelector('.table-fan')); saveFanScroll(); updateFanArrows();
    }
  }
  function sourceAtPress(deck, event, excludeSlot) {
    if (!deck) return null;
    var cards = Array.from(deck.querySelectorAll('.fan-card')).filter(function (card) {
      return !card.disabled && card.getAttribute('aria-disabled') !== 'true';
    });
    if (excludeSlot && cards.length > 1) cards = cards.filter(function (card) { return card.dataset.slot !== excludeSlot; });
    var hit = event && event.target.closest ? event.target.closest('.fan-card') : null;
    if (hit && cards.indexOf(hit) !== -1) return hit;
    var viewport = app.querySelector('.fan-wheel-viewport'), viewBox = viewport.getBoundingClientRect();
    var visible = F.visibleCards(deck).filter(function (card) { return cards.indexOf(card) !== -1; });
    var candidates = visible.length ? visible : cards;
    if (!candidates.length) return null;
    var x = event ? event.clientX : (viewBox.left + viewBox.right) / 2;
    var y = event ? event.clientY : (viewBox.top + viewBox.bottom) / 2;
    // 可视区全是空位时也能取全牌轮最近的活卡，并把它滚回视口。
    var nearest = candidates.reduce(function (nearest, card) {
      var r = card.getBoundingClientRect();
      var distance = Math.pow(x - (r.left + r.right) / 2, 2) + Math.pow(y - (r.top + r.bottom) / 2, 2);
      return !nearest || distance < nearest.distance ? {card: card, distance: distance} : nearest;
    }, null).card;
    if (!visible.length) scrollFanSlotIntoView(nearest);
    return nearest;
  }
  function beginHold(deck, source, pointerId, captureEl) {
    if (busy || holding || dialog.open || deck.disabled || deck.getAttribute('aria-disabled') === 'true') return false;
    source = source || sourceAtPress(deck);
    if (!source) return false;
    selectFanSource(source);
    holding = {el: deck, source: source, pointerId: pointerId, captureEl: captureEl || deck, start: performance.now(), ready: false, frame: null};
    deck.classList.add('holding');
    function tick() {
      if (!holding) return;
      var ratio = Math.min(1, (performance.now() - holding.start) / 800);
      var line = app.querySelector('.fan-hold-progress');
      if (line) line.style.strokeDashoffset = String(1 - ratio);
      holding.ready = ratio >= 1;
      if (ratio < 1) holding.frame = requestAnimationFrame(tick);
    }
    tick();
    return true;
  }
  function cancelHold(keepSelection, keepGesture) {
    var active = holding;
    holding = null;
    var gesture = keepGesture === true ? null : fanGesture;
    if (keepGesture !== true) fanGesture = null;
    if (active) {
      cancelAnimationFrame(active.frame); active.el.classList.remove('holding');
      // 先清状态，再释放捕获，避免 lostpointercapture 重入。
      if (keepGesture !== true && active.pointerId != null && active.captureEl.hasPointerCapture(active.pointerId)) active.captureEl.releasePointerCapture(active.pointerId);
    }
    if (gesture && gesture.captureEl.hasPointerCapture(gesture.pointerId)) gesture.captureEl.releasePointerCapture(gesture.pointerId);
    if (keepSelection !== true) selectFanSource(null);
    var line = app.querySelector('.fan-hold-progress');
    if (line) line.style.strokeDashoffset = '1';
  }
  function releaseHold() {
    if (!holding) return;
    var ready = performance.now() - holding.start >= 800, source = holding.source;
    cancelHold(ready);
    if (ready) drawCard(undefined, source); else toast('再慢一点，按住约 0.8 秒后松手。');
  }
  async function drawCard(id, chosenSource) {
    if (!fanCanDraw() || view !== 'game') return;
    var fan = app.querySelector('.table-fan');
    if (!fan || chosenSource && !fan.contains(chosenSource)) { selectFanSource(null); return; }
    var kind = session.stage.draw;
    // 松手使用按下时的同一 DOM 来源，不再次随机挑选视觉卡背。
    var source = chosenSource || (id ? fan.querySelector('[data-pick="' + id + '"]') : sourceAtPress(fan));
    if (!source) { selectFanSource(null); return; }
    selectFanSource(source);
    var sourceRect = source.getBoundingClientRect();
    // 先保存扇面取位，中央卡槽撑开后仍从原来的可见位置选牌。
    var fanRect = fan.getBoundingClientRect();
    var viewport = app.querySelector('.fan-wheel-viewport'), viewportRect = viewport.getBoundingClientRect(), scrollLeft = viewport.scrollLeft;
    var sourceBackHTML = source.innerHTML;
    drawOrigin = {left: sourceRect.left, top: sourceRect.top, width: sourceRect.width, height: sourceRect.height};
    var model = fanState(), result;
    // 重新进入阶段时，已拒绝的深卡继续静默放回，永不进入题目 DOM。
    for (var attempt = 0; attempt <= model.slots.length; attempt += 1) {
      result = session.draw(id);
      if (!result.ok || !result.needsConsent || !model.rejectedIds.has(result.card.id)) break;
      session.rejectPending();
    }
    if (!result.ok) { selectFanSource(null); toast(result.reason === 'limit' ? '本阶段已到抽牌上限，进入下一阶段吧。' : '没有可抽的卡了，可以进入下一阶段。'); syncGameUI(); return; }
    var selectedSlot = model.slots.find(function (slot) { return slot.key === source.dataset.slot; });
    var actualSlot = model.slots.find(function (slot) { return slot.cardId === result.card.id; });
    if (kind !== 'pick' && actualSlot && actualSlot !== selectedSlot) {
      var originalId = selectedSlot.cardId; selectedSlot.cardId = actualSlot.cardId; actualSlot.cardId = originalId;
    }
    selectedSlot.status = result.needsConsent ? 'pending' : 'drawn';
    currentFanSlot = {stageKey: model.key, slotKey: selectedSlot.key, cardId: result.card.id};
    setGameBusy(true); choosingFan = false; stopTimer();
    var retry = false;
    try {
      var card = setCentral(result.card, result.needsConsent, true);
      card.setAttribute('aria-hidden', 'true');
      await F.draw({source: source, sourceRect: drawOrigin, sourceBackHTML: sourceBackHTML, target: card, fan: fan, fanRect: fanRect,
        viewportRect: viewportRect, scrollLeft: scrollLeft, kind: kind, backHTML: A.back(result.card.series, {language: settings.language}), deep: result.needsConsent});
      paintFan(false);
      card.removeAttribute('aria-hidden');
      if (result.needsConsent) {
        var c = result.card, degree = ['', '一', '二', '三', '四', '五'][c.level];
        var yes = await confirm('这是一张' + degree + (c.levelType === 'spice' ? '辣' : '星') + '卡', D.levels[c.levelType][String(c.level)] + '\n大家都同意翻开吗？', '全员同意，翻开', '放回，换一张');
        if (!yes) {
          var rejected = session.rejectPending();
          model.rejectedIds.add(c.id); selectedSlot.status = 'rejected';
          await F.discardCard({card: card}); setCentral(null); currentFanSlot = null;
          choosingFan = true; await refreshFan(true);
          retry = kind !== 'pick' && !!rejected.alternatives && fanStock(model) > 0;
          if (!rejected.alternatives) toast('这阶段暂时没有愿意聊的卡，可以进入下一阶段。');
          return;
        }
        session.acceptPending();
        selectedSlot.status = 'drawn';
        card = setCentral(c, false, true);
      }
      sound('flip'); await F.flip(card, result.card.level >= 4);
      startTimer(); await refreshFan(true);
    } finally {
      selectFanSource(null);
      setGameBusy(false);
      // 拒绝随机深卡后自动换牌；选牌阶段留给大家重新选。
      if (retry) drawCard();
    }
  }
  function sound(kind) {
    if (!settings.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
      var osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'timer' ? 660 : 330, audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(kind === 'timer' ? 440 : 520, audio.currentTime + .2);
      gain.gain.setValueAtTime(.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.045, audio.currentTime + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .32);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + .35);
    } catch (error) {
      toast('当前浏览器暂时无法播放音效。');
    }
  }
  function startTimer() {
    stopTimer();
    if (!settings.timer) return;
    timerRemaining = Number(settings.timer);
    timerInterval = setInterval(function () {
      if (timerPaused || dialog.open || busy) return;
      if (timerRemaining > 0) {
        timerRemaining -= 1;
        updateTimer();
      }
      if (timerRemaining === 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        sound('timer');
        toast('时间到了，想多说一会也没关系。');
      }
    }, 1000);
  }
  function updateTimer() {
    var b = document.getElementById('timer-button');
    if (!b) return;
    b.classList.toggle('expired', timerRemaining === 0);
    b.textContent = timerRemaining === 0 ? '时间到了 · 慢慢说' : String(Math.floor(timerRemaining / 60)).padStart(2, '0') + ':' + String(timerRemaining % 60).padStart(2, '0') + (timerPaused ? ' · 继续' : ' · 暂停');
  }
  function viewsCountdown() {
    if (busy) return;
    setGameBusy(true);
    var layer = document.createElement('div');
    layer.className = 'countdown';
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'assertive');
    document.body.appendChild(layer);
    var items = ['3', '2', '1', '亮！'],
      i = 0;
    function step() {
      layer.innerHTML = '<span>' + items[i] + '</span>';
      i++;
      if (i < items.length) countdownTimeout = setTimeout(step, 900);else countdownTimeout = setTimeout(function () {
        layer.remove();
        setGameBusy(false);
      }, 1000);
    }
    step();
  }
  function responderText(h) {
    return h.answers.map(function (a) {
      return a.playerName + '（' + ({
        answered: '已答',
        passed: '过',
        unanswered: '未标记回答'
      }[a.status] || a.status) + '）';
    }).join('、');
  }
  function sessionText() {
    return scene.name + ' · ' + session.state.mode.name + '\n' + scene.closingText + '\n\n' + session.state.history.map(function (h, i) {
      var c = E.card(h.cardId);
      return i + 1 + '. ' + h.stageName + ' · ' + c.code + ' ' + c.levelLabel + '\n' + responderText(h) + '\n' + c.zh + '\n' + c.en;
    }).join('\n\n');
  }
  function memoryRow(hist, transitioning) {
    var width = Math.min(720, window.innerWidth - 40);
    var step = hist.length > 1 ? Math.min(70, (width - 62) / (hist.length - 1)) : 0;
    var span = hist.length ? 62 + (hist.length - 1) * step : 0;
    return '<div class="round-memory-row" style="width:' + span + 'px" aria-hidden="true">' + hist.map(function (h, i) {
      return '<div class="memory-card" style="left:' + i * step + 'px;z-index:' + i + ';' + (transitioning ? 'visibility:hidden;' : '') + '">' + A.back(E.card(h.cardId).series) + '</div>';
    }).join('') + '</div>';
  }
  function endingMarkup(hist) {
    return '<section class="ending round-ending">' + memoryRow(hist, false) + '<div id="closing-intro"><p class="eyebrow">THANK YOU FOR BEING HERE</p><h1>' + esc(scene.closingText) + '</h1><p class="muted">' + (hist.length ? '今晚，' + hist.length + ' 次翻开，留下了一些新的认识。' : '即使没有抽卡，愿意坐在一起也很好。') + '</p></div><div id="ending-details"><div class="page-actions"><button id="copy-summary" class="button primary">复制为文字</button><button id="play-again" class="button secondary">再开一局</button></div><ul class="history-list">' + hist.map(function (h) {
      var c = E.card(h.cardId);
      return '<li class="history-item"><small>' + esc(h.stageName + ' · ' + c.code + ' · ' + c.levelLabel) + '</small><p>' + esc(settings.language === 'en' ? c.en : c.zh) + '</p><p class="muted">' + esc(responderText(h)) + '</p></li>';
    }).join('') + '</ul><button id="ending-home" class="text-button">回到首页</button></div></section>';
  }
  async function endGame() {
    if (busy || !session) return;
    setGameBusy(true); stopTimer(); cancelHold();
    var hist = session.state.history;
    var reduced = F.reduced(), row, light;
    try {
      if (!reduced && hist.length) {
        // 先在游戏桌上把已有卡依次缩小。终点在下一页的同一位置。
        row = document.createElement('div');
        row.id = 'round-memory-transition';
        row.style.top = document.querySelector('.site-header').offsetHeight + 35 + 'px';
        row.innerHTML = memoryRow(hist, true);
        document.body.appendChild(row);
        var active = app.querySelector('.table-big-card');
        var pile = document.getElementById('talked-pile');
        await F.endRound({
          cards: hist.map(function (h) { return active && session.state.current && h.cardId === session.state.current.id ? active : pile; }),
          sourcePile: pile, activeCard: active, targets: row.querySelectorAll('.memory-card')
        });
      }
      // 从当前桌面亮到暖灰，覆盖整个视口，不先加深背景。
      light = document.createElement('div'); light.id = 'ending-light';
      document.body.appendChild(light);
      if (!reduced) await light.animate([{opacity: 0}, {opacity: 1}], {duration: 2000, fill: 'forwards', easing: 'ease-in-out'}).finished;
      document.body.classList.add('ending-warm');
      session.finish(); view = 'ending';
      mount(endingMarkup(hist));
      app.querySelectorAll('.round-ending button').forEach(function (b) { b.disabled = true; });
      if (row) row.remove();
      listen('copy-summary', function () { copyText(sessionText()); });
      listen('play-again', renderSettings); listen('ending-home', home);
      if (reduced) {
        await app.querySelector('.ending').animate([{opacity: 0}, {opacity: 1}], {duration: 200}).finished;
      } else {
        var intro = document.getElementById('closing-intro'), details = document.getElementById('ending-details');
        details.style.visibility = 'hidden';
        await intro.animate([{opacity: 0}, {opacity: 1}], {duration: 550, easing: 'ease-out'}).finished;
        details.style.visibility = 'visible';
        await details.animate([{opacity: 0}, {opacity: 1}], {duration: 350, easing: 'ease-out'}).finished;
      }
    } finally {
      setGameBusy(false); app.removeAttribute('aria-busy');
      app.querySelectorAll('.round-ending button').forEach(function (b) { b.disabled = false; });
    }
  }
  async function copyText(text) {
    var copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {/* 本地文件的剪贴板权限因浏览器而异，继续使用兼容复制。 */}
    }
    if (!copied) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.top = '-10000px';
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      area.remove();
    }
    if (copied) toast('已复制，可以粘贴保存。');else {
      downloadText(text, '对话卡牌-回顾.txt');
      toast('当前浏览器无法直接复制，已改为导出文字文件。');
    }
  }
  function downloadText(text, name) {
    var blob = new Blob(['\ufeff' + text], {
        type: 'text/plain;charset=utf-8'
      }),
      url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }
  function soloHistoryMarkup() {
    var days = E.soloHistory();
    return days.map(function (d) {
      var entries = d.entries.filter(function (e) {
        return e.revealed || e.note || e.skipped;
      });
      return '<div class="history-item"><small>' + esc(d.date) + ' · 第 ' + d.week + ' 周</small>' + entries.map(function (e) {
        var c = E.card(e.cardId);
        if (e.skipped) return '<p class="muted">今天的这一步已跳过（未翻开卡牌）。</p>';
        return '<p>' + esc(c.code + ' · ' + c.zh) + '</p><p class="note-text muted">' + esc(e.note || '（尚未记录）') + '</p>';
      }).join('') + (discoveries[d.date] ? '<p class="note-text">今天发现的自己：' + esc(discoveries[d.date]) + '</p>' : '') + (!entries.length ? '<p class="muted">今天的卡还没翻开。</p>' : '') + '</div>';
    }).join('');
  }
  function renderSolo(scroll) {
    view = 'solo';
    soloDay = E.getSoloDay();
    var series = D.series.find(function (s) {
        return s.key === soloDay.series;
      }),
      labels = {
        opening: '01 · 先看看心里的天气',
        main: '02 · 今日一张',
        sunday: '03 · 周日的一周天气图',
        extra: '随便抽的一张'
      };
    mount('<section class="page-shell"><div class="solo-heading"><div class="page-heading"><p class="eyebrow">A MOMENT WITH YOURSELF</p><h1>今天，和自己聊。</h1><p>' + esc(soloDay.date) + ' · ' + esc(scene.duration) + '</p></div><button class="button secondary" id="solo-settings">设置</button></div>' + storageNotice() + '<div class="solo-stats"><span class="pill">第 ' + soloDay.week + ' 周</span><span class="pill">' + esc(series.zh) + '</span><span class="pill">' + soloDay.levels.map(function (n) {
      return '★'.repeat(n);
    }).join(' – ') + '</span></div>' + soloDay.entries.map(function (e, i) {
      var c = E.card(e.cardId),
        previous = soloDay.entries.slice(0, i).every(function (x) {
          return x.revealed || x.skipped;
        });
      return '<section class="solo-entry" id="entry-' + esc(e.id) + '"><h2>' + esc(labels[e.kind]) + '</h2><div class="tabletop">' + (e.skipped ? '<div class="empty-stage">今天先跳过这张。<br><small>愿意说多少，由你决定。</small></div>' : e.revealed ? cardMarkup(c) : '<button class="solo-back-button" data-reveal="' + esc(e.id) + '" ' + (!previous ? 'disabled' : '') + ' aria-label="' + (previous ? '翻开这张卡' : '请先翻开前一张卡') + '">' + A.back(c.series, {
        language: settings.language
      }) + '<span>' + (previous ? '轻点，翻开今天的卡' : '先翻开上一张') + '</span></button>') + '</div>' + (e.revealed ? '<div class="card-hints">' + hints(c) + '</div><label class="note-label" for="note-' + esc(e.id) + '">写下来就好，不必组织成漂亮的句子。</label><textarea id="note-' + esc(e.id) + '" data-note="' + esc(e.id) + '" rows="4" placeholder="此刻，我想到……">' + esc(e.note) + '</textarea><p class="save-label" id="saved-' + esc(e.id) + '">' + (e.note ? '已保存在本机' : '输入后自动保存在本机') + '</p>' : '') + '</section>';
    }).join('') + '<div class="solo-discovery"><label class="field-title" for="discovery-note">今天发现的自己</label><textarea id="discovery-note" rows="3" placeholder="写完之后，留给自己一句话。">' + esc(discoveries[soloDay.date] || '') + '</textarea><p class="save-label" id="discovery-saved">输入后自动保存在本机</p></div><div class="solo-controls"><button class="button secondary" id="solo-extra">随便抽一张</button><button class="button primary" id="solo-complete">完成今日一张 →</button></div><details class="solo-history"><summary>历史记录 · ' + E.soloHistory().length + ' 天</summary><div id="solo-history-content">' + soloHistoryMarkup() + '</div><button id="export-solo" class="button secondary">导出全部日记 .txt</button></details></section>', scroll);
    app.querySelectorAll('[data-reveal]').forEach(function (b) {
      b.onclick = function () {
        revealSolo(b.dataset.reveal);
      };
    });
    app.querySelectorAll('[data-note]').forEach(function (area) {
      area.oninput = function () {
        E.saveSoloNote(area.dataset.note, area.value, soloDay.date);
        var status = E.storageStatus();
        document.getElementById('saved-' + area.dataset.note).textContent = status.ok ? '已自动保存在本机' : '保存失败，请导出文字保留记录';
        document.getElementById('solo-history-content').innerHTML = soloHistoryMarkup();
      };
    });
    listen('discovery-note', function (e) {
      discoveries[soloDay.date] = e.target.value;
      saveDiscoveries();
      document.getElementById('discovery-saved').textContent = preferenceStorageOK ? '已自动保存在本机' : '保存失败，请导出文字保留记录';
      document.getElementById('solo-history-content').innerHTML = soloHistoryMarkup();
    }, 'input');
    listen('solo-settings', renderSettings);
    listen('solo-extra', function () {
      if (busy) return;
      var result = E.drawSoloExtra(soloDay.date);
      if (!result.ok) {
        toast('今天的卡都翻过了，明天再继续。');
        return;
      }
      renderSolo(false);
      document.getElementById('entry-' + result.entry.id).scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
    listen('export-solo', exportSolo);
    listen('solo-complete', function () {
      if (busy) return;
      if (!soloDay.entries.filter(function (e) {
        return e.kind !== 'extra';
      }).every(function (e) {
        return e.revealed || e.skipped;
      })) {
        toast('先翻开今天的天气和主卡，再完成今天的记录。');
        return;
      }
      soloEnding();
    });
  }
  async function revealSolo(id) {
    if (busy) return;
    var entry = soloDay.entries.find(function (e) {
        return e.id === id;
      }),
      c = E.card(entry.cardId);
    if (c.level >= 4) {
      busy = true;
      var degree = ['', '一', '二', '三', '四', '五'][c.level],
        yes = await confirm('这是一张' + degree + '星卡', D.levels[c.levelType][String(c.level)] + '\n今天愿意和自己聊聊吗？', '我愿意，翻开', '换一张');
      busy = false;
      if (!yes) {
        var r = E.rejectSolo(id, soloDay.date);
        if (!r.ok) E.skipSolo(id, soloDay.date);
        renderSolo(false);
        toast(r.ok ? '已换一张，准备好再翻开。' : '今天这个级别的卡已全部跳过。可以继续写日记，也可以随便抽一张。');
        return;
      }
    }
    E.revealSolo(id, soloDay.date);
    sound('flip');
    renderSolo(false);
    var card = app.querySelector('#entry-' + id + ' .conversation-card');
    if (card && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.classList.remove('revealed');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.classList.add('revealed');
        });
      });
    }
  }
  function soloExportText() {
    return E.exportSoloText() + '\n\n──────────\n今天发现的自己\n' + Object.keys(discoveries).sort().map(function (k) {
      return k + '\n' + discoveries[k];
    }).join('\n\n');
  }
  function exportSolo() {
    downloadText(soloExportText(), '对话卡牌-独处日记-' + soloDay.date + '.txt');
  }
  async function soloEnding() {
    if (busy || !soloDay || view !== 'solo') return;
    setGameBusy(true);
    app.setAttribute('aria-busy', 'true');
    var controls = Array.from(app.querySelectorAll('button,textarea,input,select')).map(function (el) {
      var before = el.disabled;
      el.disabled = true;
      return { el: el, disabled: before };
    });
    var hist = soloDay.entries.filter(function (e) { return e.revealed && !e.skipped; });
    var reduced = F.reduced(), row, light, lightAnimation, finished = false;
    var hiddenCards = [];
    try {
      if (!reduced && hist.length) {
        var sources = hist.map(function (e) {
          var entry = document.getElementById('entry-' + e.id);
          return entry && entry.querySelector('.conversation-card');
        });
        var sourceRects = sources.map(function (card) {
          if (!card) return null;
          var box = card.getBoundingClientRect();
          var source = { left: box.left, top: box.top, width: box.width, height: box.height };
          var width = window.innerWidth, height = window.innerHeight;
          // 离屏卡从最近的屏幕边缘进入；部分可见卡仍用实际位置。
          if (box.right <= 0 || box.left >= width || box.bottom <= 0 || box.top >= height) {
            source.width = Math.min(source.width, width);
            source.height = Math.min(source.height, height);
            source.left = Math.max(0, Math.min(source.left, width - source.width));
            source.top = Math.max(0, Math.min(source.top, height - source.height));
          }
          return source;
        });
        row = document.createElement('div');
        row.id = 'round-memory-transition';
        row.style.top = document.querySelector('.site-header').offsetHeight + 35 + 'px';
        row.innerHTML = memoryRow(hist, true);
        document.body.appendChild(row);
        // 原卡先隐藏，避免缩卡副本与独处页上的大卡同时出现。
        sources.forEach(function (card) {
          if (!card) return;
          hiddenCards.push({ el: card, visibility: card.style.visibility });
          card.style.visibility = 'hidden';
        });
        var result = await F.endRound({ cards: sources, sourceRects: sourceRects, targets: row.querySelectorAll('.memory-card') });
        if (result.cancelled) return;
      }
      light = document.createElement('div');
      light.id = 'ending-light';
      light.style.opacity = reduced ? '1' : '0';
      document.body.appendChild(light);
      if (!reduced) {
        lightAnimation = light.animate([{opacity: 0}, {opacity: 1}], {duration: 2000, fill: 'forwards', easing: 'ease-in-out'});
        await lightAnimation.finished;
        light.style.opacity = '1';
      }
      document.body.classList.add('ending-warm');
      view = 'solo-ending';
      mount('<section class="ending round-ending">' + memoryRow(hist, false) + '<div id="solo-closing-intro"><p class="eyebrow">YOU SHOWED UP FOR YOURSELF</p><h1>' + esc(scene.closingText) + '</h1><p class="muted">今天的卡和笔记已留在本机。明天，再慢慢认识自己。</p></div><div id="solo-ending-details"' + (reduced ? '' : ' style="visibility:hidden"') + '><div class="page-actions"><button class="button primary" id="solo-ending-export" disabled>导出日记 .txt</button><button class="button secondary" id="solo-back" disabled>回看今天</button></div><button class="text-button" id="solo-home" disabled>回到首页</button></div></section>');
      if (row) row.remove();
      listen('solo-ending-export', function () { if (!busy) exportSolo(); });
      listen('solo-back', function () {
        if (busy) return;
        cleanOverlays();
        renderSolo(true);
      });
      listen('solo-home', function () { if (!busy) home(); });
      if (reduced) {
        await app.querySelector('.round-ending').animate([{opacity: 0}, {opacity: 1}], {duration: 200}).finished;
      } else {
        await document.getElementById('solo-closing-intro').animate([{opacity: 0}, {opacity: 1}], {duration: 550, easing: 'ease-out'}).finished;
        var details = document.getElementById('solo-ending-details');
        details.style.visibility = 'visible';
        await details.animate([{opacity: 0}, {opacity: 1}], {duration: 350, easing: 'ease-out'}).finished;
      }
      finished = true;
    } catch (error) {
      // 文字淡入被取消时也保留可操作的结束页，不能留下隐藏的按钮。
      if (view === 'solo-ending') {
        var endingDetails = document.getElementById('solo-ending-details');
        if (endingDetails) endingDetails.style.visibility = 'visible';
        finished = true;
      }
      if (error.name !== 'AbortError') toast('收尾动画已停止，日记仍可回看或导出。');
    } finally {
      if (lightAnimation) lightAnimation.cancel();
      if (row) row.remove();
      if (!finished) {
        if (light) light.remove();
        document.body.classList.remove('ending-warm');
      }
      hiddenCards.forEach(function (card) { card.el.style.visibility = card.visibility; });
      controls.forEach(function (control) { control.el.disabled = control.disabled; });
      setGameBusy(false);
      app.removeAttribute('aria-busy');
      app.querySelectorAll('.round-ending button').forEach(function (b) { b.disabled = false; });
    }
  }
  document.getElementById('projection-button').onclick = function () {
    if (busy) return;
    settings.projection = !settings.projection;
    applyProjection();
    savePrefs();
    var input = document.getElementById('screen-mode');
    if (input) input.checked = settings.projection;
    if (view === 'game') F.layout(app.querySelector('.table-fan'));
  };
  document.getElementById('home-button').onclick = async function () {
    if (dialog.open || busy) return;
    if (view === 'game') {
      busy = true;
      var yes = await confirm('离开这一局？', '当前这一局的回顾将结束；跨局已抽记录仍保存在本机。', '回到首页', '留在这里');
      busy = false;
      if (!yes) return;
    }
    home();
  };
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && view === 'game' && !dialog.open
      && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      var viewport = app.querySelector('.fan-wheel-viewport');
      if (viewport && viewport.parentElement.classList.contains('is-wheel')) {
        e.preventDefault(); moveFan(e.key === 'ArrowLeft' ? -1 : 1);
      }
      return;
    }
    if (e.code !== 'Space') return;
    if (e.repeat) {
      if (holding && holding.pointerId == null) e.preventDefault();
      return;
    }
    if (view !== 'game' || dialog.open || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) && e.target.id !== 'deck') return;
    var deck = document.getElementById('deck');
    if (deck && session.stage.draw !== 'pick' && fanCanDraw()) {
      e.preventDefault();
      beginHold(deck);
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space' && holding && holding.pointerId == null) {
      e.preventDefault();
      releaseHold();
    }
  });
  window.addEventListener('blur', cancelHold);
  window.addEventListener('resize', function () {
    cancelHold();
    if (view === 'game' && !busy) { saveFanScroll(); paintFan(false); }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) cancelHold();
  });
  if (!D || !E || !A || !F) {
    app.innerHTML = '<p class="storage-warning">文件未完整加载，请保留整个文件夹后重新打开 index.html。</p>';
    return;
  }
  home();
})();
