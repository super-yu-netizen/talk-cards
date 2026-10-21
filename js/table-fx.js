/* 桌面动画只负责呈现，不读取题目数据、不改变抽牌或玩家状态。 */
(function () {
  'use strict';

  var jobs = new Set();
  var waitingCards = new Set();
  var fanLayouts = new WeakMap();
  var serial = 0;

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function abort() {
    var error = new Error('桌面动画已取消');
    error.name = 'AbortError';
    return error;
  }

  function ensure(job) {
    if (job.cancelled) throw abort();
  }

  function dispose(job) {
    if (job.disposed) return;
    job.disposed = true;
    job.animations.forEach(function (animation) {
      try { animation.cancel(); } catch (error) { /* 已结束的动画可直接清理。 */ }
    });
    job.nodes.forEach(function (node) { node.remove(); });
    job.restores.slice().reverse().forEach(function (restore) { restore(); });
    if (job.cancelled) job.cancelRestores.slice().reverse().forEach(function (restore) { restore(); });
    jobs.delete(job);
  }

  function run(work) {
    var job = { animations: new Set(), nodes: new Set(), restores: [], cancelRestores: [], cancelled: false, completed: false, disposed: false };
    jobs.add(job);
    return (async function () {
      try {
        var result = await work(job);
        ensure(job);
        job.completed = true;
        return Object.assign({ cancelled: false }, result || {});
      } catch (error) {
        if (job.cancelled || error.name === 'AbortError') return { cancelled: true };
        throw error;
      } finally {
        dispose(job);
      }
    }());
  }

  function cleanup() {
    jobs.forEach(function (job) { job.cancelled = true; dispose(job); });
    waitingCards.forEach(function (card) { card.classList.remove('table-deep-wait'); });
    waitingCards.clear();
  }

  function layer() {
    var root = document.getElementById('fx-layer');
    if (!root) {
      root = document.createElement('div');
      root.id = 'fx-layer';
      root.setAttribute('aria-hidden', 'true');
      document.body.appendChild(root);
    }
    return root;
  }

  function temporaryClass(job, element, name) {
    if (!element) return;
    var existed = element.classList.contains(name);
    element.classList.add(name);
    job.restores.push(function () { if (!existed) element.classList.remove(name); });
  }

  function conceal(job, element, keepOnSuccess) {
    if (!element) return function () {};
    var before = element.style.visibility;
    var restored = false;
    element.style.visibility = 'hidden';
    function restore(show) {
      if (restored) return;
      restored = true;
      // 抽中的小卡只在取消时复原；成功后交给应用重新码牌替换 DOM。
      element.style.visibility = show === true ? 'visible' : keepOnSuccess && job.completed ? 'hidden' : before;
    }
    job.restores.push(restore);
    job.cancelRestores.push(function () { element.style.visibility = before; });
    return restore;
  }

  function rect(element, snapshot) {
    var value = snapshot || element && element.getBoundingClientRect();
    if (!value) return null;
    var result = { left: Number(value.left), top: Number(value.top), width: Number(value.width), height: Number(value.height) };
    if (!Object.keys(result).every(function (key) { return Number.isFinite(result[key]); }) || result.width <= 0 || result.height <= 0) return null;
    return result;
  }

  async function play(job, element, frames, options) {
    ensure(job);
    if (!element || typeof element.animate !== 'function') return;
    var animation = element.animate(frames, Object.assign({ duration: 200, easing: 'ease-out', fill: 'both' }, options || {}));
    job.animations.add(animation);
    try { await animation.finished; } catch (error) { if (job.cancelled) throw abort(); throw error; }
    ensure(job);
  }

  /* 克隆的 SVG 重新命名渐变 ID，避免和真卡及其他飞行卡发生冲突。 */
  function uniqueSVG(node) {
    var prefix = 'table-fx-' + (++serial) + '-';
    var ids = {};
    node.querySelectorAll('[id]').forEach(function (element) {
      ids[element.id] = prefix + element.id;
      element.id = ids[element.id];
    });
    node.querySelectorAll('*').forEach(function (element) {
      Array.from(element.attributes).forEach(function (attribute) {
        var value = attribute.value;
        Object.keys(ids).forEach(function (oldID) {
          value = value.split('url(#' + oldID + ')').join('url(#' + ids[oldID] + ')');
          if (value === '#' + oldID) value = '#' + ids[oldID];
        });
        if (value !== attribute.value) element.setAttribute(attribute.name, value);
      });
    });
  }

  function backHTML(element) {
    if (!element) return '';
    var art = element.querySelector('.card-back-art');
    if (art) return art.outerHTML;
    var reverse = element.querySelector('.card-reverse');
    return reverse ? reverse.innerHTML : element.innerHTML;
  }

  function sourceHTML(element) {
    if (!element) return '';
    var face = element.classList.contains('revealed') && element.querySelector('.card-face');
    return face ? face.outerHTML : backHTML(element);
  }

  function flight(job, box, html, className) {
    var node = document.createElement('div');
    node.className = 'table-fx-flight ' + (className || '');
    node.style.left = box.left + 'px';
    node.style.top = box.top + 'px';
    node.style.width = box.width + 'px';
    node.style.height = box.height + 'px';
    node.innerHTML = html || '';
    uniqueSVG(node);
    layer().appendChild(node);
    job.nodes.add(node);
    return node;
  }

  function angle(element) {
    return element ? Number.parseFloat(element.style.getPropertyValue('--fan-angle')) || 0 : 0;
  }

  function transform(x, y, scaleX, scaleY, degrees) {
    return 'translate(' + x + 'px,' + y + 'px) scale(' + scaleX + ',' + scaleY + ') rotate(' + (degrees || 0) + 'deg)';
  }

  function layoutFan(count, options) {
    options = options || {};
    count = Math.max(0, Math.floor(Number(count) || 0));
    var mobile = options.mobile != null ? options.mobile : window.innerWidth <= 600;
    var width = Math.max(64, Number(options.width) || Math.min(mobile ? 340 : 560, window.innerWidth - 32));
    var projection = options.projection != null ? options.projection : document.body.classList.contains('projection');
    var single = !!options.single;
    var cardWidth = Number(options.cardWidth) || (single ? projection ? 280 : 240 : projection ? 84 : 64);
    cardWidth = Math.min(cardWidth, width * 0.48);
    if (single) cardWidth = Math.min(projection ? 280 : 240, width);
    var cardHeight = Math.round(cardWidth * 340 / 240);
    var maxPerRow = mobile ? 7 : 9;
    var wheel = !single && count > maxPerRow;
    var quiet = options.reduced != null ? options.reduced : reduced();
    var half = Math.max(1, (maxPerRow - 1) / 2);
    // 外侧卡旋转后横向伸出，投屏卡更高；步距需给四角和微缩放留余量。
    var edgeAngle = quiet || single ? 0 : Math.min(Math.max(0, (count - 1) / 2), half) * 6 * Math.PI / 180;
    var edgePadding = 12 + Math.sin(edgeAngle) * cardHeight / 2 + (quiet || single ? 0 : cardWidth * 0.025);
    var step = single ? 0 : wheel ? cardWidth * 0.78 : count > 1 ? Math.min(cardWidth * 0.76, (width - cardWidth - edgePadding * 2) / (count - 1)) : 0;
    step = Math.max(0, step);
    var padding = wheel ? (width - cardWidth) / 2 : (width - cardWidth - Math.max(0, count - 1) * step) / 2;
    var trackWidth = wheel ? width + Math.max(0, count - 1) * step : width;
    var maxScroll = Math.max(0, trackWidth - width);
    var scrollLeft = Math.max(0, Math.min(maxScroll, Number(options.scrollLeft) || 0));
    var center = wheel && step ? scrollLeft / step : (count - 1) / 2;
    var cards = [];
    for (var index = 0; index < count; index += 1) {
      var distance = Math.max(-half, Math.min(half, index - center));
      cards.push({
        row: 0, column: index, x: single ? (width - cardWidth) / 2 : padding + index * step,
        y: single ? 0 : quiet ? 14 : 14 + Math.pow(Math.abs(distance), 1.6) * 3,
        angle: single || quiet ? 0 : distance * 6,
        scale: single || quiet ? 1 : 1 + 0.05 * (1 - Math.min(1, Math.abs(distance) / half)),
        z: 1000 - Math.round(Math.abs(distance) * 20)
      });
    }
    return { cards: cards, slots: cards, width: width, trackWidth: trackWidth, height: single ? cardHeight : cardHeight + 70,
      cardWidth: cardWidth, cardHeight: cardHeight, maxPerRow: maxPerRow, rows: count ? 1 : 0, wheel: wheel,
      step: step, scrollLeft: scrollLeft, maxScroll: maxScroll, initialScrollLeft: maxScroll / 2 };
  }

  function viewportFor(fan) {
    return fan && fan.closest('.fan-wheel-viewport');
  }
  function fanSlots(fan) {
    return fan ? Array.from(fan.querySelectorAll('.fan-card,.fan-hole,.fan-latent')) : [];
  }
  function applyFanLayout(fan, result) {
    fanSlots(fan).forEach(function (element, fallback) {
      var index = Number(element.dataset.slotIndex);
      if (!Number.isInteger(index) || index < 0) index = fallback;
      var position = result.cards[index];
      if (!position) return;
      element.style.left = position.x + 'px';
      element.style.top = position.y + 'px';
      element.style.setProperty('--fan-angle', position.angle + 'deg');
      element.style.setProperty('--wheel-scale', String(position.scale));
      element.style.zIndex = String(position.z);
      element.dataset.fanRow = '0';
      element.dataset.fanColumn = String(index);
    });
  }
  function layout(fan, options) {
    if (!fan) return layoutFan(0, options);
    options = Object.assign({}, options || {});
    var elements = fanSlots(fan), viewport = viewportFor(fan), wrap = fan.closest('.fan-wheel-wrap');
    var count = Math.max(elements.length, Number(fan.dataset.slotCount) || 0);
    elements.forEach(function (element) { count = Math.max(count, (Number(element.dataset.slotIndex) || 0) + 1); });
    var single = fan.classList.contains('single-ritual');
    var wheel = !single && count > (window.innerWidth <= 600 ? 7 : 9);
    fan.classList.toggle('is-wheel', wheel);
    if (viewport) viewport.classList.toggle('is-wheel', wheel);
    if (wrap) {
      wrap.classList.toggle('is-wheel', wheel);
      wrap.classList.toggle('is-exhausted', fan.dataset.count === '0');
    }
    var measured = viewport ? viewport.clientWidth : fan.getBoundingClientRect().width;
    if (!options.width && measured > 0) options.width = measured;
    options.single = single;
    var oldScroll = viewport ? viewport.scrollLeft : 0;
    options.scrollLeft = Number.isFinite(options.scrollLeft) ? options.scrollLeft : oldScroll;
    var result = layoutFan(count, options);
    if (options.initialCenter && result.wheel) result = layoutFan(count, Object.assign({}, options, {scrollLeft: result.initialScrollLeft}));
    fan.style.width = result.trackWidth + 'px';
    fan.style.height = result.height + 'px';
    fan.style.setProperty('--fan-card-width', result.cardWidth + 'px');
    fan.style.setProperty('--fan-card-height', result.cardHeight + 'px');
    if (viewport) viewport.scrollLeft = result.scrollLeft;
    applyFanLayout(fan, result);
    fanLayouts.set(fan, {count: count, width: result.width, single: single, cardWidth: result.cardWidth});
    return result;
  }

  function updateWheel(fan) {
    var known = fan && fanLayouts.get(fan);
    if (!known) return layout(fan);
    var viewport = viewportFor(fan);
    var result = layoutFan(known.count, {width: known.width, single: known.single, cardWidth: known.cardWidth,
      scrollLeft: viewport ? viewport.scrollLeft : 0});
    applyFanLayout(fan, result);
    return result;
  }
  function visibleCards(fan, options) {
    if (!fan) return [];
    options = options || {};
    var clip = rect(viewportFor(fan) || fan);
    if (!clip) return [];
    var left = Math.max(0, clip.left), right = Math.min(window.innerWidth, clip.left + clip.width);
    var top = Math.max(0, clip.top), bottom = Math.min(window.innerHeight, clip.top + clip.height);
    return Array.from(fan.querySelectorAll('.fan-card')).filter(function (card) {
      var box = rect(card);
      var enabled = options.includeBusy || !card.disabled && card.getAttribute('aria-disabled') !== 'true';
      return enabled && box && card.style.visibility !== 'hidden' && box.left < right && box.left + box.width > left && box.top < bottom && box.top + box.height > top;
    });
  }
  function nearestCard(fan) {
    var clip = rect(viewportFor(fan) || fan);
    if (!clip) return null;
    var center = clip.left + clip.width / 2;
    return visibleCards(fan).reduce(function (nearest, card) {
      var box = rect(card), distance = Math.abs(box.left + box.width / 2 - center);
      return !nearest || distance < nearest.distance ? {card: card, distance: distance} : nearest;
    }, null)?.card || null;
  }

  function prepare(fan, options) {
    options = options || {};
    return run(async function (job) {
      if (!fan) return;
      layout(fan, options);
      if (options.initial === false) return;
      // 首次准备时应用会临时禁用按钮，候选类型由 fan-card 表达，不能误跳过整组。
      var cards = visibleCards(fan, {includeBusy: true});
      if (!cards.length) return;
      temporaryClass(job, fan, 'fx-preparing');
      if (reduced()) {
        await play(job, fan, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
        return;
      }
      if (cards.length === 1) return;
      var boxes = cards.map(function (card) { return rect(card); });
      var fanBox = rect(viewportFor(fan) || fan);
      if (!fanBox || boxes.some(function (box) { return !box; })) return;
      var centerX = fanBox.left + fanBox.width / 2;
      var centerY = fanBox.top + Math.min(fanBox.height / 2, 95);
      var shows = cards.map(function (card) { return conceal(job, card); });
      if (!options.quick) {
        var pileWidth = Math.min(window.innerWidth <= 600 ? 96 : 112, fanBox.width * 0.36);
        var pileHeight = pileWidth * 340 / 240;
        var pileBox = { left: centerX - pileWidth / 2, top: centerY - pileHeight / 2, width: pileWidth, height: pileHeight };
        var amount = Math.min(cards.length, 7);
        var pile = [];
        for (var i = 0; i < amount; i += 1) {
          var clone = flight(job, pileBox, backHTML(cards[i]), 'table-fx-source-back');
          clone.style.zIndex = String(i + 1);
          pile.push(clone);
        }
        await Promise.all(pile.map(function (clone, index) {
          var direction = index % 2 ? 1 : -1;
          var spread = amount === 2 ? 45 : Math.min(80, fanBox.width * 0.23);
          if (amount === 2) {
            return play(job, clone, [
              { transform: 'translate(' + direction * 9 + 'px,0) rotate(0deg)', offset: 0 },
              { transform: 'translate(' + direction * spread + 'px,' + direction * 9 + 'px) rotate(' + direction * 7 + 'deg)', offset: 0.3 },
              { transform: 'translate(' + -direction * spread + 'px,' + -direction * 9 + 'px) rotate(' + -direction * 7 + 'deg)', offset: 0.65 },
              { transform: 'translate(' + -direction * 9 + 'px,0) rotate(0deg) scale(1.02)', offset: 0.93 },
              { transform: 'translate(' + -direction * 9 + 'px,0) rotate(0deg) scale(1)', offset: 1 }
            ], { duration: 1000, easing: 'cubic-bezier(.2,.7,.3,1)' });
          }
          return play(job, clone, [
            { transform: 'translate(' + index * 1.3 + 'px,' + index * 1.1 + 'px) rotate(0deg)', offset: 0 },
            { transform: 'translate(' + direction * spread + 'px,-8px) rotate(' + direction * 9 + 'deg)', offset: 0.30 },
            { transform: 'translate(' + direction * spread + 'px,-8px) rotate(' + direction * 9 + 'deg)', offset: 0.38 + index * 0.035 },
            { transform: 'translate(0,0) rotate(0deg) scale(1)', offset: 0.83 },
            { transform: 'translate(0,2px) rotate(0deg) scale(1.02)', offset: 0.93 },
            { transform: 'translate(0,0) rotate(0deg) scale(1)', offset: 1 }
          ], { duration: 1000, easing: 'cubic-bezier(.2,.7,.3,1)' });
        }));
        pile.forEach(function (clone) { clone.remove(); job.nodes.delete(clone); });
      }
      cards.forEach(function (card, index) { shows[index](); });
      await Promise.all(cards.map(function (card, index) {
        var box = boxes[index];
        var dx = centerX - (box.left + box.width / 2);
        var dy = centerY - (box.top + box.height / 2);
        return play(job, card, [
          { transform: transform(dx, dy, options.quick ? 0.94 : 1.35, options.quick ? 0.94 : 1.35, 0), opacity: options.quick ? 0.55 : 0 },
          { transform: 'rotate(' + angle(card) + 'deg) scale(' + (card.style.getPropertyValue('--wheel-scale') || 1) + ')', opacity: 1 }
        ], { duration: 300, delay: options.quick ? 0 : Math.min(index, window.innerWidth <= 600 ? 6 : 8) * 50, easing: 'cubic-bezier(.2,.72,.25,1)' });
      }));
    });
  }

  function draw(options) {
    options = options || {};
    return run(async function (job) {
      var fan = options.fan;
      var target = options.target;
      var candidates = fan ? Array.from(fan.querySelectorAll('.fan-card')) : [];
      var source = options.source || candidates[0];
      if (!target) return { source: source || null };
      if (source) job.restores.push(function () { source.classList.remove('is-selected'); });
      var sourceBox = rect(source, options.sourceRect);
      var targetBox = rect(target, options.targetRect);
      var showTarget = conceal(job, target);
      var wasRevealed = target.classList.contains('revealed');
      job.cancelRestores.push(function () { target.classList.toggle('revealed', wasRevealed); });
      if (reduced()) {
        if (source !== target) conceal(job, source, true);
        if (!options.deep) target.classList.add('revealed');
        showTarget(true);
        await play(job, target, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      } else if (!sourceBox || !targetBox || options.kind === 'fixed' || Number(fan && fan.dataset.count) === 1) {
        if (source !== target) conceal(job, source, true);
        showTarget(true);
        await play(job, target, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 150 });
      } else {
        var fanBox = rect(fan, options.fanRect);
        var viewportBox = rect(viewportFor(fan), options.viewportRect);
        var visualFan = null;
        var visualClip = null;
        var restoreFan = null;
        if (fan && fanBox) {
          // 保留抽牌前的滚动视口，只克隆当前可见区域；全量轨道不能越出裁剪框。
          if (viewportBox) {
            visualClip = document.createElement('div');
            visualClip.className = 'table-fx-wheel-clip' + (fan.classList.contains('is-wheel') ? ' is-wheel' : '');
            visualClip.setAttribute('aria-hidden', 'true');
            Object.assign(visualClip.style, {left: viewportBox.left + 'px', top: viewportBox.top + 'px', width: viewportBox.width + 'px', height: viewportBox.height + 'px'});
            layer().appendChild(visualClip);
            job.nodes.add(visualClip);
          }
          visualFan = fan.cloneNode(true);
          ['id', 'role', 'tabindex'].forEach(function (name) { visualFan.removeAttribute(name); });
          visualFan.setAttribute('aria-hidden', 'true');
          visualFan.setAttribute('inert', '');
          visualFan.removeAttribute('aria-disabled');
          visualFan.classList.remove('holding', 'fx-preparing');
          visualFan.querySelectorAll('[data-pick]').forEach(function (card) {
            card.removeAttribute('data-pick');
            card.setAttribute('tabindex', '-1');
          });
          uniqueSVG(visualFan);
          var snapshotScroll = Number.isFinite(options.scrollLeft) ? options.scrollLeft : null;
          var left = visualClip ? fan.classList.contains('is-wheel') && snapshotScroll !== null ? -snapshotScroll : fanBox.left - viewportBox.left : fanBox.left;
          Object.assign(visualFan.style, { position: 'absolute', left: left + 'px', top: (visualClip ? fanBox.top - viewportBox.top : fanBox.top) + 'px', width: fanBox.width + 'px', height: fanBox.height + 'px', margin: '0', zIndex: '0', pointerEvents: 'none', opacity: '1' });
          (visualClip || layer()).appendChild(visualFan);
          job.nodes.add(visualFan);
          restoreFan = conceal(job, fan);
        }
        var visualCards = visualFan ? Array.from(visualFan.querySelectorAll('.fan-card')) : [];
        visualCards.forEach(function (card) { card.classList.remove('is-selected'); });
        // 孔不属于活卡列表；用稳定槽位键映射，不能压缩活卡索引后错取邻牌。
        var selectedVisual = source && source.dataset.slot != null ? visualCards.find(function (card) { return card.dataset.slot === source.dataset.slot; }) : visualCards[candidates.indexOf(source)];
        if (selectedVisual) {
          // 只在按住的同一张卡上集中发光，不从其他位置扫过。
          selectedVisual.classList.add('is-selected');
          selectedVisual.style.opacity = '1';
          await play(job, selectedVisual, [
            { boxShadow: '0 0 0 1px #f0d29ac0,0 0 16px #e9c68b66,0 6px 18px #0005' },
            { boxShadow: '0 0 0 2px #ffe4adc0,0 0 30px #edcc94aa,0 6px 18px #0005', offset: 0.4 },
            { boxShadow: '0 0 0 1px #f0d29ac0,0 0 18px #e9c68b77,0 6px 18px #0005' }
          ], { duration: 300, easing: 'ease-in-out' });
        }
        if (selectedVisual) selectedVisual.style.visibility = 'hidden';
        conceal(job, source, true);
        var clone = flight(job, targetBox, '<div class="table-fx-back table-fx-source-back">' + (options.sourceBackHTML || backHTML(source)) + '</div>');
        var dx = sourceBox.left + sourceBox.width / 2 - targetBox.left - targetBox.width / 2;
        var dy = sourceBox.top + sourceBox.height / 2 - targetBox.top - targetBox.height / 2;
        var sx = sourceBox.width / targetBox.width;
        var sy = sourceBox.height / targetBox.height;
        var rotation = angle(source);
        var start = transform(dx, dy, sx, sy, rotation);
        var lifted = transform(dx, dy - 24, sx * 1.06, sy * 1.06, rotation);
        await play(job, clone, [{ transform: start }, { transform: lifted }], { duration: 150 });
        var fresh = document.createElement('div');
        fresh.className = 'table-fx-back table-fx-target-back';
        fresh.style.opacity = '0';
        fresh.innerHTML = options.backHTML || backHTML(target);
        uniqueSVG(fresh);
        clone.appendChild(fresh);
        var old = clone.firstElementChild;
        // 换背在飞行末段完成，避免额外串行等待 150ms。
        await Promise.all([
          play(job, clone, [
            { transform: lifted },
            { transform: transform(dx * 0.46, dy * 0.46 - 36, sx + (1 - sx) * 0.56, sy + (1 - sy) * 0.56, rotation * 0.4), offset: 0.5 },
            { transform: transform(0, 0, 1, 1, 0) }
          ], { duration: 450, easing: 'cubic-bezier(.2,.65,.23,1)' }),
          play(job, old, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, delay: 300 }),
          play(job, fresh, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 300 })
        ]);
        if (visualFan) { visualFan.remove(); job.nodes.delete(visualFan); }
        if (visualClip) { visualClip.remove(); job.nodes.delete(visualClip); }
        if (restoreFan) restoreFan();
        showTarget(true);
      }
      if (options.deep) {
        target.classList.add('table-deep-wait');
        waitingCards.add(target);
      }
      return { source: source || null };
    });
  }

  function flip(card, deep) {
    return run(async function (job) {
      if (!card) return;
      var wasRevealed = card.classList.contains('revealed');
      var wasPending = card.classList.contains('pending');
      card.classList.remove('pending', 'table-deep-wait');
      waitingCards.delete(card);
      temporaryClass(job, card, 'fx-flipping');
      job.cancelRestores.push(function () {
        card.classList.toggle('revealed', wasRevealed);
        card.classList.toggle('pending', wasPending);
      });
      card.classList.add('revealed');
      if (reduced()) {
        if (!wasRevealed) await play(job, card, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
        return;
      }
      await play(job, card, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: deep ? 1500 : 800, easing: 'cubic-bezier(.22,.65,.25,1)', delay: 0 });
    });
  }

  async function flyInJob(job, options) {
    var source = options.source || options.card;
    var target = options.target || options.targetPile;
    var sourceBox = rect(source, options.sourceRect);
    var targetBox = rect(target, options.targetRect);
    if (!sourceBox || !targetBox) return;
    var showTarget = options.showTarget === false ? function () {} : conceal(job, target);
    if (options.hideSource !== false) conceal(job, source);
    if (reduced()) {
      showTarget(true);
      await play(job, target, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 200 });
      return;
    }
    var clone = flight(job, sourceBox, options.backHTML || sourceHTML(source), options.backHTML ? sourceBox.width < 140 ? 'table-fx-source-back' : 'table-fx-target-back' : 'table-fx-snapshot');
    var dx = targetBox.left + targetBox.width / 2 - sourceBox.left - sourceBox.width / 2;
    var dy = targetBox.top + targetBox.height / 2 - sourceBox.top - sourceBox.height / 2;
    var sx = targetBox.width / sourceBox.width;
    var sy = targetBox.height / sourceBox.height;
    await play(job, clone, [
      { transform: transform(0, 0, 1, 1, 0), opacity: options.delay ? 0 : 1, offset: 0 },
      { transform: transform(0, 0, 1, 1, 0), opacity: 1, offset: 0.01 },
      { transform: transform(dx * 0.5, dy * 0.5 - 25, (1 + sx) / 2, (1 + sy) / 2, 0), opacity: 1, offset: 0.5 },
      { transform: transform(dx, dy, sx, sy, angle(target)), opacity: options.fadeOut ? 0 : 1, offset: 1 }
    ], { duration: options.duration || 400, delay: options.delay || 0, easing: 'cubic-bezier(.25,.62,.24,1)' });
    showTarget(true);
    clone.remove();
    job.nodes.delete(clone);
  }

  function fly(options) {
    return run(function (job) { return flyInJob(job, options || {}); });
  }

  function collect(options) {
    options = Object.assign({ duration: 400, showTarget: false }, options || {});
    return fly(options);
  }

  function discardCard(options) {
    options = options || {};
    var card = options.card || options.source;
    if (card) { card.classList.remove('table-deep-wait'); waitingCards.delete(card); }
    return run(async function (job) {
      if (!card) return;
      // 深卡拒绝只淡出中央卡，原槽保留空孔，不飞回或补牌。
      await play(job, card, [{opacity: 1}, {opacity: 0}], {duration: 200});
      conceal(job, card, true);
    });
  }

  function returnCard(options) {
    options = Object.assign({ duration: 400, fadeOut: true }, options || {});
    var card = options.card || options.source;
    if (card) { card.classList.remove('table-deep-wait'); waitingCards.delete(card); }
    return fly(options);
  }

  function endRound(options) {
    options = options || {};
    return run(async function (job) {
      var targets = Array.from(options.targets || []);
      var sources = Array.from(options.cards || []);
      if (!targets.length) return;
      /* 已聊堆会被多张缩略图共同用作起点，所以只隐藏一次。 */
      if (options.sourcePile) conceal(job, options.sourcePile, true);
      if (options.activeCard) conceal(job, options.activeCard, true);
      if (reduced()) {
        await Promise.all(targets.map(function (target) { return play(job, target, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 }); }));
        return;
      }
      await Promise.all(targets.map(function (target, index) {
        var source = sources[index] || (index === targets.length - 1 && options.activeCard ? options.activeCard : options.sourcePile);
        return flyInJob(job, {
          source: source,
          sourceRect: options.sourceRects && options.sourceRects[index] || (source === options.sourcePile ? options.sourcePileRect : source === options.activeCard ? options.activeCardRect : null),
          target: target,
          backHTML: backHTML(target),
          hideSource: false,
          delay: index * 60,
          duration: 450
        });
      }));
    });
  }

  window.TableFX = {
    prepare: prepare,
    draw: draw,
    flip: flip,
    collect: collect,
    discardCard: discardCard,
    returnCard: returnCard,
    fly: fly,
    endRound: endRound,
    layout: layout,
    updateWheel: updateWheel,
    visibleCards: visibleCards,
    nearestCard: nearestCard,
    layoutFan: layoutFan,
    cleanup: cleanup,
    reduced: reduced
  };
}());
