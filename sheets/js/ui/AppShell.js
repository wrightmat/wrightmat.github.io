import { createButton } from './components.js';

const DEFAULT_NAV = [
  { href: 'index.html', label: 'Home', id: 'home' },
  { href: 'system-editor.html', label: 'System Editor', id: 'system' },
  { href: 'template-editor.html', label: 'Template Editor', id: 'template' },
  { href: 'character.html', label: 'Character', id: 'character' }
];

const THEME_KEY = 'sheets:theme';
const PANE_KEY = 'sheets:pane';

function detectTheme(){
  const stored = localStorage.getItem(THEME_KEY);
  if(stored === 'light' || stored === 'dark') return stored;
  if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches){
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme){
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', next === 'dark');
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
}

function loadPaneState(){
  try{
    const stored = JSON.parse(localStorage.getItem(PANE_KEY) || '{}');
    return { left: stored.left !== false, right: stored.right !== false };
  }catch(err){
    console.warn('Failed to parse pane state', err);
    return { left: true, right: true };
  }
}

function savePaneState(state){
  localStorage.setItem(PANE_KEY, JSON.stringify(state));
}

function ensureStatusFooter(){
  let footer = document.querySelector('.status-footer');
  if(!footer){
    footer = document.createElement('div');
    footer.className = 'status-footer pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-4 transition-all duration-200';
    footer.dataset.visible = 'false';
    footer.classList.add('opacity-0');
    document.body.appendChild(footer);
  }
  return footer;
}

function renderNav(container, links, current){
  container.innerHTML = '';
  links.forEach(link => {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.className = 'rounded-md px-2 py-1 text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white';
    if(link.id && link.id === current){
      anchor.setAttribute('aria-current', 'page');
      anchor.classList.add('bg-slate-200/60', 'text-slate-900', 'dark:bg-slate-700/60', 'dark:text-white');
    }
    container.appendChild(anchor);
  });
}

export function initAppShell({
  title,
  subtitle = '',
  nav = DEFAULT_NAV,
  current = '',
  panes = {}
} = {}){
  const root = document.getElementById('app');
  if(!root){
    throw new Error('AppShell requires an element with id="app".');
  }

  const theme = detectTheme();
  applyTheme(theme);
  const paneState = loadPaneState();
  const footer = ensureStatusFooter();

  root.innerHTML = '';
  root.className = 'app-root flex min-h-screen flex-col bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100';

  const header = document.createElement('header');
  header.className = 'flex w-full flex-wrap items-center justify-between gap-4 border-b border-slate-200/60 bg-white/80 px-4 py-2 text-sm backdrop-blur dark:border-slate-800/60 dark:bg-slate-900/80';

  const headGroup = document.createElement('div');
  headGroup.className = 'flex items-center gap-3';
  const titleEl = document.createElement('h1');
  titleEl.className = 'text-base font-semibold leading-tight';
  titleEl.textContent = title || 'Universal Sheets';
  headGroup.appendChild(titleEl);
  if(subtitle){
    const badge = document.createElement('span');
    badge.className = 'rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-300';
    badge.textContent = subtitle;
    headGroup.appendChild(badge);
  }
  header.appendChild(headGroup);

  const navEl = document.createElement('nav');
  navEl.className = 'flex flex-wrap items-center gap-2';
  navEl.setAttribute('aria-label', 'Primary');
  renderNav(navEl, nav, current);
  header.appendChild(navEl);

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap items-center gap-3';
  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'flex items-center gap-2';
  const pageGroup = document.createElement('div');
  pageGroup.className = 'flex items-center gap-2';
  actions.append(toggleGroup, pageGroup);
  header.appendChild(actions);

  let currentTheme = theme;
  const updateLayout = ()=>{
    main.dataset.leftCollapsed = paneState.left ? 'true' : 'false';
    main.dataset.rightCollapsed = paneState.right ? 'true' : 'false';
  };

  const setCollapsed = (position, collapsed)=>{
    if(position === 'left'){
      paneState.left = collapsed;
      setPaneCollapsed(leftPane.wrap, collapsed);
      updatePaneButton(leftToggle, collapsed, 'Open tools', 'Hide tools');
    }else if(position === 'right'){
      paneState.right = collapsed;
      setPaneCollapsed(rightPane.wrap, collapsed);
      updatePaneButton(rightToggle, collapsed, 'Open inspector', 'Hide inspector');
    }
    updateLayout();
    savePaneState(paneState);
  };

  const handleToggle = (position)=>{
    if(position === 'left'){
      setCollapsed('left', !paneState.left);
    }else if(position === 'right'){
      setCollapsed('right', !paneState.right);
    }
  };

  const switchTheme = ()=>{
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
    themeToggle.textContent = currentTheme === 'dark' ? 'Light mode' : 'Dark mode';
  };

  const leftToggle = createButton({
    label: paneState.left ? 'Open tools' : 'Hide tools',
    ariaLabel: 'Toggle tools pane',
    extraClasses: ['pane-toggle'],
    onClick: ()=> handleToggle('left')
  });
  const rightToggle = createButton({
    label: paneState.right ? 'Open inspector' : 'Hide inspector',
    ariaLabel: 'Toggle inspector pane',
    extraClasses: ['pane-toggle'],
    onClick: ()=> handleToggle('right')
  });
  const themeToggle = createButton({
    label: currentTheme === 'dark' ? 'Light mode' : 'Dark mode',
    ariaLabel: 'Toggle color theme',
    extraClasses: ['theme-toggle'],
    onClick: switchTheme
  });
  toggleGroup.append(leftToggle, rightToggle, themeToggle);

  const main = document.createElement('main');
  main.className = 'app-main flex-1';
  main.setAttribute('role', 'presentation');

  const leftPane = buildPane('left', panes.left || { title: 'Tools' });
  const centerPane = buildPane('center', panes.center || { title: 'Workspace' });
  const rightPane = buildPane('right', panes.right || { title: 'Inspector' });

  setPaneCollapsed(leftPane.wrap, paneState.left);
  setPaneCollapsed(rightPane.wrap, paneState.right);
  updatePaneButton(leftToggle, paneState.left, 'Open tools', 'Hide tools');
  updatePaneButton(rightToggle, paneState.right, 'Open inspector', 'Hide inspector');
  updateLayout();

  main.appendChild(leftPane.wrap);
  main.appendChild(centerPane.wrap);
  main.appendChild(rightPane.wrap);

  root.appendChild(header);
  root.appendChild(main);

  return {
    root,
    header,
    nav: navEl,
    actionBar: pageGroup,
    panes: {
      left: leftPane.content,
      center: centerPane.content,
      right: rightPane.content
    },
    togglePane(position){
      handleToggle(position);
    },
    showPane(position){
      setCollapsed(position, false);
    },
    hidePane(position){
      setCollapsed(position, true);
    },
    setStatus(message, variant = 'info'){
      if(!message){
        footer.dataset.visible = 'false';
        footer.classList.add('opacity-0');
        footer.innerHTML = '';
        return;
      }
      footer.dataset.visible = 'true';
      footer.classList.remove('opacity-0');
      const chip = document.createElement('div');
      chip.className = 'status-chip flex items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-lg backdrop-blur border-slate-200/70 bg-white/90 text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/90 dark:text-slate-100';
      if(variant === 'warning'){
        chip.classList.add('border-amber-400/70', 'text-amber-700', 'dark:text-amber-300');
      }else if(variant === 'danger'){
        chip.classList.add('border-rose-400/70', 'text-rose-600', 'dark:text-rose-300');
      }else if(variant === 'success'){
        chip.classList.add('border-emerald-400/70', 'text-emerald-600', 'dark:text-emerald-300');
      }
      chip.textContent = message;
      footer.innerHTML = '';
      footer.appendChild(chip);
    },
    clearStatus(){
      footer.dataset.visible = 'false';
      footer.classList.add('opacity-0');
      footer.innerHTML = '';
    },
    updateSubtitle(text){
      const badge = headGroup.querySelector('span');
      if(text){
        if(badge){
          badge.textContent = text;
        }else{
          const fresh = document.createElement('span');
          fresh.className = 'rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-300';
          fresh.textContent = text;
          headGroup.appendChild(fresh);
        }
      }else if(badge){
        badge.remove();
      }
    },
    updateTitle(text){
      titleEl.textContent = text;
    }
  };
}

function buildPane(position, { title = '', description = '' } = {}){
  const wrap = document.createElement('section');
  wrap.className = 'pane flex flex-col gap-4 rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm dark:border-slate-800/60 dark:bg-slate-900/80';
  if(position){
    wrap.classList.add(`pane-${position}`);
  }
  if(title || description){
    const header = document.createElement('div');
    header.className = 'panel-section flex flex-col gap-2';
    if(title){
      const heading = document.createElement('div');
      heading.className = 'section-heading text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
      heading.textContent = title;
      header.appendChild(heading);
    }
    if(description){
      const para = document.createElement('p');
      para.className = 'small-text text-xs text-slate-500 dark:text-slate-400';
      para.textContent = description;
      header.appendChild(para);
    }
    wrap.appendChild(header);
  }
  const content = document.createElement('div');
  content.className = 'scroll-pane stack-md flex-1 space-y-4 overflow-y-auto';
  wrap.appendChild(content);
  return { wrap, content };
}

function setPaneCollapsed(node, collapsed){
  node.dataset.collapsed = collapsed ? 'true' : 'false';
  node.classList.toggle('hidden', collapsed);
}

function updatePaneButton(button, collapsed, showLabel, hideLabel){
  button.textContent = collapsed ? showLabel : hideLabel;
  button.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
}

