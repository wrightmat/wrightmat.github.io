const DEFAULT_NAV = [
  { href: 'index.html', label: 'Home', id: 'home' },
  { href: 'system-editor.html', label: 'System Editor', id: 'system' },
  { href: 'template-editor.html', label: 'Template Editor', id: 'template' },
  { href: 'character.html', label: 'Character', id: 'character' }
];

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

  const actions = document.createElement('div');
  actions.className = 'app-actions';
  actions.innerHTML = '<span class="small-text text-muted">Session</span>';
  header.appendChild(actions);

  const main = document.createElement('main');
  main.className = 'pane-grid';
  main.setAttribute('role', 'presentation');

  const leftPane = buildPane('left', panes.left || { title: 'Session Controls' });
  const centerPane = buildPane('center', panes.center || { title: 'Workspace' });
  const rightPane = buildPane('right', panes.right || { title: 'Tools' });

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
