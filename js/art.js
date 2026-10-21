/* 卡背图案只根据数据中的颜色、名称和图案关键词生成。 */
(function () {
  'use strict';

  var sequence = 0;

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function findSeries(key) {
    var series = window.GAME_DATA && window.GAME_DATA.series || [];
    return series.find(function (item) { return item.key === key; }) || series[0] || {};
  }

  function color(value, fallback) {
    return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : fallback;
  }

  function stars() {
    return '<path d="M53 73v10m-5-5h10M187 217v10m-5-5h10M182 67v6m-3-3h6M59 226v6m-3-3h6"/><circle cx="73" cy="106" r="1.5"/><circle cx="172" cy="194" r="1.5"/>';
  }

  function motifArt(motif) {
    if (/云|雨滴/.test(motif)) {
      return '<circle cx="146" cy="126" r="26"/><path d="M146 89v-9m0 92v-9m37-37h9m-9-29 6-6m-80 6-6-6m80 64 6 6"/>' +
        '<path d="M79 163h79a19 19 0 0 0 0-38c-4-21-33-27-47-9-22-9-42 7-36 27-14 1-13 20 4 20Z" fill="#1d2630"/>' +
        '<path d="m92 179-6 12m34-12-6 12m34-12-6 12M83 211h74"/>';
    }
    if (/螺旋|气泡/.test(motif)) {
      return '<path d="M135 151c-19-16-42 7-25 23 20 18 56-12 35-42-24-34-83-5-62 40 25 53 108 18 88-46"/>' +
        '<circle cx="167" cy="100" r="13"/><circle cx="69" cy="129" r="7"/><circle cx="168" cy="202" r="5"/>' +
        '<path d="m100 94 4 10 11 1-9 7 2 11-9-6-10 5 3-11-8-8 11 1ZM154 183l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>';
    }
    if (/手机|箭头/.test(motif)) {
      return '<rect x="87" y="100" width="66" height="112" rx="12"/><path d="M109 109h23M97 187h46"/><circle cx="120" cy="199" r="3"/>' +
        '<path d="M110 164v-21a12 12 0 0 1 12-12h40m-11-11 11 11-11 11M72 160h-9m5-5v10"/>' +
        '<circle cx="171" cy="169" r="4"/><circle cx="67" cy="123" r="3"/><circle cx="164" cy="198" r="2"/>';
    }
    if (/胶囊|钥匙/.test(motif)) {
      return '<g transform="rotate(-32 111 145)"><rect x="85" y="104" width="49" height="82" rx="24.5"/><path d="M86 145h47M97 118c4-5 8-7 14-7"/></g>' +
        '<circle cx="150" cy="175" r="17"/><circle cx="150" cy="175" r="6"/><path d="m137 188-25 25-8-8m13-8 7 7"/>' +
        '<path d="M69 199h15M76 192v14"/>';
    }
    if (/铁轨|车窗/.test(motif)) {
      return '<path d="m85 221 27-97m43 97-27-97M98 179h44M93 196h54M89 212h62M104 160h32"/>' +
        '<rect x="86" y="99" width="68" height="73" rx="22" fill="#1d2630"/><circle cx="120" cy="126" r="17"/><path d="M102 157h36"/>' +
        '<path d="M171 127v66M159 126h25v-22h-25ZM163 112h17M163 118h13"/>';
    }
    if (/信封|邮戳/.test(motif)) {
      return '<g transform="rotate(-8 116 153)"><rect x="67" y="120" width="102" height="72" rx="5"/><path d="m70 124 48 38 48-38M70 188l34-31m62 31-34-31"/></g>' +
        '<circle cx="159" cy="113" r="24"/><circle cx="159" cy="113" r="19" stroke-dasharray="2 4"/><path d="M148 113h23M159 103v20M75 208h70m-60 8h45"/>';
    }
    if (/天平|分叉路|滑杆/.test(motif)) {
      return '<path d="M120 107v95M98 204h44M83 126l37-10 37 10M84 126l-17 34m17-34 17 34m56-34-17 34m17-34 17 34"/>' +
        '<path d="M65 160c3 23 35 23 38 0Zm73 0c3 23 35 23 38 0Z"/><circle cx="120" cy="106" r="5"/>' +
        '<path d="M80 218h80"/><circle cx="104" cy="218" r="5" fill="#1d2630"/>';
    }
    if (/镜面|对称/.test(motif)) {
      return '<ellipse cx="120" cy="146" rx="48" ry="62"/><ellipse cx="120" cy="146" rx="41" ry="55"/><path d="m96 137 34-32m-35 49 51-49m-40 70 28-28M108 208v11m24-11v11m-34 0h44"/>' +
        '<path d="M62 146h-9m134 0h-9M120 78v-9"/>';
    }
    if (/暗房|胶片/.test(motif)) {
      var perforations = '';
      for (var y = 112; y < 197; y += 17) {
        perforations += '<rect x="74" y="' + y + '" width="6" height="8" rx="1"/><rect x="160" y="' + y + '" width="6" height="8" rx="1"/>';
      }
      return '<rect x="67" y="104" width="106" height="99" rx="6"/><rect x="91" y="113" width="58" height="81" rx="2"/>' + perforations +
        '<path d="M120 87v-12M99 112a21 21 0 0 1 42 0ZM108 94h24M107 167c8-8 17-8 26 0M116 142h8"/>';
    }
    if (/硬币|钱包/.test(motif)) {
      return '<rect x="68" y="135" width="104" height="66" rx="10"/><path d="M68 153h103M73 136v-10a8 8 0 0 1 8-8h67m-55 74h24"/>' +
        '<rect x="144" y="154" width="34" height="25" rx="6" fill="#1d2630"/><circle cx="155" cy="166" r="2"/>' +
        '<circle cx="123" cy="110" r="20" fill="#1d2630"/><circle cx="123" cy="110" r="14"/><path d="M123 102v16m-4-16h7m-7 8h7m-7 8h7"/>';
    }
    if (/心电|听诊/.test(motif)) {
      return '<path d="M89 105v37a25 25 0 0 0 50 0v-37M89 105h11m39 0h-11M95 105v8m38-8v8M114 168v14a23 23 0 0 0 46 0v-13"/>' +
        '<circle cx="160" cy="157" r="12"/><circle cx="160" cy="157" r="6"/><path d="M67 213h27l8-16 10 26 10-20 8 10h43"/>';
    }
    if (/火焰|曲线/.test(motif)) {
      return '<path d="M124 90c8 35-29 48-24 76-5-8-12-14-13-26-29 36-12 77 31 77 48 0 74-49 39-83 2 23-8 30-15 34 8-38-7-65-18-78Z"/>' +
        '<path d="M124 153c-5 21-27 30-19 49 8 20 41 13 39-9-1-13-11-21-20-40ZM72 102c0 18 13 20 13 36m80 56c11-5 15-17 12-29"/>';
    }
    return '<circle cx="120" cy="151" r="42"/><path d="M120 99v104M68 151h104m-87-35 70 70m0-70-70 70"/>';
  }

  function svg(series, compact) {
    var id = 'talkcards-art-' + (++sequence);
    var primary = color(series.color, '#C6A477');
    var secondary = color(series.color2, '#EADBC6');
    var geometry = motifArt(series.motif || '');
    if (compact) {
      return '<svg class="series-icon" viewBox="45 70 150 165" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<g fill="none" stroke="' + primary + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + geometry + '</g></svg>';
    }
    return '<svg class="card-back-svg" viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '-base" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#222631"/><stop offset="1" stop-color="#151a22"/></linearGradient>' +
      '<radialGradient id="' + id + '-halo"><stop stop-color="' + primary + '" stop-opacity=".24"/><stop offset="1" stop-color="' + secondary + '" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="240" height="340" rx="18" fill="url(#' + id + '-base)"/>' +
      '<rect x="9" y="9" width="222" height="322" rx="12" fill="none" stroke="' + primary + '" stroke-opacity=".4"/>' +
      '<rect x="15" y="15" width="210" height="310" rx="8" fill="none" stroke="#fff4df" stroke-opacity=".12"/>' +
      '<ellipse cx="120" cy="149" rx="108" ry="122" fill="url(#' + id + '-halo)"/>' +
      '<g fill="none" stroke="' + primary + '" stroke-width="1" stroke-linecap="round" opacity=".55">' + stars() +
      '<path d="M27 47V28h19M194 28h19v19M27 292v19h19M194 311h19v-19M106 52h28M106 250h28"/></g>' +
      '<circle cx="120" cy="151" r="82" fill="none" stroke="' + primary + '" stroke-opacity=".2" stroke-dasharray="1 7"/>' +
      '<g fill="none" stroke="#fff0dc" stroke-opacity=".84" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + geometry + '</g>' +
      '</svg>';
  }

  function back(key, options) {
    var series = findSeries(key);
    var language = options && options.language || 'bilingual';
    var label = language === 'en' ? escape(series.en) : escape(series.zh);
    var english = language === 'bilingual' ? '<span class="card-back-name-en">' + escape(series.en) + '</span>' : '';
    return '<div class="card-back-art" style="--series-color:' + color(series.color, '#C6A477') + ';--series-light:' + color(series.color2, '#EADBC6') + '">' +
      svg(series, false) + '<div class="card-back-name"><span>' + label + '</span>' + english + '</div></div>';
  }

  window.TalkCardsArt = {
    back: back,
    icon: function (key) { return svg(findSeries(key), true); }
  };
}());
