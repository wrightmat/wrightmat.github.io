// ===== CORE UTILITIES =====
const Utils = {

  // Create unique identifiers for elements and filenames
  generateId( type = 'element' ) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    
    switch ( type ) {
        case 'element':
            return `elem_${timestamp}_${random}`;
        
        case 'uuid':
        case 'schema':
        case 'template': 
        case 'character':
            const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            return type === 'uuid' ? uuid : `${type}_${uuid}`;
        
        default:
            return `${type}_${timestamp}_${random}`;
    }
  },

  // Metadata functions (now handled by the database instead of the files)
  addMetadata( data, type = '' ) {
    return { ...data, id: data.id || this.generateId(type || 'uuid') };
  },
  updateMetadata( data ) { return data },
  
  // Export/Import JSON functions
  exportAsJson( data, filename ) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  
  importJsonFile( callback ) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
      const file = event.target.files[0];
      if ( file ) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            callback(data);
          } catch ( error ) {
            console.error('Error parsing JSON:', error);
            alert('Error parsing JSON file. Please check the file format.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  },
  
  // Template functions
  validateTemplate( template ) {
    const errors = [];
    if ( !template.title )  errors.push('Template must have a title');
    if ( !template.schema )  errors.push('Template must specify a schema');
    if ( !template.type )  errors.push('Template must have a type');
    if ( !template.elements || !Array.isArray(template.elements) )  errors.push('Template must have elements array');
    return { isValid: errors.length === 0, errors };
  },
  
  // Notification system
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
      transform: translateX(100%);
      transition: transform 0.3s ease;
    `;
    
    const colors = {
      info: '#3b82f6',
      success: '#059669',
      warning: '#d97706',
      error: '#dc2626'
    };
    
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  },
  
  // Local storage helpers
  storage: {
    get(key) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      } catch (error) {
        console.error('Error reading from localStorage:', error);
        return null;
      }
    },
    
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error('Error writing to localStorage:', error);
        return false;
      }
    },
    
    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        console.error('Error removing from localStorage:', error);
        return false;
      }
    }
  },
  
  // Getters and setters
  getNestedValue( obj, path ) {
    if ( !obj || !path ) return obj;
    const keys = path.split('.');
    let result = obj;
    for ( const key of keys ) {
        if (result === null || result === undefined) return undefined;
        result = result[key];
    }
    return result;
  },
  
  setNestedValue( obj, path, value ) {
    let pathParts;
    if ( typeof path === 'string' ) {
        if (path.includes('.')) {
            pathParts = path.split('.');
        } else if (path.includes('/properties/')) {
            pathParts = path.replace('#/properties/', '').split('/properties/');
        } else {
            pathParts = [path];
        }
    } else {
        pathParts = path;
    }
    
    let current = obj;
    for ( let i = 0; i < pathParts.length - 1; i++ ) {
        current = current[pathParts[i]] ??= {};
    }
    current[pathParts[pathParts.length - 1]] = value;
  },

  // Array functions
  addArrayItem(character, scope, newItemTemplate = null) {
    const items = Utils.getNestedValue(character.data, scope) || [];
    const defaultItem = newItemTemplate || { name: '', quantity: 1, weight: 0, description: '' };
    items.push(defaultItem);
    Utils.setNestedValue(character.data, scope, items);
    return items;
  },

  removeArrayItem(character, scope, index) {
    const items = Utils.getNestedValue(character.data, scope) || [];
    if (index >= 0 && index < items.length) {
      items.splice(index, 1);
      Utils.setNestedValue(character.data, scope, items);
      return true;
    }
    return false;
  },

  reorderArrayItems(character, scope, oldIndex, newIndex) {
    const items = Utils.getNestedValue(character.data, scope) || [];
    if (oldIndex >= 0 && oldIndex < items.length && newIndex >= 0 && newIndex < items.length) {
      const [movedItem] = items.splice(oldIndex, 1);
      items.splice(newIndex, 0, movedItem);
      Utils.setNestedValue(character.data, scope, items);
      return true;
    }
    return false;
  },

  initArraySortables(containerSelector = '.array-container[data-allow-reorder="true"]', callback) {
    document.querySelectorAll(containerSelector).forEach(container => {
      Sortable.create(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        handle: '.array-drag-handle',
        onUpdate: (evt) => {
          const scope = container.getAttribute('data-scope');
          if (callback) callback(scope, evt.oldIndex, evt.newIndex);
        }
      });
    });
  },
  
  // UI functions
  setPaneVisibility: function(containerId, side, visible, state) {
    const container = document.getElementById(containerId);
    const isLeft = side === 'left';
    const toggleId = isLeft ? 'toggle-left-pane' : 'toggle-right-pane';
    const toggle = document.getElementById(toggleId);
    
    // Update state
    state[isLeft ? 'leftCollapsed' : 'rightCollapsed'] = !visible;
    
    // Update container classes to adjust layout
    container.classList.toggle(`${side}-collapsed`, !visible);
    container.classList.toggle('both-collapsed', state.leftCollapsed && state.rightCollapsed);
    
    // Update toggle button icon
    const icon = toggle?.querySelector('.toggle-icon');
    if (icon) {
        if (isLeft) {
            icon.textContent = visible ? '◀' : '▶';
        } else {
            icon.textContent = visible ? '▶' : '◀';
        }
    }
  },

  togglePaneVisibility: function(containerId, side, state) {
    const isLeft = side === 'left';
    const currentlyVisible = !state[isLeft ? 'leftCollapsed' : 'rightCollapsed'];
    this.setPaneVisibility(containerId, side, !currentlyVisible, state);
    return !currentlyVisible; // Return new visibility state
  },

  isPaneVisible: function(side, state) {
    const isLeft = side === 'left';
    return !state[isLeft ? 'leftCollapsed' : 'rightCollapsed'];
  },
  
  populateSelect( selectId, items, options = {} ) {
    const { valueField = 'id', textField = 'title', emptyText = 'Select...', sortKey = null, extraOptions = [] } = options;
    const select = document.getElementById(selectId);
    if ( !select ) return;
    
    select.innerHTML = `<option value="">${emptyText}</option>`;
    extraOptions.forEach(option => {
        const optionEl = document.createElement('option');
        optionEl.value = option.value;
        optionEl.textContent = option.text;
        select.appendChild(optionEl);
    });
    
    const itemArray = Array.isArray(items) ? items : Object.values(items);
    const sortedItems = sortKey ? Utils.SelectSorting.sortObjectEntries(items, sortKey) : itemArray;
    
    sortedItems.forEach(item => {
        const option = document.createElement('option');
        option.value = Utils.getNestedValue(item, valueField);
        option.textContent = Utils.getNestedValue(item, textField);
        select.appendChild(option);
    });
  },

  switchTab( tabsElementId, tabIndex, stateObject = null ) {
    // Store the active tab state if state object provided
    if ( stateObject && stateObject.activeTabStates ) {
        stateObject.activeTabStates[tabsElementId] = tabIndex;
    }

    // Update active tab in UI only - no data changes needed
    const tabsContainer = document.querySelector(`[data-element-id="${tabsElementId}"]`);
    if ( !tabsContainer )  return;
    
    // Update tab headers
    tabsContainer.querySelectorAll('.tab-header').forEach((header, index) => {
        header.classList.toggle('active', index === tabIndex);
    });
    
    // Update tab contents
    tabsContainer.querySelectorAll('.tab-content').forEach((content, index) => {
        content.classList.toggle('active', index === tabIndex);
    });
  },


  // Find element functions
  findElement( elements, criteria, options = {} ) {
    const {
      findAll = false,        // Return all matches instead of first match
      includeParent = false,  // Return { element, parent, parentArray, index }
      maxDepth = Infinity,    // Maximum search depth
      currentDepth = 0        // Current recursion depth (internal)
    } = options;
    const results = [];

    if ( !elements || !Array.isArray(elements) || currentDepth >= maxDepth )  return findAll ? [] : null;

    for ( let i = 0; i < elements.length; i++ ) {
      const element = elements[i];
      let isMatch = true;

      // Check all criteria
      for ( const [key, value] of Object.entries(criteria) ) {
        if ( key === 'custom' ) {
          // Custom function check: criteria.custom = (element) => boolean
          isMatch = value(element);
        } else if ( key === 'hasProperty' ) {
          // Check if property exists: criteria.hasProperty = 'propertyName'
          isMatch = element.hasOwnProperty(value);
        } else if ( key === 'propertyContains' ) {
          // Check if property contains value: criteria.propertyContains = { prop: 'name', value: 'test' }
          const propValue = element[value.prop];
          isMatch = propValue && String(propValue).includes(value.value);
        } else {
          // Direct property match: criteria.id = 'some-id'
          isMatch = element[key] === value;
        }

        if ( !isMatch ) break;
      }

      if ( isMatch ) {
        const result = includeParent ? {
          element,
          parent: elements,
          parentArray: elements,
          index: i
        } : element;
        if ( findAll ) { results.push(result); } else { return result; }
      }

      // Recursively search nested elements
      if ( element.elements ) {
        let nestedElements = element.elements;
        // Handle different element structure types
        if ( element.type === 'Container' && Array.isArray(element.elements[0]) ) {
          // Container with column arrays
          for ( const column of element.elements ) {
            if ( Array.isArray(column) ) {
              const found = this.findElement(column, criteria, { ...options, currentDepth: currentDepth + 1 });
              if ( found ) {
                if ( findAll ) { results.push(...(Array.isArray(found) ? found : [found])) } else { return found; }
              }
            }
          }
        } else if ( Array.isArray(nestedElements) ) {
          // Standard nested elements array
          const found = this.findElement(nestedElements, criteria, { ...options, currentDepth: currentDepth + 1 });
          if ( found ) {
            if ( findAll ) { results.push(...(Array.isArray(found) ? found : [found])); } else { return found; }
          }
        }
      }
    }
    return findAll ? results : null;
  },

  findElementById( elements, id ) { return this.findElement(elements, { id }); },

  findElementByScope( elements, scope ) { return this.findElement(elements, { scope }); },

  findElementByType( elements, type, findAll = false ) { return this.findElement(elements, { type }, { findAll }); },

  findElementWithParent( elements, criteria ) { return this.findElement(elements, criteria, { includeParent: true }); },

  findAllElements( elements, criteria ) { return this.findElement(elements, criteria, { findAll: true }); },

  findElementParent( elements, targetId ) {
    const result = this.findElement(elements, { id: targetId }, { includeParent: true });
    return result ? result.parentArray : null;
  },

  findElementInTemplate( template, criteria, options = {} ) {
    if ( !template || !template.elements )  return null;
    return this.findElement(template.elements, criteria, options);
  },

  findElementDefinition( type, definitions ) {
    for (const category of Object.values(definitions)) {
      const found = category.find(item => item.type === type);
      if ( found )  return found;
    }
    return null;
  },


  // Miscellaneous / Helpers
  deepClone( obj ) {
    return JSON.parse(JSON.stringify(obj));
  },
  
  debounce( func, wait ) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
};


// ===== FORMULA ENGINE =====
Utils.FormulaEngine = {
  builtinFunctions: {
    // Math functions
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    sqrt: Math.sqrt,
    sum: (...args) => args.flat().reduce((a, b) => a + b, 0),
    avg: (...args) => {
      const values = args.flat();
      return values.reduce((a, b) => a + b, 0) / values.length;
    },
    count: (...args) => args.flat().length,
    
    // Logic functions
    if: (condition, trueValue, falseValue) => condition ? trueValue : falseValue,
    switch: (value, ...cases) => {
      for (let i = 0; i < cases.length - 1; i += 2) {
        if (value === cases[i]) return cases[i + 1];
      }
      return cases[cases.length - 1];
    },
    isNull: (value) => value === null || value === undefined,
    isEmpty: (value) => value === null || value === undefined || value === '',
    
    // String functions
    concat: (...args) => args.join(''),
    length: (str) => String(str).length,
    upper: (str) => String(str).toUpperCase(),
    lower: (str) => String(str).toLowerCase(),
    substring: (str, start, length) => String(str).substring(start, start + length),
    
    // Array functions - only keeping used ones
    arrayLength: (arr) => Array.isArray(arr) ? arr.length : 0,
    arraySum: (arr) => Array.isArray(arr) ? arr.reduce((a, b) => a + b, 0) : 0,
    arrayAvg: (arr) => Array.isArray(arr) && arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
    arrayMin: (arr) => Array.isArray(arr) && arr.length > 0 ? Math.min(...arr) : 0,
    arrayMax: (arr) => Array.isArray(arr) && arr.length > 0 ? Math.max(...arr) : 0,
    
    // Utility functions
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    lerp: (a, b, t) => a + (b - a) * t,
    random: () => Math.random(),
    randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
  },

  // Formula syntax checking
  isFormula( scope ) {
    if (!scope || typeof scope !== 'string') return false;
    const formulaIndicators = [
      /[+\-*/%]/,
      /[<>=!]/,
      /[&|!]/,
      /\?.*:/,
      /\w+\s*\(/,
      /@\w+.*@\w+/,
    ];
    return formulaIndicators.some(pattern => pattern.test(scope));
  },

  // Parse field references from formula
  parseFieldReferences( formula ) {
    if (!formula) return [];
    const matches = formula.match(/@[\w.]+/g) || [];
    return matches.map(match => match.substring(1));
  },

  // Evaluate a single formula with proper context
  evaluateFormula(formula, data, schema) {
    if (!formula || typeof formula !== 'string') return '';
    
    try {
        let processedFormula = formula;
        let hasBlankFields = false;
        
        const fieldReferences = this.parseFieldReferences(formula);
        
        for (const fieldPath of fieldReferences) {
            const value = Utils.getNestedValue(data, fieldPath);
            if (value === null || value === undefined || value === '') {
                hasBlankFields = true;
            }
            processedFormula = processedFormula.replace(new RegExp(`@${fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), value);
        }
        
        if (hasBlankFields) return '';

        const context = {
            Math: Math,
            floor: Math.floor,
            ceil: Math.ceil,
            round: Math.round,
            abs: Math.abs,
            min: Math.min,
            max: Math.max,
            pow: Math.pow,
            sqrt: Math.sqrt
        };
        const result = new Function(...Object.keys(context), `"use strict"; return ${processedFormula};`)(...Object.values(context));
        return result;
    } catch (error) {
        console.warn('Formula evaluation failed:', formula, error);
        return '';
    }
  },

  // Enhanced version of evaluateFormulas that supports template scope formulas
  evaluateAllFormulas(schema, data) {
    if (!schema || !data) return;

    const evaluateNode = (node, basePath) => {
      const pathArr = Array.isArray(basePath) ? basePath : [];

      if (!node?.properties) return;

      for (const [key, field] of Object.entries(node.properties)) {
        const path = [...pathArr, key];

        if (field['x-formula']) {
          try {
            const result = this.evaluateFormula(field['x-formula'], data, schema);
            let target = data;
            for (let i = 0; i < path.length - 1; i++) {
              target = target[path[i]] ??= {};
            }
            target[path.at(-1)] = result;
          } catch (e) {
            console.warn('Failed to evaluate schema formula for', key, e);
          }
        } else if (field.type === 'object') {
          evaluateNode(field, path);
        }
      }
    };

    evaluateNode(schema, []);
  }
};


Utils.FormulaInput = class {
    constructor() {
        this.activeInput = null;
        this.suggestions = null;
        this.selectedIndex = 0;
    }
    
    init( input, schemaId, onUpdate ) {
        // Add CSS if not already added
        this.addCSS();
        
        input.addEventListener('input', (e) => this.handleInput(e, schemaId));
        input.addEventListener('keydown', (e) => this.handleKeydown(e, onUpdate));
        input.addEventListener('blur', () => setTimeout(() => this.hideSuggestions(), 150));
        input.classList.add('formula-input');
        
        // Store input type for filtering and callbacks
        this.onUpdateCallback = onUpdate;
        this.schemaId = schemaId;
        this.elementId = input.dataset.elementId;
        this.propertyKey = input.dataset.property;
	this.inputType = this.detectInputType(input, this.propertyKey);
    }
    
    detectInputType( input, propertyKey ) {
        // Detect what type of input this is for filtering suggestions
        if (input.type === 'number') return 'number';
        
        // Check parent element properties or data attributes
        const elementType = input.closest('[data-element-type]')?.dataset.elementType;
        const controlType = input.closest('[data-control-type]')?.dataset.controlType;
        
        // Check for select-type controls
        if ( elementType === 'SelectGroup' || controlType === 'select' ) return 'select';

	// Check for optionsSource property
	if ( propertyKey === 'optionsSource' ) return 'enum';
        
        // Default to text (accepts most types)
        return 'text';
    }
    
    getTypeIcon( fieldType ) {
        const iconMap = {
            'string': '📝',
            'text': '📝', 
            'number': '#️⃣',
            'integer': '#️⃣',
            'boolean': '☑️',
            'array': '📋',
            'object': '📦',
            'date': '📅',
            'enum': '🎯',
            'function': '⚙️'
        };
        return iconMap[fieldType] || '📄';
    }
    
    isTypeCompatible(fieldType, inputType) {
        const compatibility = {
            'text': ['string', 'text', 'number', 'integer', 'boolean', 'date', 'enum'],
            'number': ['number', 'integer'],
            'select': ['string', 'text', 'enum', 'array'],
	    'enum': ['enum']
        };
        return compatibility[inputType]?.includes(fieldType) || false;
    }
    
    addCSS() {
        if (document.getElementById('formula-input-css')) return;
        
        const style = document.createElement('style');
        style.id = 'formula-input-css';
        style.textContent = `
            .formula-input { font-family: monospace; }
            .formula-valid { border-color: #10b981 !important; }
            .formula-invalid { border-color: #ef4444 !important; }
            .formula-suggestions {
                background: white;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                font-size: 12px;
                max-height: 180px;
                overflow: hidden;
            }
            .formula-suggestions .suggestion-item {
                padding: 6px 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                border-bottom: 1px solid #f3f4f6;
            }
            .formula-suggestions .suggestion-item:hover,
            .formula-suggestions .suggestion-item.active {
                background: #3b82f6;
                color: white;
            }
            .formula-suggestions .suggestion-item:last-child {
                border-bottom: none;
            }
            .suggestion-type { 
                font-size: 12px; 
                min-width: 16px; 
                flex-shrink: 0;
            }
            .suggestion-content {
                display: flex;
                flex-direction: column;
                gap: 1px;
                min-width: 0;
            }
            .suggestion-value { 
                color: inherit; 
                font-weight: 500;
                font-size: 12px;
            }
            .suggestion-label { 
                color: inherit; 
                opacity: 0.7;
                font-size: 10px;
                line-height: 1.2;
            }
        `;
        document.head.appendChild(style);
    }
    
    handleInput(e, schemaId) {
        const input = e.target;
        const value = input.value;
        const cursorPos = input.selectionStart;
        
        // Smart autocomplete: show after @ or after 2+ characters
        const shouldShowSuggestions = this.shouldShowAutocomplete(value, cursorPos);
        
        if (shouldShowSuggestions) {
            const { searchTerm, isAfterAt, replaceStart } = this.getSearchContext(value, cursorPos);
            this.showSuggestions(input, searchTerm, schemaId, replaceStart, isAfterAt);
        } else {
            this.hideSuggestions();
        }
        
        this.validateInput(input, schemaId);
    }
    
    shouldShowAutocomplete(value, cursorPos) {
        // Show autocomplete anytime there's any text being typed
        return cursorPos > 0;
    }
    
    getSearchContext(value, cursorPos) {
        const atIndex = this.findAtSymbol(value, cursorPos);
        
        if (atIndex !== -1) {
            // After @ symbol
            const searchTerm = value.substring(atIndex + 1, cursorPos);
            return { searchTerm, isAfterAt: true, replaceStart: atIndex };
        } else {
            // Regular word
            const wordStart = this.findWordStart(value, cursorPos);
            const searchTerm = value.substring(wordStart, cursorPos);
            return { searchTerm, isAfterAt: false, replaceStart: wordStart };
        }
    }
    
    findAtSymbol( text, cursorPos ) {
        for ( let i = cursorPos - 1; i >= 0; i-- ) {
            if ( text[i] === '@' ) {
                const afterAt = text.substring(i + 1, cursorPos);
                if (afterAt.match(/^[\w.]*$/)) return i;
            } else if (text[i].match(/[\s+\-*/()=<>!&|]/)) {
                break;
            }
        }
        return -1;
    }
    
    findWordStart( text, cursorPos ) {
        for ( let i = cursorPos - 1; i >= 0; i-- ) {
            if (text[i].match(/[\s+\-*/()=<>!&|@]/))  return i + 1;
        }
        return 0;
    }
    
    showSuggestions( input, searchTerm, schemaId, replaceStart, isAfterAt ) {
        this.activeInput = input;
        this.replaceStart = replaceStart;
        this.isAfterAt = isAfterAt;
        
        const availableFields = DataManager.generateFieldPaths(schemaId);
        const allSuggestions = [];
        
        if (isAfterAt) {
            // Only show compatible fields after @
            const fieldSuggestions = availableFields
                .filter(field => {
                    const matchesSearch = field.path.toLowerCase().includes(searchTerm.toLowerCase());
                    const isCompatible = this.isTypeCompatible(field.type, this.inputType);
                    return matchesSearch && isCompatible;
                })
                .slice(0, 10)
                .map(field => ({ 
                    value: field.path, 
                    display: `@${field.path}`,
                    label: field.label || field.path, 
                    type: field.type || 'string',
                    category: 'field' 
                }));
            allSuggestions.push(...fieldSuggestions);
        } else {
            // Show both @fields and functions for regular text
            const fieldSuggestions = availableFields
                .filter(field => {
                    const matchesSearch = field.path.toLowerCase().includes(searchTerm.toLowerCase());
                    const isCompatible = this.isTypeCompatible(field.type, this.inputType);
                    return matchesSearch && isCompatible;
                })
                .slice(0, 6)
                .map(field => ({ 
                    value: `@${field.path}`, 
                    display: `@${field.path}`,
                    label: field.label || field.path, 
                    type: field.type || 'string',
                    category: 'field' 
                }));
                
            const functionSuggestions = Object.keys(Utils.FormulaEngine.builtinFunctions)
                .filter(func => func.toLowerCase().includes(searchTerm.toLowerCase()))
                .slice(0, 4)
                .map(func => ({ 
                    value: `${func}()`, 
                    display: `${func}()`,
                    label: func, 
                    type: 'function',
                    category: 'function' 
                }));
            
            allSuggestions.push(...fieldSuggestions, ...functionSuggestions);
        }
        
        if (allSuggestions.length === 0) {
            this.hideSuggestions();
            return;
        }
        
        this.createSuggestionsDropdown(input, allSuggestions);
    }
    
    createSuggestionsDropdown(input, suggestions) {
        this.hideSuggestions();
        
        this.suggestions = document.createElement('div');
        this.suggestions.className = 'formula-suggestions';
        this.suggestions.innerHTML = suggestions.map((s, i) => 
            `<div class="suggestion-item ${i === 0 ? 'active' : ''}" data-value="${s.value}" data-index="${i}">
                <span class="suggestion-type">${s.category === 'function' ? this.getTypeIcon('function') : this.getTypeIcon(s.type)}</span>
                <div class="suggestion-content">
                    <div class="suggestion-value">${s.display}</div>
                    ${s.label && s.label !== s.display ? `<div class="suggestion-label">${s.label}</div>` : ''}
                </div>
            </div>`
        ).join('');
        
        // Add mouse event handlers
        this.suggestions.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.suggestion-item');
            if (item) {
                const index = parseInt(item.dataset.index);
                this.selectedIndex = index;
                this.updateSelection();
            }
        });
        
        this.suggestions.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const item = e.target.closest('.suggestion-item');
            if (item) {
                const index = parseInt(item.dataset.index);
                this.selectedIndex = index;
                this.selectSuggestion(this.onUpdateCallback);
            }
        });
        
        // Position dropdown
        const rect = input.getBoundingClientRect();
        Object.assign(this.suggestions.style, {
            position: 'absolute',
            top: rect.bottom + window.scrollY + 'px',
            left: rect.left + window.scrollX + 'px',
            width: rect.width + 'px',
            zIndex: '1000'
        });
        
        document.body.appendChild(this.suggestions);
        this.selectedIndex = 0;
    }
    
    handleKeydown(e, onUpdate) {
        if (!this.suggestions) return;
        
        const items = this.suggestions.querySelectorAll('.suggestion-item');
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
                this.updateSelection();
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.updateSelection();
                break;
                
            case 'Tab':
            case 'Enter':
                e.preventDefault();
                this.selectSuggestion(onUpdate);
                break;
                
            case 'Escape':
                this.hideSuggestions();
                break;
        }
    }
    
    updateSelection() {
        if (!this.suggestions) return;
        this.suggestions.querySelectorAll('.suggestion-item').forEach((item, i) => {
            item.classList.toggle('active', i === this.selectedIndex);
        });
    }
    
    selectSuggestion(onUpdate) {
        if (!this.suggestions || !this.activeInput) return;
        
        const selectedItem = this.suggestions.querySelector('.suggestion-item.active');
        if (!selectedItem) return;
        
        const value = selectedItem.dataset.value;
        const input = this.activeInput;
        const currentValue = input.value;
        const cursorPos = input.selectionStart;
        
        // Replace the current word/search term
        const beforeReplace = currentValue.substring(0, this.replaceStart + (this.isAfterAt ? 1 : 0));
        const afterCursor = currentValue.substring(cursorPos);
        const insertValue = this.isAfterAt ? value : value;
        const newValue = beforeReplace + insertValue + afterCursor;
        
        input.value = newValue;
        const newCursorPos = beforeReplace.length + insertValue.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
        
        this.hideSuggestions();
        if ( onUpdate )  onUpdate(newValue);
    }
    
    hideSuggestions() {
        if (this.suggestions) {
            this.suggestions.remove();
            this.suggestions = null;
        }
    }
    
    validateInput(input, schemaId) {
        const value = input.value.trim();
        if (!value) {
            input.classList.remove('formula-valid', 'formula-invalid');
            return;
        }
        
        let isValid = true;
        try {
            if (Utils.FormulaEngine.isFormula(value)) {
                const fields = Utils.FormulaEngine.parseFieldReferences(value);
                const availableFields = DataManager.generateFieldPaths(schemaId);
                isValid = fields.every(field => availableFields.some(af => af.path === field));
            }
        } catch (e) {
            isValid = false;
        }
        
        input.classList.toggle('formula-valid', isValid);
        input.classList.toggle('formula-invalid', !isValid);
    }
};


// ===== KEYBOARD SHORTCUTS =====
Utils.KeyboardShortcuts = class {
    constructor() {
        this.shortcuts = new Map();
        this.isListening = false;
    }

    register(key, callback, options = {}) {
        const {
            description = '',
            preventDefault = true,
            allowInInputs = false
        } = options;
        this.shortcuts.set(key, {
            key,
            callback,
            description,
            preventDefault,
            allowInInputs
        });
    }

    unregister(key) {
        this.shortcuts.delete(key.toLowerCase());
    }

    startListening() {
        if (this.isListening) return;
        
        this.isListening = true;
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    stopListening() {
        this.isListening = false;
        document.removeEventListener('keydown', this.handleKeyDown.bind(this));
    }

    handleKeyDown(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
            return;
        }

        const key = this.getKeyString(event);
        const shortcut = this.shortcuts.get(key);
        
        if (shortcut) {
            if (shortcut.preventDefault) {
                event.preventDefault();
                event.stopPropagation();
            }
            
            try {
                shortcut.action();
            } catch (error) {
                console.error('Error executing shortcut:', key, error);
            }
        }
    }

    getKeyString(event) {
        const parts = [];
        if (event.ctrlKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        
        let key = event.key.toLowerCase();
	if (key === ' ') key = 'space';
       
       parts.push(key);
       return parts.join('+');
   }

   getDisplayString(keyString) {
       const ctrlKey = navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl';
       return keyString
           .replace('ctrl+', `${ctrlKey}+`)
           .replace('shift+', 'Shift+')
           .replace('alt+', 'Alt+')
           .toUpperCase();
   }

   clear() {
       this.shortcuts.clear();
   }
};

Utils.addTooltip = function(elementId, description, shortcut, keyboardManager) {
   const element = document.getElementById(elementId);
   if (!element) return;
   
   let tooltip = description;
   
   if (shortcut && keyboardManager) {
       const displayShortcut = keyboardManager.getDisplayString(shortcut);
       tooltip = `${description} (${displayShortcut})`;
   }
   
   element.setAttribute('title', tooltip);
};

Utils.applyTooltips = function(keyboardManager, elementMappings) {
   elementMappings.forEach(mapping => {
       const { elementId, shortcutKey, description } = mapping;
       const shortcut = keyboardManager.getShortcut(shortcutKey);
       
       if (shortcut) {
           Utils.addTooltip(elementId, shortcut.description || description, shortcutKey, keyboardManager);
       } else if (description) {
           Utils.addTooltip(elementId, description, null, keyboardManager);
       }
   });
};

Utils.applyShortcuts = function(keyboardManager, shortcutMappings) {
   shortcutMappings.forEach(mapping => {
       const { shortcutKey, description, action, elementId } = mapping;
       
       if (shortcutKey && action) {
           keyboardManager.register(shortcutKey, action, { description });
       }
       
       if (elementId) {
           const element = document.getElementById(elementId);
           if (element && shortcutKey) {
               const displayShortcut = keyboardManager.getDisplayString(shortcutKey);
               const tooltip = `${description} (${displayShortcut})`;
               element.setAttribute('title', tooltip);
           } else if (element && description) {
               element.setAttribute('title', description);
           }
       }
   });
};

// Enhanced Action Registry System
Utils.ActionRegistry = class {
   static providers = new Map();
   static contextInfo = new Map();
   
   static registerProvider(context, provider, contextInfo = {}) {
       this.providers.set(context, provider);
       this.contextInfo.set(context, {
           name: contextInfo.name || context,
           description: contextInfo.description || `Actions for ${context}`,
           icon: contextInfo.icon || '⚙️',
           ...contextInfo
       });
   }
   
   static getAction(context, actionId) {
       const provider = this.providers.get(context);
       return provider ? provider.getAction(actionId) : null;
   }
   
   static getAvailableActions(context) {
       const provider = this.providers.get(context);
       return provider ? provider.getAvailableActions() : [];
   }
   
   static getAllContexts() {
       return Array.from(this.providers.keys()).map(context => ({
           id: context,
           ...this.contextInfo.get(context)
       }));
   }
};

// System-defined shortcuts with scope information
Utils.ShortcutRegistry = {
   system: {
       'save': {
           id: 'save',
           defaultKey: 'ctrl+s',
           description: 'Save current work',
           category: 'file',
           scope: ['global'],
           elementId: 'save-btn'
       },
       'undo': {
           id: 'undo',
           defaultKey: 'ctrl+z',
           description: 'Undo last action',
           category: 'edit',
           scope: ['global'],
           elementId: 'undo-btn'
       },
       'redo': {
           id: 'redo',
           defaultKey: 'ctrl+y',
           description: 'Redo last action',
           category: 'edit',
           scope: ['global'],
           elementId: 'redo-btn'
       },
       'import': {
           id: 'import',
           defaultKey: 'ctrl+i',
           description: 'Import file',
           category: 'file',
           scope: ['global'],
           elementId: null
       },
       'export': {
           id: 'export',
           defaultKey: 'ctrl+shift+e',
           description: 'Export file',
           category: 'file',
           scope: ['global'],
           elementId: null
       },
       'toggle-view': {
           id: 'toggle-view',
           defaultKey: 'ctrl+e',
           description: 'Toggle between view and edit mode',
           category: 'view',
           scope: ['character'],
           elementId: null
       },
       'preview': {
           id: 'preview',
           defaultKey: 'ctrl+p',
           description: 'Preview template',
           category: 'view',
           scope: ['template'],
           elementId: null
       }
   }
};



// ===== UNDO/REDO SYSTEM =====
Utils.UndoRedoManager = class {
    constructor(callback = null) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxSize = 50;
        this.callback = callback; // Function to call when state changes
    }

    saveState(state, description = 'Change') {
        this.undoStack.push({ state: Utils.deepClone(state), description, timestamp: Date.now() });
        this.redoStack = []; // Clear redo stack when new action is performed
        if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    }

    undo() {
        if ( !this.canUndo() ) return null;
        const current = this.undoStack.pop();
        this.redoStack.push(current);
        const previous = this.undoStack[this.undoStack.length - 1];
        const state = previous ? previous.state : null;
        if (this.callback && state) this.callback(state, 'undo');
        return state;
    }

    redo() {
        if ( !this.canRedo() ) return null;
        const next = this.redoStack.pop();
        this.undoStack.push(next);
        if (this.callback && next.state) this.callback(next.state, 'redo');
        return next.state;
    }

    // Simple undo/redo that just shows notifications
    performUndo() {
        if ( !this.canUndo() ) {
            Utils.showNotification('Nothing to undo', 'info');
            return false;
        }
        return this.undo() !== null;
    }

    performRedo() {
        if ( !this.canRedo() ) {
            Utils.showNotification('Nothing to redo', 'info');
            return false;
        }
        return this.redo() !== null;
    }

    canUndo() { return this.undoStack.length > 1; }
    canRedo() { return this.redoStack.length > 0; }
};



// ===== UI AND CONTROLS =====
Utils.SelectSorting = {
    methods: {
        alphabetical: (a, b) => a.label.localeCompare(b.label),
        reverseAlphabetical: (a, b) => b.label.localeCompare(a.label),
        created: (a, b) => new Date(a.created || 0) - new Date(b.created || 0),
        modified: (a, b) => new Date(b.modified || 0) - new Date(a.modified || 0),
        custom: (a, b) => (a.order || 0) - (b.order || 0),
        none: () => 0 // Keep original order
    },
    defaults: {
        schemas: 'alphabetical',
        templates: 'alphabetical', 
        characters: 'modified',
        general: 'alphabetical'
    },
    userPreferences: {},

    // Main sorting function
    sortSelectOptions( items, type = 'general' ) {
        if ( !items || !Array.isArray(items) ) return items;
        const preference = this.userPreferences[type] || this.defaults[type] || 'alphabetical';
        const sortMethod = this.methods[preference];
        if ( !sortMethod ) {
            console.warn(`Unknown sort method: ${preference}, using alphabetical`);
            return items.sort(this.methods.alphabetical);
        }
        return [...items].sort(sortMethod);
    },

    // Convert object entries to sortable format
    prepareObjectForSorting(obj) {
        return Object.entries(obj).map(([id, item]) => ({
            id,
            label: item.title || item.name || item.label || id,
            created: item.created,
            modified: item.modified,
            order: item.order,
            ...item
        }));
    },

    // Sort and convert back to options format
    sortObjectEntries( obj, type = 'general' ) {
        const prepared = this.prepareObjectForSorting(obj);
        const sorted = this.sortSelectOptions(prepared, type);
        return sorted;
    },

    setPreference( type, method ) {
        this.userPreferences[type] = method;
        this.savePreferences();
    },

    savePreferences() {
        try {
            localStorage.setItem('ttrpg_select_sorting', JSON.stringify(this.userPreferences));
        } catch (error) {
            console.warn('Failed to save sorting preferences:', error);
        }
    },

    loadPreferences() {
        try {
            const stored = localStorage.getItem('ttrpg_select_sorting');
            if (stored) {
                this.userPreferences = JSON.parse(stored);
            }
        } catch (error) {
            console.warn('Failed to load sorting preferences:', error);
            this.userPreferences = {};
        }
    },

    init() { this.loadPreferences(); }
};