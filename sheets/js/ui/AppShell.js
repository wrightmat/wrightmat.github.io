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
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(`theme-${next}`);
  document.body.dataset.theme = next;
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
    footer.className = 'status-footer';
    footer.dataset.visible = 'false';
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
    if(link.id && link.id === current){
      anchor.setAttribute('aria-current', 'page');
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
  const header = document.createElement('header');
  header.className = 'app-header';

  const headStack = document.createElement('div');
  headStack.className = 'stack-sm';
  if(subtitle){
    const sub = document.createElement('p');
    sub.className = 'pane-title';
    sub.textContent = subtitle;
    headStack.appendChild(sub);
  }
  const titleEl = document.createElement('h1');
  titleEl.className = 'app-title';
  titleEl.textContent = title || 'Universal Sheets';
  headStack.appendChild(titleEl);
  header.appendChild(headStack);

  const navEl = document.createElement('nav');
  navEl.className = 'app-nav';
  navEl.setAttribute('aria-label', 'Primary');
  renderNav(navEl, nav, current);
  header.appendChild(navEl);

  let currentTheme = theme;
  const updateLayout = ()=>{
    main.dataset.leftCollapsed = paneState.left ? 'true' : 'false';
    main.dataset.rightCollapsed = paneState.right ? 'true' : 'false';
  };

  const handleToggle = (position)=>{
    if(position === 'left'){
      paneState.left = !paneState.left;
      setPaneCollapsed(leftPane.wrap, paneState.left);
      updatePaneButton(leftToggle, paneState.left, 'Show left pane', 'Hide left pane');
    }else if(position === 'right'){
      paneState.right = !paneState.right;
      setPaneCollapsed(rightPane.wrap, paneState.right);
      updatePaneButton(rightToggle, paneState.right, 'Show right pane', 'Hide right pane');
    }
    updateLayout();
    savePaneState(paneState);
  };

  const switchTheme = ()=>{
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
    themeToggle.textContent = currentTheme === 'dark' ? 'Light mode' : 'Dark mode';
  };

  const actions = document.createElement('div');
  actions.className = 'app-actions';
  const leftToggle = createButton({
    label: paneState.left ? 'Show left pane' : 'Hide left pane',
    ariaLabel: 'Toggle left pane',
    extraClasses: ['pane-toggle'],
    onClick: ()=> handleToggle('left')
  });
  const rightToggle = createButton({
    label: paneState.right ? 'Show right pane' : 'Hide right pane',
    ariaLabel: 'Toggle right pane',
    extraClasses: ['pane-toggle'],
    onClick: ()=> handleToggle('right')
  });
  const themeToggle = createButton({
    label: currentTheme === 'dark' ? 'Light mode' : 'Dark mode',
    ariaLabel: 'Toggle color theme',
    extraClasses: ['theme-toggle'],
    onClick: switchTheme
  });
  actions.append(leftToggle, rightToggle, themeToggle);
  header.appendChild(actions);

  const main = document.createElement('main');
  main.className = 'pane-grid';
  main.setAttribute('role', 'presentation');

  const leftPane = buildPane('left', panes.left || { title: 'Session Controls' });
  const centerPane = buildPane('center', panes.center || { title: 'Workspace' });
  const rightPane = buildPane('right', panes.right || { title: 'Tools' });

  setPaneCollapsed(leftPane.wrap, paneState.left);
  setPaneCollapsed(rightPane.wrap, paneState.right);
  updatePaneButton(leftToggle, paneState.left, 'Show left pane', 'Hide left pane');
  updatePaneButton(rightToggle, paneState.right, 'Show right pane', 'Hide right pane');
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
    actions,
    panes: {
      left: leftPane.content,
      center: centerPane.content,
      right: rightPane.content
    },
    togglePane(position){
      handleToggle(position);
    },
    setStatus(message, variant = 'info'){
      if(!message){
        footer.dataset.visible = 'false';
        footer.innerHTML = '';
        return;
      }
      footer.dataset.visible = 'true';
      const chip = document.createElement('div');
      chip.className = 'status-chip';
      chip.dataset.variant = variant;
      chip.textContent = message;
      footer.innerHTML = '';
      footer.appendChild(chip);
    },
    clearStatus(){
      footer.dataset.visible = 'false';
      footer.innerHTML = '';
    },
    updateSubtitle(text){
      if(text){
        let sub = headStack.querySelector('.pane-title');
        if(!sub){
          sub = document.createElement('p');
          sub.className = 'pane-title';
          headStack.insertBefore(sub, titleEl);
        }
        sub.textContent = text;
      }else{
        const sub = headStack.querySelector('.pane-title');
        if(sub){
          sub.remove();
        }
      }
    },
    updateTitle(text){
      titleEl.textContent = text;
    }
  };
}

function buildPane(position, { title = '', description = '' } = {}){
  const wrap = document.createElement('section');
  wrap.className = 'pane';
  if(position){
    wrap.classList.add(`pane-${position}`);
  }
  if(title || description){
    const header = document.createElement('div');
    header.className = 'panel-section';
    if(title){
      const heading = document.createElement('div');
      heading.className = 'section-heading';
      heading.textContent = title;
      header.appendChild(heading);
    }
    if(description){
      const para = document.createElement('p');
      para.className = 'small-text';
      para.textContent = description;
      header.appendChild(para);
    }
    wrap.appendChild(header);
  }
  const content = document.createElement('div');
  content.className = 'scroll-pane stack-md';
  wrap.appendChild(content);
  return { wrap, content };
}

function setPaneCollapsed(node, collapsed){
  node.dataset.collapsed = collapsed ? 'true' : 'false';
}

function updatePaneButton(button, collapsed, showLabel, hideLabel){
  button.textContent = collapsed ? showLabel : hideLabel;
  button.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
}

