(function (global) {
  'use strict';

  // 规则只依赖数据和本机存储；界面的确认、翻牌和动画由 app.js 负责。
  var data = global.GAME_DATA;
  if (!data || !Array.isArray(data.cards) || !Array.isArray(data.scenes)) {
    throw new Error('请先加载 data/game-data.js。');
  }
  var cardMap = {};
  data.cards.forEach(function (card) { cardMap[card.id] = card; });
  var cache = {};
  var storageOK = true;
  var storageMessage = '';
  var idCounter = 0;

  function read(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    try {
      var raw = global.localStorage.getItem('talkcards:' + key);
      cache[key] = raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      storageOK = false;
      storageMessage = '本机存储暂时不可用；当前页面仍可玩，刷新后记录可能丢失。';
      cache[key] = fallback;
    }
    return cache[key];
  }
  function write(key, value) {
    cache[key] = value;
    try { global.localStorage.setItem('talkcards:' + key, JSON.stringify(value)); }
    catch (error) {
      storageOK = false;
      storageMessage = '本机存储写入失败；当前页面仍保留记录，刷新后可能丢失。';
    }
  }
  function array(value) { return Array.isArray(value) ? value : []; }
  function unique(ids) { return ids.filter(function (id, index) { return ids.indexOf(id) === index; }); }
  function stamp() { return new Date().toISOString(); }
  function identifier(prefix) { idCounter += 1; return prefix + '-' + Date.now() + '-' + idCounter; }
  function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
  function sceneFor(sceneId) { return data.scenes.find(function (scene) { return scene.id === sceneId; }); }
  function stagePool(stage, deckMode) {
    if (!stage) return [];
    return unique(array(stage.cards).concat(deckMode === 'fullBox' ? array(stage.extraCards) : []))
      .map(function (id) { return cardMap[id]; }).filter(Boolean);
  }
  function seenFor(sceneId) { return unique(array(read('drawn:' + sceneId, [])).filter(function (id) { return !!cardMap[id]; })); }
  function saveSeen(sceneId, ids) { write('drawn:' + sceneId, unique(ids)); }
  function playerName(state, index) { return state.players.length ? state.players[index] : '未署名'; }

  function createSession(options) {
    options = options || {};
    var scene = sceneFor(options.sceneId);
    if (!scene || scene.id === 'solo') throw new Error('请选择有效的多人场景。');
    var mode = array(scene.modes).find(function (item) { return item.id === options.modeId; }) || scene.modes[0];
    var deckMode = options.deckMode === 'fullBox' ? 'fullBox' : 'curated';
    var stages = [];
    array(mode.stages).forEach(function (stage) {
      stages.push(stage);
      array(scene.plugins).forEach(function (plugin) {
        if (array(options.pluginIds).indexOf(plugin.id) !== -1 && plugin.insertAfter === stage.id) {
          stages.push(Object.assign({}, plugin, { isPlugin: true }));
        }
      });
    });
    var state = {
      scene: scene, mode: mode, deckMode: deckMode, stages: stages,
      stageIndex: 0, current: null, pending: null,
      players: array(options.players).map(function (name) { return String(name).trim(); }).filter(Boolean).slice(0, 10),
      playerIndex: 0, passCounts: [], stageDrawCounts: {}, history: [],
      startedAt: stamp(), finishedAt: null
    };
    state.passCounts = state.players.map(function () { return 0; });
    var used = new Set();
    var declined = new Set();
    var avoidNext = new Set();
    var localProgress = {};
    var pendingMeta = null;
    var currentMeta = null;
    var currentRecord = null;
    var carryQueue = null;
    var answerQueue = [];
    var answerCursor = 0;
    var firstTurn = 0;

    function stage() { return state.stages[state.stageIndex]; }
    function count() { return state.stageDrawCounts[stage().id] || 0; }
    function progressKey() { return 'sequence:' + scene.id + ':' + mode.id + ':' + stage().id; }
    function progress() {
      var value = stage().persistProgress ? read(progressKey(), 0) : (localProgress[stage().id] || 0);
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    }
    function setProgress(value) {
      localProgress[stage().id] = value;
      if (stage().persistProgress) write(progressKey(), value);
    }
    function pool(value) { return stagePool(value || stage(), deckMode); }
    function localCandidates() {
      var all = pool().filter(function (card) { return !used.has(card.id) && !declined.has(card.id); });
      if (avoidNext.size && all.some(function (card) { return !avoidNext.has(card.id); })) {
        all = all.filter(function (card) { return !avoidNext.has(card.id); });
      }
      return all;
    }
    function candidates() {
      var all = localCandidates();
      // 顺序卡和固定卡遵循其明确的顺序；随机与选牌优先展示跨局未抽的卡。
      if (stage().draw !== 'sequential' && stage().draw !== 'fixed') {
        var previous = seenFor(scene.id);
        var fresh = all.filter(function (card) { return previous.indexOf(card.id) === -1; });
        if (fresh.length) all = fresh;
      }
      return all;
    }
    function drawAvailability() {
      var cards = candidates();
      // 扇面展示本局剩余牌；跨局未抽优先只影响真正的选牌，不缩小视觉牌池。
      var allCards = localCandidates().filter(function (card) {
        return (!state.current || card.id !== state.current.id) && (!state.pending || card.id !== state.pending.id);
      });
      var limit = stage().maxDraws !== null && stage().maxDraws !== undefined && count() >= stage().maxDraws;
      var reason = state.finishedAt ? 'finished' : stage().draw === 'none' ? 'none'
        : state.pending ? 'pending' : limit ? 'limit' : !cards.length ? 'empty' : null;
      return {
        cards: cards, count: cards.length, allCards: allCards, allCount: allCards.length,
        canDraw: !reason, reason: reason,
        returnedCount: pool().filter(function (card) { return avoidNext.has(card.id); }).length,
        declinedCount: pool().filter(function (card) { return declined.has(card.id); }).length
      };
    }
    function recordCurrentAnswer() {
      if (!currentRecord) return;
      var answer = currentRecord.answers[answerCursor];
      if (answer && answer.status === 'unanswered') { answer.status = 'answered'; answer.at = stamp(); }
    }
    function releaseCurrent(status, markAnswer) {
      if (currentRecord) {
        if (markAnswer) recordCurrentAnswer();
        currentRecord.status = currentRecord.answers.every(function (answer) { return answer.status !== 'unanswered'; }) ? 'completed' : status;
      }
      state.current = null;
      currentRecord = null;
      currentMeta = null;
      answerQueue = [];
      answerCursor = 0;
    }
    function commit(card, meta) {
      var originalSeen = seenFor(scene.id);
      var currentPool = pool().map(function (item) { return item.id; });
      var remaining = currentPool.filter(function (id) { return !used.has(id) && !declined.has(id); });
      var cycleEnded = remaining.length && remaining.every(function (id) { return originalSeen.indexOf(id) !== -1; });
      var previousSeen = originalSeen.indexOf(card.id) !== -1;
      var nextSeen = cycleEnded ? originalSeen.filter(function (id) { return currentPool.indexOf(id) === -1; }) : originalSeen.slice();
      nextSeen.push(card.id);
      saveSeen(scene.id, nextSeen);
      used.add(card.id);
      state.stageDrawCounts[stage().id] = count() + 1;
      if (stage().draw === 'sequential') setProgress(meta.sequenceNext);
      currentMeta = Object.assign({}, meta, { previousSeen: previousSeen });
      state.current = card;
      state.pending = null;
      pendingMeta = null;
      if (carryQueue) { answerQueue = carryQueue; carryQueue = null; }
      else if (stage().everyoneAnswers && state.players.length) {
        var starter = scene.id === 'partners' ? firstTurn % state.players.length : state.playerIndex;
        answerQueue = state.players.map(function (_, offset) { return (starter + offset) % state.players.length; });
        if (scene.id === 'partners') firstTurn += 1;
      } else answerQueue = [state.playerIndex];
      answerCursor = 0;
      state.playerIndex = answerQueue[0];
      currentRecord = {
        id: identifier('draw'), cardId: card.id, stageId: stage().id, stageName: stage().name,
        drawnAt: stamp(), everyoneAnswers: !!stage().everyoneAnswers,
        firstPlayer: playerName(state, state.playerIndex),
        answers: answerQueue.map(function (index) { return { playerIndex: index, playerName: playerName(state, index), status: 'unanswered', at: null }; }),
        status: 'current', passedBy: null
      };
      state.history.push(currentRecord);
      return { ok: true, card: card, needsConsent: false };
    }
    function draw(cardId) {
      if (state.finishedAt) return { ok: false, reason: 'finished' };
      if (state.pending) return { ok: true, card: state.pending, needsConsent: true };
      if (stage().draw === 'none') return { ok: false, reason: 'none' };
      if (stage().maxDraws !== null && stage().maxDraws !== undefined && count() >= stage().maxDraws) return { ok: false, reason: 'limit' };
      var available = candidates();
      if (!available.length) return { ok: false, reason: 'empty' };
      var card;
      var meta = { sequencePrevious: progress() };
      if (stage().draw === 'sequential') {
        var ordered = pool();
        for (var offset = 0; offset < ordered.length; offset += 1) {
          var index = (meta.sequencePrevious + offset) % ordered.length;
          if (available.some(function (item) { return item.id === ordered[index].id; })) {
            card = ordered[index]; meta.sequenceNext = (index + 1) % ordered.length; break;
          }
        }
      } else if (stage().draw === 'fixed') card = available[0];
      else if (cardId) card = available.find(function (item) { return item.id === cardId; });
      else card = randomItem(available);
      if (!card) return { ok: false, reason: 'unavailable' };
      if (state.current) releaseCurrent('moved', true);
      if (card.level >= 4) {
        state.pending = card; pendingMeta = meta;
        return { ok: true, card: card, needsConsent: true };
      }
      return commit(card, meta);
    }
    function acceptPending() {
      if (!state.pending) return { ok: false, reason: 'no-pending' };
      return commit(state.pending, pendingMeta);
    }
    function rejectPending() {
      if (!state.pending) return { ok: false, reason: 'no-pending' };
      declined.add(state.pending.id);
      state.pending = null; pendingMeta = null;
      return { ok: true, alternatives: candidates().length };
    }
    function nextPlayer() {
      if (state.pending) return { ok: false, reason: 'pending', cardComplete: false };
      avoidNext.clear();
      if (!state.current) {
        carryQueue = null;
        if (state.players.length) state.playerIndex = (state.playerIndex + 1) % state.players.length;
        return { ok: true, cardComplete: true };
      }
      recordCurrentAnswer();
      if (answerCursor + 1 < answerQueue.length) {
        answerCursor += 1; state.playerIndex = answerQueue[answerCursor];
        return { ok: true, cardComplete: false };
      }
      var lastPlayer = state.playerIndex;
      releaseCurrent('completed', false);
      if (state.players.length) state.playerIndex = (lastPlayer + 1) % state.players.length;
      return { ok: true, cardComplete: true };
    }
    function completeCurrent() {
      if (state.pending) return { ok: false, reason: 'pending', cardComplete: false };
      if (!state.current) return { ok: false, reason: 'no-card', cardComplete: false };
      // 收牌只完成当前人的回答，未答的其他人保持未答，也不提前换人。
      releaseCurrent('moved', true);
      return { ok: true, cardComplete: true };
    }
    function pass() {
      if (!state.current) return { ok: false, reason: 'no-card' };
      if (state.players.length && state.passCounts[state.playerIndex] >= 2) return { ok: false, reason: 'pass-limit' };
      if (state.players.length) state.passCounts[state.playerIndex] += 1;
      var cardId = state.current.id;
      // 固定卡、体检和没有真正替代卡时，过只跳过个人回答；卡和顺序进度仍保留。
      var alternatives = pool().filter(function (card) {
        return card.id !== cardId && !used.has(card.id) && !declined.has(card.id) && !avoidNext.has(card.id);
      });
      var replacement = stage().draw !== 'fixed' && stage().draw !== 'sequential' && alternatives.length > 0;
      var answer = currentRecord.answers[answerCursor];
      answer.status = 'passed'; answer.at = stamp();
      currentRecord.passedBy = playerName(state, state.playerIndex);
      if (!replacement) {
        var next = nextPlayer();
        return {
          ok: true, action: 'next-player', replacement: false,
          cardComplete: next.cardComplete, keptCurrent: !!state.current,
          alternatives: alternatives.length, cardId: cardId,
          playerIndex: state.playerIndex, playerName: playerName(state, state.playerIndex)
        };
      }
      currentRecord.status = 'passed';
      carryQueue = answerQueue.slice(answerCursor);
      state.stageDrawCounts[stage().id] = Math.max(0, count() - 1);
      used.delete(cardId);
      if (!currentMeta.previousSeen) saveSeen(scene.id, seenFor(scene.id).filter(function (id) { return id !== cardId; }));
      avoidNext.add(cardId);
      state.current = null; currentRecord = null; currentMeta = null;
      answerQueue = []; answerCursor = 0;
      return {
        ok: true, action: stage().draw === 'pick' ? 'pick' : 'redraw', replacement: true,
        cardComplete: false, keptCurrent: false, alternatives: candidates().length,
        cardId: cardId, playerIndex: state.playerIndex, playerName: playerName(state, state.playerIndex)
      };
    }
    function goStage(index) {
      index = Number(index);
      if (!Number.isInteger(index) || index < 0 || index >= stages.length) return { ok: false, reason: 'invalid-stage' };
      releaseCurrent('moved', false);
      state.pending = null; pendingMeta = null; carryQueue = null; avoidNext.clear();
      declined.clear(); state.stageIndex = index;
      return { ok: true, stage: stage() };
    }
    function finish() {
      releaseCurrent('moved', false);
      state.pending = null; pendingMeta = null;
      carryQueue = null; avoidNext.clear();
      state.finishedAt = stamp();
      return state.history;
    }
    var session = { state: state, pool: pool, availableCards: candidates, drawAvailability: drawAvailability, draw: draw,
      acceptPending: acceptPending, rejectPending: rejectPending, nextPlayer: nextPlayer,
      completeCurrent: completeCurrent, pass: pass, goStage: goStage, finish: finish };
    Object.defineProperties(session, {
      stage: { get: stage }, playerName: { get: function () { return playerName(state, state.playerIndex); } },
      stageDrawCount: { get: count }
    });
    return session;
  }

  // 日期按设备的本地日历计算，不将 UTC 日期截取当作本地的今天。
  function localDate(value) {
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      var parts = value.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    var today = new Date(); return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }
  function dateKey(value) {
    var date = localDate(value);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function dayNumber(value) { var date = localDate(value); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000; }
  function soloDays() {
    var value = read('solo-days', {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function soloSeen() { return unique(array(read('solo-seen', [])).filter(function (id) { return !!cardMap[id]; })); }
  function pickSolo(pool, day, rejected) {
    rejected = array(rejected);
    var occupied = day ? array(day.entries).map(function (entry) { return entry.cardId; }) : [];
    var available = pool.filter(function (card) { return occupied.indexOf(card.id) === -1 && rejected.indexOf(card.id) === -1; });
    var seen = soloSeen();
    var fresh = available.filter(function (card) { return seen.indexOf(card.id) === -1; });
    return randomItem(fresh.length ? fresh : available);
  }
  function soloPool(series, levels) {
    var all = data.cards.filter(function (card) { return card.series === series; });
    var exact = all.filter(function (card) { return levels.indexOf(card.level) !== -1; });
    if (exact.length) return exact;
    var distance = Math.min.apply(null, all.map(function (card) {
      return Math.min.apply(null, levels.map(function (level) { return Math.abs(level - card.level); }));
    }));
    return all.filter(function (card) { return levels.some(function (level) { return Math.abs(level - card.level) === distance; }); });
  }
  function newSoloEntry(card, kind) {
    return { id: identifier('solo'), cardId: card.id, kind: kind, note: '', revealed: false, skipped: false, rejected: [], createdAt: stamp() };
  }
  function normalizeSoloDay(day) {
    array(day.entries).forEach(function (entry) { entry.skipped = entry.skipped === true; });
    return day;
  }
  function getSoloDay(value) {
    var date = localDate(value), key = dateKey(date), days = soloDays();
    if (days[key] && Array.isArray(days[key].entries)) return normalizeSoloDay(days[key]);
    var plan = sceneFor('solo').soloPlan;
    var start = read('solo-start', null);
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) { start = key; write('solo-start', start); }
    var week = Math.max(1, Math.floor((dayNumber(date) - dayNumber(start)) / 7) + 1);
    var schedule = plan.weekLevels[Math.min(week, plan.weekLevels.length) - 1];
    var weekday = date.getDay();
    var levels = (weekday === 0 || weekday === 6) && schedule.weekendLevels ? schedule.weekendLevels : schedule.levels;
    var day = { date: key, week: week, weekday: weekday, series: plan.weekdaySeries[String(weekday)], levels: levels.slice(), entries: [] };
    // 天气是每天的固定仪式，独立选择，不消耗主卡和额外卡的跨日牌池。
    var weather = randomItem(plan.openingCards.map(function (id) { return cardMap[id]; }).filter(Boolean));
    if (weather) day.entries.push(newSoloEntry(weather, 'opening'));
    var main = pickSolo(soloPool(day.series, levels), day);
    if (main) day.entries.push(newSoloEntry(main, 'main'));
    if (weekday === 0 && cardMap[plan.sundayExtra]) day.entries.push(newSoloEntry(cardMap[plan.sundayExtra], 'sunday'));
    days[key] = day; write('solo-days', days);
    return day;
  }
  function entryFor(entryId, value) {
    var day = getSoloDay(value);
    return { day: day, entry: day.entries.find(function (entry) { return entry.id === entryId; }) };
  }
  function saveSoloDay(day) { var days = soloDays(); days[day.date] = day; write('solo-days', days); }
  function poolForSoloEntry(entry, day) {
    var plan = sceneFor('solo').soloPlan;
    if (entry.kind === 'main') return soloPool(day.series, day.levels);
    if (entry.kind === 'opening') return plan.openingCards.map(function (id) { return cardMap[id]; }).filter(Boolean);
    if (entry.kind === 'extra') return data.cards.filter(function (card) { return plan.eligibleSeries.indexOf(card.series) !== -1; });
    return [];
  }
  function revealSolo(entryId, value) {
    var found = entryFor(entryId, value);
    if (!found.entry) return { ok: false, reason: 'no-entry' };
    if (found.entry.skipped) return { ok: false, reason: 'skipped' };
    if (!found.entry.revealed && (found.entry.kind === 'main' || found.entry.kind === 'extra')) {
      var seen = soloSeen();
      var pool = poolForSoloEntry(found.entry, found.day).map(function (card) { return card.id; });
      // 只重新洗完本次使用的牌池；每天的天气不会清掉其他系列的进度。
      if (pool.length && pool.every(function (id) { return seen.indexOf(id) !== -1; })) {
        seen = seen.filter(function (id) { return pool.indexOf(id) === -1; });
      }
      seen.push(found.entry.cardId); write('solo-seen', unique(seen));
    }
    found.entry.revealed = true;
    saveSoloDay(found.day);
    return { ok: true, entry: found.entry, card: cardMap[found.entry.cardId] };
  }
  function rejectSolo(entryId, value) {
    var found = entryFor(entryId, value), entry = found.entry, day = found.day;
    if (!entry) return { ok: false, reason: 'no-entry' };
    if (entry.skipped) return { ok: false, reason: 'skipped' };
    if (entry.revealed) return { ok: false, reason: 'already-revealed' };
    var rejected = unique(array(entry.rejected).concat(entry.cardId));
    var pool = poolForSoloEntry(entry, day);
    var card = pickSolo(pool, day, rejected);
    entry.rejected = rejected;
    if (!card) { saveSoloDay(day); return { ok: false, reason: 'empty' }; }
    entry.cardId = card.id; entry.note = ''; entry.revealed = false;
    saveSoloDay(day);
    return { ok: true, entry: entry, card: card };
  }
  function skipSolo(entryId, value) {
    var found = entryFor(entryId, value);
    if (!found.entry) return { ok: false, reason: 'no-entry' };
    if (found.entry.revealed) return { ok: false, reason: 'already-revealed' };
    // 跳过须由界面明确触发；没有替代卡本身不代表用户已经决定跳过。
    found.entry.skipped = true;
    found.entry.skippedAt = stamp();
    saveSoloDay(found.day);
    return { ok: true, entry: found.entry };
  }
  function saveSoloNote(entryId, note, value) {
    var found = entryFor(entryId, value);
    if (!found.entry) return { ok: false, reason: 'no-entry' };
    found.entry.note = String(note); found.entry.updatedAt = stamp();
    saveSoloDay(found.day);
    return { ok: true, entry: found.entry };
  }
  function drawSoloExtra(value) {
    var day = getSoloDay(value), plan = sceneFor('solo').soloPlan;
    var eligible = data.cards.filter(function (card) { return plan.eligibleSeries.indexOf(card.series) !== -1; });
    var card = pickSolo(eligible, day);
    if (!card) return { ok: false, reason: 'empty' };
    var entry = newSoloEntry(card, 'extra'); day.entries.push(entry); saveSoloDay(day);
    return { ok: true, entry: entry, card: card };
  }
  function soloHistory() {
    var days = soloDays();
    return Object.keys(days).sort().reverse().map(function (key) { return normalizeSoloDay(days[key]); });
  }
  function exportSoloText() {
    return soloHistory().map(function (day) {
      return day.date + ' · 第 ' + day.week + ' 周\n' + day.entries.filter(function (entry) { return entry.skipped || entry.revealed || entry.note; }).map(function (entry) {
        if (entry.skipped) return '\n当日此步骤已跳过（未翻开卡牌）';
        var card = cardMap[entry.cardId];
        if (!card) return '';
        return '\n' + card.code + ' ' + card.levelLabel + '\n' + card.zh + '\n' + card.en + '\n\n' + (entry.note || '（尚未记录）');
      }).join('\n');
    }).join('\n\n──────────\n\n');
  }
  function resetSceneHistory(sceneId) {
    if (!sceneFor(sceneId)) return { ok: false, reason: 'no-scene' };
    saveSeen(sceneId, []);
    if (sceneId === 'solo') write('solo-seen', []);
    array(sceneFor(sceneId).modes).forEach(function (mode) {
      array(mode.stages).forEach(function (stage) {
        write('sequence:' + sceneId + ':' + mode.id + ':' + stage.id, 0);
      });
    });
    return { ok: true };
  }

  global.TalkCardsEngine = {
    createSession: createSession, card: function (id) { return cardMap[id] || null; },
    scene: sceneFor, stagePool: stagePool, resetSceneHistory: resetSceneHistory,
    getSoloDay: getSoloDay, revealSolo: revealSolo, rejectSolo: rejectSolo, skipSolo: skipSolo,
    saveSoloNote: saveSoloNote, drawSoloExtra: drawSoloExtra,
    soloHistory: soloHistory, exportSoloText: exportSoloText,
    storageStatus: function () { return { ok: storageOK, message: storageMessage }; }
  };
})(window);
