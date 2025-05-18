const codexStorage = {
  get(key, fallback = null) {
    try {
      const data = localStorage.getItem(`codex.${key}`);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.warn(`⚠️ Could not parse localStorage key: codex.${key}`, e);
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(`codex.${key}`, JSON.stringify(value));
    } catch (e) {
      console.error(`❌ Failed to save to codex.${key}`, e);
    }
  },

  remove(key) {
    localStorage.removeItem(`codex.${key}`);
  }
};

function alphabetizeSelectList( el ) {
  var selected = el.val();
  var opts_list = el.find('option');
  opts_list.sort(function (a, b) { return $(a).text() > $(b).text() ? 1 : -1; });
  el.html('').append(opts_list);
  el.val(selected);
  var opts = [];
  opts_list.each(function() {
    if( $.inArray(this.value, opts) > -1 ) { $(this).remove() } else { opts.push(this.value); }
  });
};

function capitalizeFirstLetter( str ) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : "";
};

function numberWithCommas( x ) {
  var parts = x.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
};

function gaussianRandom( mean = 0, stddev = 1 ) {
  let u = 0, v = 0;
  while ( u === 0 ) u = Math.random(); // avoid 0
  while ( v === 0 ) v = Math.random();
  return mean + stddev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

function getRandomInt( min, max ) {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

function getRandomElement( array ) {
  return Array.isArray(array) && array.length > 0 ? array[Math.floor(Math.random() * array.length)] : null;
};

function toBase64Unicode( obj ) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
};

function fromBase64Unicode( base64 ) {
  return JSON.parse(decodeURIComponent(escape(atob(base64))));
};

function parseMarkdownToJSON( markdown, template = null ) {
  const result = {};
  const lines = markdown.split('\n');

  let inFrontmatter = false;
  let currentKey = null;
  const bodyFields = {};
  const tagSet = new Set();

  for ( let line of lines ) {
    line = line.trim();

    if ( line === '---' ) {	// Frontmatter parsing
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if ( inFrontmatter ) {
      const [key, ...rest] = line.split(':');
      if ( key && rest.length ) result[key.trim()] = rest.join(':').trim();
      continue;
    }

    const tags = line.match(/#([\w-]+)/g);	// Tag detection (e.g., #npc)
    if ( tags ) { tags.forEach( tag => tagSet.add(tag.slice(1)) ); }

    const boldMatch = line.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    if ( boldMatch ) {
      const key = boldMatch[1].toLowerCase().replace(/\s+/g, '_').replace(':','');
      const value = boldMatch[2].trim();
      // Handle multi-item fields like traits
      if (['traits'].includes(key)) {
        bodyFields[key] = value ? value.split(/,\s*|\s+/).map(v => v.trim()).filter(Boolean) : [];
      } else { bodyFields[key] = value || ''; }
      currentKey = key;
      continue;
    }

    // Append continuation lines to the most recent field (for multi-line paragraphs)
    if (currentKey && line && !line.startsWith('**') && !line.startsWith('#')) {
      bodyFields[currentKey] += (bodyFields[currentKey] ? ' ' : '') + line;
    }
  }

  if ( tagSet.size ) result.tags = Array.from(tagSet);
  Object.assign(result, bodyFields);

  if ( template ) {
    const filtered = {};
    for ( const key of Object.keys(template) ) { filtered[key] = result.hasOwnProperty(key) ? result[key] : template[key]; }
    return filtered;
  }

  return result;
}


function loadJSONFiles( fileMap ) {
  const entries = Object.entries(fileMap); // { key: url }
  return Promise.allSettled(
    entries.map(([key, url]) =>
      fetch(url).then(res => { if ( !res.ok ) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then( data => ({ key, data }))
        .catch( err => { console.error(`❌ Failed to load ${key} from ${url}: ${err.message}`); return { key, data: null, error: err };
        })
    )
  ).then( results => {
    const loaded = {};
    results.forEach(result => {
      if (result.status === "fulfilled" && result.value.data) {
        loaded[result.value.key] = result.value.data;
      } else if (result.status === "fulfilled" && result.value.error) {
        console.warn(`⚠️ ${result.value.key} loaded with error: ${result.value.error.message}`);
      } else if (result.status === "rejected") {
        console.error(`❌ Promise rejected for ${result.reason.key}: ${result.reason.message}`);
      }
    });
    return loaded;
  });
};

function parsePassedData( loadCallback ) {
  const params = new URLSearchParams(window.location.search);
  const base64 = params.get("data");
  const jsonFile = params.get("json");
  const ref = params.get("ref");
  const mode = params.get("mode");
  const setInstructions = params.get("set");

  if ( setInstructions ) {
    const pairs = setInstructions.split(",");
    pairs.forEach( pair => {
      const [key, value] = pair.split(":");
      const el = document.getElementById(key) || document.querySelector(`[name="${key}"]`);
      if ( el ) {
        if ( el.tagName == "SELECT" ) {
          const match = Array.from(el.options).find(o => o.value.trim() === value.trim());
          if ( match ) el.value = match.value; el.onchange();
        } else {
          el.value = value;
        }
      }
    });
  }

  if ( base64 ) {
    try {
      const parsed = fromBase64Unicode(base64);
      loadCallback(parsed, { mode, source: "data" });
    } catch (err) {
      console.error("❌ Failed to decode `data`:", err);
      alert("Invalid JSON data.");
    }
    return;
  }

  if ( jsonFile && ref != null ) {
    fetch(`data/${jsonFile}.json`)
      .then( res => res.json() )
      .then( list => {
        const result = Array.isArray(list) ? list.find(c => c.id === ref || c.index == ref || list[ref]) : list?.[ref];
        if ( !result ) throw new Error("Not found");
        loadCallback(result, { mode, source: `${jsonFile}.json` });
      })
      .catch(err => {
        console.error("❌ Failed to load from JSON:", err);
        alert(`Could not load ${jsonFile}.json or item at ref=${ref}`);
      });
    return;
  }
};

function adjustFontSizeByLength(el, options = {}) {
  const {
    charThresholds = [800, 1000, 1200, 1400, 1600],
    scaleFactors = [0.95, 0.9, 0.8, 0.7, 0.6],
    minScale = 0.6
  } = options;

  if ( el.dataset.fontScaled === "true" ) return; // skip if already scaled

  const length = el.textContent.length;
  const style = window.getComputedStyle(el);
  const currentSize = parseFloat(style.fontSize); // in px

  let scale = 1;
  for ( let i = 0; i < charThresholds.length; i++ ) {
    if ( length > charThresholds[i] ) {
      scale = scaleFactors[i];
    } else {
      break; // stop at first non-matching threshold
    }
  }
console.log(length);
console.log(scale);
  scale = Math.max(scale, minScale);
  el.style.fontSize = (currentSize * scale).toFixed(3) + 'px';
  el.dataset.fontScaled = "true";
};

function toolbarAddButton( tb, id, label, options = {} ) {
  const toolbar = typeof tb === 'string' ? document.getElementById(tb) : tb;
  if ( !toolbar ) return;

  let container = toolbar;
  if ( options.group ) {  // Create group container if needed
    let group = document.getElementById(options.group);
    if ( !group ) {
      group = document.createElement('div');
      group.className = 'toolbar-group';
      group.id = options.group;
      toolbar.appendChild(group);
    }
    container = group;
  }

  const button = document.createElement('button');
  button.className = 'btn';
  if ( options.class ) button.classList.add(options.class);
  if ( options.title ) button.title = options.title;
  if ( typeof label === 'string' && label.trim().startsWith('<') ) { button.innerHTML = label; } else { button.textContent = label; }
  button.id = id;

  if (options.onClick) { button.addEventListener('click', options.onClick); }

  container.appendChild(button);
};

function toolbarUpdateButton( id, label, options = {} ) {
  const button = document.getElementById(id);
  if ( !button ) return;

  const original = {
    html: button.innerHTML,
    class: button.className,
    title: button.title
  };

  const fadeWrapper = document.createElement('span');
  fadeWrapper.className = 'content-fade';
  fadeWrapper.innerHTML = typeof newLabel === 'string' && newLabel.trim().startsWith('<') ? label : `<span>${label}</span>`;

  if ( options.class ) button.classList.add(options.class);
  if ( options.title ) button.title = options.title;

  button.classList.add('fading-out');

  setTimeout(() => {
    button.innerHTML = '';
    button.appendChild(fadeWrapper);
    button.classList.remove('fading-out');
    button.classList.add('fading-in', 'scale-feedback');
    setTimeout(() => { button.classList.remove('fading-in', 'scale-feedback'); }, 200);
  }, 150);

  if ( options.revertAfter ) {
    setTimeout(() => {
      button.innerHTML = original.html;
      button.className = original.class;
      button.title = original.title;
    }, options.revertAfter);
  }
};

function toolbarRemoveItem( id ) {
  const element = document.getElementById(id);
  if ( element ) element.remove();
};

function toolbarHideItem( id ) {
  const element = document.getElementById(id);
  if ( element ) element.classList.add('hidden');
};

function toolbarShowItem( id ) {
  const element = document.getElementById(id);
  if ( element ) element.classList.remove('hidden');
};

function hexToRgb( hex ) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return [ parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16) ];
};

function rgbToHex( r, g, b ) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
};

function jsonConcat( o1, o2 ) {
  for (var key in o2) { o1[key] = o2[key]; }
  return o1;
};

function jsonSearch( obj, key1, val1, key2, val2 ) {
  var arr1 = []; var arr2 = [];
  $.each( obj, function( i, o ) {
    $.each( o, function( k, v ) {
      if ( k == key1 ) {
	if ( ( typeof v === 'object' && Object.values(v).includes(val1) ) ||  ( Array.isArray(v) && v.find(a => a.includes(val1)) ) ||  ( typeof v !== 'object' && v.includes(val1) ) ) {
	  arr1.push( obj[i] )
	}
      }
      if ( key2 && k == key2 ) {
	if ( ( typeof v === 'object' && Object.values(v).includes(val2) ) || ( Array.isArray(v) && v.find(a => a.includes(val2)) ) ||  ( typeof v !== 'object' && v.includes(val2) ) ) {
	  arr2.push( obj[i] )
	}
      }
    });
  });
  if ( key2 ) { return arr1.filter(value => arr2.includes(value)); } else { return arr1; }
};

function rollRandom( dice, sum = true ) {
  var arr = [];
  var d = dice.indexOf("d");
  var x = dice.indexOf("x");
  var num = dice.substring(0, d) || 1;
  if ( x >= 0 ) { var die = dice.substring(d+1, x); } else { var die = dice.substring(d+1, dice.length); }
  if ( x >= 0 ) { var mult = dice.substring(x+1, dice.length) } else { var mult = 1 };
  if ( parseInt(d) == 0 ) { d = 1; }
  for ( let i = 0; i < num; i++ ) {
    arr.push(getRandomInt(d, die) * mult);
  }
  if ( sum ) { return arr.reduce((a, b) => a + b); } else { return arr; }
};

function setCookie( name, value ) {
  var cookie = [name, '=', JSON.stringify(value), '; domain=.', window.location.host.toString(), '; path=/;'].join('');
  document.cookie = cookie;
};

function getCookie( name ) {
  var result = document.cookie.match(new RegExp(name + '=([^;]+)'));
  result && (result = JSON.parse(result[1]));
  return result;
};

function deleteCookie( name ) {
  document.cookie = [name, '=; expires=Thu, 01-Jan-1970 00:00:01 GMT; path=/; domain=.', window.location.host.toString()].join('');
};

function getTableResult( table ) {
  // Returns a table result based on random roll as denoted in the table - either a string or array depending on the table
  if (typeof table[0] == "string") {
    return table[rollRandom(table[0])];    // simple table, without ranges
  } else if (typeof table[0] == "object") {
    var ind;    // complex table, with ranges
    var roll = rollRandom(table[0][0]);
    table[0].forEach(function (item, index) {
      if (typeof item == "object") {
	if ( item.length == 2 && roll >= item[0] && roll <= item[1] ) { ind = index; } else if ( item.length == 1 && roll == item[0] ) { ind = index; }
      }
    });
    return table[ind];
  }
};

function buildNavigation() {
  // Define all Codex utilities with PNG icons and links
  const utilities = [
    { id: 'scriptorium', title: 'Scriptorium', subtitle: 'TTRPG Print Shop',       icon: 'images/icon_S_32.png', url: 'scriptorium.htm', description: 'Prints various content (spells, items, monsters, NPCs) in various formats (cards, booklets, etc.)' },
    { id: 'grimorium',   title: 'Grimorium',   subtitle: 'TTRPG Spell Creator',    icon: 'images/icon_G_32.png', url: 'grimorium.htm',   description: 'Creates and manages spells.' },
    { id: 'reliquiarium',title: 'Reliquiarium',subtitle: 'TTRPG Item Creator',     icon: 'images/icon_R_32.png', url: 'reliquiarium.htm',description: 'Builds magical or mundane items.' },
    { id: 'vestiarium',  title: 'Vestiarium',  subtitle: 'TTRPG Character Creator',icon: 'images/icon_V_32.png', url: 'vestiarium.htm',  description: 'Generates and edits characters, with a focus on non-player characters (NPCs).' },
    { id: 'bestiarium',  title: 'Bestiarium',  subtitle: 'TTRPG Monster Creator',  icon: 'images/icon_B_32.png', url: 'bestiarium.htm',  description: 'Builds and saves monsters.' },
    { id: 'tabularium',  title: 'Tabularium',  subtitle: 'TTRPG Map Creator',      icon: 'images/icon_T_32.png', url: 'tabularium.htm',  description: 'Designs or generates maps.' },
    { id: 'cryptarium',  title: 'Cryptarium',  subtitle: 'TTRPG Dungeon Creator',  icon: 'images/icon_C_32.png', url: 'cryptarium.htm',  description: 'Procedural dungeon generator, focusing on the five-room dungeon format.' }
  ];

  const header = document.querySelector('header');
  if ( !header ) return;

  // Infer current tool by matching path
  const currentId = window.location.pathname.toLowerCase().split('/').find(part => utilities.some(util => part.includes(util.id)));
  const currentTool = utilities.find(util => currentId && currentId.includes(util.id)) || utilities[0];
  const otherTools = utilities.filter(util => util !== currentTool);

  // Build full navbar list with current tool first
  const navItems = [currentTool, ...otherTools].map((util, index) => `<li class="${index === 0 ? 'current' : ''}"><a href="${util.url}"><img src="${util.icon}" alt="${util.title}">${util.title}</a></li>`).join('');
  header.innerHTML = `<nav><ul class="header-navbar">${navItems}</ul></nav>`;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'navbar-icon';
  iconDiv.innerHTML = '<img src="images/icon_master_256.png" alt="Icon">';
  header.appendChild(iconDiv);

  // Create and inject floating info div
  const infoDiv = document.createElement('div');
  infoDiv.id = 'navbar-info';
  infoDiv.className = 'navbar-info';
  infoDiv.style.display = 'none';
  document.body.appendChild(infoDiv);

  // Add hover behavior to each nav <li>
  document.querySelectorAll('header nav li').forEach((li, index) => {
    const util = [currentTool, ...otherTools][index];
    li.addEventListener('mouseenter', () => {
      infoDiv.innerHTML = `<div class="navbar-info-header"><img src="${util.icon}" alt="${util.title}"><span class="navbar-info-name">${util.title}</span><p>${util.subtitle}</p></div><div class="navbar-info-desc">${util.description || ''}</div>`;
      infoDiv.style.display = 'block';
      // Get li position on screen
      const rect = li.getBoundingClientRect();
      infoDiv.style.top = `${rect.bottom + window.scrollY + 8}px`;   // just below the <li>
      infoDiv.style.left = `${rect.left + window.scrollX}px`;     // aligned with <li>
    });
    li.addEventListener('mouseleave', () => { infoDiv.style.display = 'none'; });
  });
};

function toggleFullscreen( event ) {
  var element = document.body;

  if (event instanceof HTMLElement) { element = event; }
  var isFullscreen = document.webkitIsFullScreen || document.mozFullScreen || false;
  element.requestFullScreen = element.requestFullScreen || element.webkitRequestFullScreen || element.mozRequestFullScreen || function() {
    return false;
  };
  document.cancelFullScreen = document.cancelFullScreen || document.webkitCancelFullScreen || document.mozCancelFullScreen || function() {
    return false;
  };

  isFullscreen ? document.cancelFullScreen() : element.requestFullScreen();
};

function wledCommand( address, cmd ) {
  var r;
  $.post({
    url: address + "/json",
    contentType: "application/json",
    data: cmd,
    success: function(result) { r = result },
    error: function(xhr, error) { console.log(xhr) },
    async: false
  });
  return r
};

function wledGet( address ) {
  var r;
  $.ajaxSetup({ async: false });  
  $.get( address + "/json", function( result ) { r = result; });
  return r
};


window.addEventListener('load', () => {
  buildNavigation();

  document.querySelectorAll('.star-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      btn.innerHTML = btn.classList.contains('active') ? '★' : '☆';
    });
  });
});
