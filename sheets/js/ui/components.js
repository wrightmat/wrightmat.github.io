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
