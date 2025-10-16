export function createButton({
  label = '',
  variant = 'default',
  size = 'md',
  title = '',
  ariaLabel = '',
  id,
  icon,
  type = 'button',
  onClick,
  extraClasses = [],
  attributes = {}
} = {}){
  const btn = document.createElement('button');
  btn.type = type;
  const classList = ['btn'];
  if(variant && variant !== 'default') classList.push(variant);
  if(size === 'small' || size === 'sm') classList.push('small');
  if(size === 'large' || size === 'lg') classList.push('large');
  if(Array.isArray(extraClasses) && extraClasses.length){
    extraClasses.forEach(cls => { if(cls) classList.push(cls); });
  }
  btn.className = classList.join(' ');

  if(label){
    btn.textContent = label;
  }
  if(icon){
    btn.innerHTML = '';
    if(typeof icon === 'string'){
      btn.insertAdjacentHTML('beforeend', icon);
    }else if(icon instanceof HTMLElement){
      btn.appendChild(icon);
    }
    if(label){
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
    }
  }
  if(ariaLabel){
    btn.setAttribute('aria-label', ariaLabel);
  }
  if(title){
    btn.title = title;
  }
  if(id){
    btn.id = id;
  }
  if(typeof onClick === 'function'){
    btn.addEventListener('click', onClick);
  }
  if(attributes && typeof attributes === 'object'){
    Object.entries(attributes).forEach(([key, value]) => {
      if(value === undefined || value === null) return;
      btn.setAttribute(key, value);
    });
  }
  return btn;
}

export function populateSelect(select, entries = [], { selected, placeholder, fallback } = {}){
  if(!(select instanceof HTMLSelectElement)) return '';
  const seen = new Set();
  const currentValue = select.value ?? '';
  select.innerHTML = '';
  if(placeholder){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  entries.forEach(entry => {
    if(!entry || !entry.id || seen.has(entry.id)) return;
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.label || entry.id;
    if(entry.source) opt.dataset.source = entry.source;
    select.appendChild(opt);
    seen.add(entry.id);
  });
  if(fallback && fallback.id && !seen.has(fallback.id)){
    const opt = document.createElement('option');
    opt.value = fallback.id;
    opt.textContent = fallback.label || fallback.id;
    opt.dataset.fallback = 'true';
    select.appendChild(opt);
    seen.add(fallback.id);
  }
  const candidates = [];
  if(selected) candidates.push(selected);
  if(currentValue) candidates.push(currentValue);
  if(fallback?.id) candidates.push(fallback.id);
  let choice = candidates.find(value => value && seen.has(value));
  if(!choice && entries.length){
    const first = entries.find(entry => entry && seen.has(entry.id));
    if(first) choice = first.id;
  }
  if(choice){
    select.value = choice;
    return choice;
  }
  select.value = '';
  return '';
}
