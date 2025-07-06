// Shared Utility Functions for TTRPG Character Sheet System

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
            // Fallback to element behavior
            return `${type}_${timestamp}_${random}`;
    }
  },

  getCurrentTimestamp() {
    return new Date().toISOString();
  },

  addMetadata(data, type = '') {
    const now = this.getCurrentTimestamp();
    let index = data.index;
    if (!index) {
        if (type === 'template' && data.title) {
            // Generate index from title for templates
            index = data.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        } else if (type === 'character' && data.data?.name) {
            // Generate index from character name
            index = data.data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        } else if (data.title) {
            // Fallback to title-based index
            index = data.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        }
    }
    
    return {
        id: data.id || this.generateId(type || 'uuid'),
        index: index,
        created: data.created || now,
        modified: now,
        version: (data.version || 0) + 1,
        ...data
    };
  },

  updateMetadata( data ) {
    return {
        ...data,
        modified: this.getCurrentTimestamp(),
        version: (data.version || 0) + 1
    };
  },

// Formula Engine - Enhanced formula parsing and evaluation
FormulaEngine: {
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
    
    // Aggregate functions
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
      return cases[cases.length - 1]; // default case
    },
    isNull: (value) => value === null || value === undefined,
    isEmpty: (value) => value === null || value === undefined || value === '',
    
    // String functions
    concat: (...args) => args.join(''),
    length: (str) => String(str).length,
    upper: (str) => String(str).toUpperCase(),
    lower: (str) => String(str).toLowerCase(),
    substring: (str, start, length) => String(str).substring(start, start + length),
    
    // Array functions
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

  // Check if a scope string contains formula syntax
  isFormula(scope) {
    if (!scope || typeof scope !== 'string') return false;
    
    // Look for operators, functions, conditionals, or multiple field references
    const formulaIndicators = [
      /[+\-*/%]/, // Math operators
      /[<>=!]/, // Comparison operators
      /[&|!]/, // Logic operators
      /\?.*:/, // Ternary operator
      /\w+\s*\(/, // Function calls
      /@\w+.*@\w+/, // Multiple field references
    ];
    
    return formulaIndicators.some(pattern => pattern.test(scope));
  },

  // Parse field references from formula
  parseFieldReferences(formula) {
    if (!formula) return [];
    const matches = formula.match(/@[\w.]+/g) || [];
    return matches.map(match => match.substring(1)); // Remove @ prefix
  },

  // Resolve field path to actual value
  resolveFieldPath(path, data) {
    if (!path || !data) return null;
    
    // Convert dot notation to nested access
    const pathParts = path.split('.');
    let current = data;
    
    for (const part of pathParts) {
      if (current === null || current === undefined) return null;
      current = current[part];
    }
    
    return current;
  },

  // Evaluate a formula with given data and schema
// Evaluate a formula with given data and schema
evaluateFormula(formula, data, schema) {
    if (!this.isFormula(formula)) {
        // Simple field reference
        if (formula.startsWith('@')) {
            return this.resolveFieldPath(formula.substring(1), data);
        }
        return formula;
    }

    try {
        // Replace @field.path references with actual values FIRST
        let processedFormula = formula;
        const fieldRefs = this.parseFieldReferences(formula);
        
        // Check if any referenced fields are blank/undefined
        let hasBlankFields = false;
        
        for (const fieldPath of fieldRefs) {
            const value = this.resolveFieldPath(fieldPath, data);
            const placeholder = `@${fieldPath}`;
            
            // If any referenced field is null, undefined, or empty string, return blank
            if (value === null || value === undefined || value === '') {
                hasBlankFields = true;
                break;
            }
            
            // Use a more robust replacement that handles dots in field paths
            processedFormula = processedFormula.replace(new RegExp(`@${fieldPath.replace(/\./g, '\\.')}`, 'g'), value);
        }
        
        // If any referenced field is blank, return blank instead of evaluating
        if (hasBlankFields)  return '';

        // Create minimal evaluation context - no functions that might conflict
        const context = {
            Math: Math,
            // Only include safe built-in functions
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
        console.warn('Processed formula was:', processedFormula);
        return '';  // Return blank instead of null on error
    }
},

  // Enhanced version of evaluateFormulas that supports template scope formulas
  evaluateAllFormulas(schema, data) {
    if (!schema || !data) return;

    // Evaluate schema-defined formulas (existing behavior)
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
},
  
  // Get nested value from object using path
  getNestedValue(obj, path) {
    if (typeof path === 'string') {
      path = path.replace('#/properties/', '').split('/properties/');
    }
    return path.reduce((current, key) => current?.[key], obj) ?? '';
  },
  
  // Set nested value in object using path
setNestedValue(obj, path, value) {
    let pathParts;
    if (typeof path === 'string') {
        if (path.includes('.')) {
            // Dot notation: abilities.strength
            pathParts = path.split('.');
        } else if (path.includes('/properties/')) {
            // Legacy format - convert to dot notation
            pathParts = path.replace('#/properties/', '').split('/properties/');
        } else {
            // Single property
            pathParts = [path];
        }
    } else {
        pathParts = path;
    }
    
    let current = obj;
    for (let i = 0; i < pathParts.length - 1; i++) {
        current = current[pathParts[i]] ??= {};
    }
    current[pathParts[pathParts.length - 1]] = value;
},
  
  // Check if field is read-only based on schema
  isReadOnly(schema, path) {
    if (typeof path === 'string') {
      path = path.replace('#/properties/', '').split('/properties/');
    }
    
    const schemaField = path.reduce((obj, key) => obj?.properties?.[key], schema);
    return schemaField?.readOnly === true;
  },
  
  // Format value with modifiers (for D&D ability modifiers)
  formatModifier(value) {
    if (typeof value === 'number') {
      return value >= 0 ? `+${value}` : `${value}`;
    }
    return value;
  },
  
  // Deep clone object
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },
  
  // Debounce function for performance
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },
  
  // Export data as JSON file
  exportAsJson(data, filename) {
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
  
  // Import JSON file
  importJsonFile(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            callback(data);
          } catch (error) {
            console.error('Error parsing JSON:', error);
            alert('Error parsing JSON file. Please check the file format.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  },
  
  // Validate template structure
  validateTemplate(template) {
    const errors = [];
    
    if (!template.title) {
      errors.push('Template must have a title');
    }
    
    if (!template.schema) {
      errors.push('Template must specify a schema');
    }
    
    if (!template.type) {
      errors.push('Template must have a type');
    }
    
    if (!template.elements || !Array.isArray(template.elements)) {
      errors.push('Template must have elements array');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  },
  
// Find element by ID in nested structure
findElementById(elements, id) {
    if (!elements || !Array.isArray(elements)) {
        return null;
    }
    
    for (let element of elements) {
        if (element.id === id) {
            return element;
        }
        
        if (element.elements) {
            if (element.type === 'Group') {
                // Groups have a simple array of elements
                const found = Utils.findElementById(element.elements, id); // Use Utils.findElementById
                if (found) return found;
            } else if (element.type === 'Container') {
                // Containers have an array of arrays (columns)
                for (let column of element.elements) {
                    if (Array.isArray(column)) {
                        const found = Utils.findElementById(column, id); // Use Utils.findElementById
                        if (found) return found;
                    }
                }
            } else if (Array.isArray(element.elements)) {
                // Fallback for other types with elements
                const found = Utils.findElementById(element.elements, id); // Use Utils.findElementById
                if (found) return found;
            }
        }
    }
    return null;
},

removeElementById( elements, id ) {
    if (!elements || !Array.isArray(elements)) {
        return false;
    }
    
    for ( let i = 0; i < elements.length; i++ ) {
        if ( elements[i].id === id ) {
            elements.splice(i, 1);
            return true;
        }
        if ( elements[i].elements ) {
            if (elements[i].type === 'Group') {
                // Groups have a simple array of elements
                if ( Utils.removeElementById(elements[i].elements, id )) return true; // Use Utils.removeElementById
            } else if (elements[i].type === 'Container') {
                // Containers have an array of arrays (columns)
                for ( let j = 0; j < elements[i].elements.length; j++ ) {
                    if ( Array.isArray(elements[i].elements[j]) ) {
                        if ( Utils.removeElementById(elements[i].elements[j], id )) return true; // Use Utils.removeElementById
                    }
                }
            } else if ( Array.isArray(elements[i].elements) ) {
                // Fallback for other types with elements
                if ( Utils.removeElementById(elements[i].elements, id )) return true; // Use Utils.removeElementById
            }
        }
    }
    return false;
},
  
// Find parent container of element
findElementParent(elements, targetId, parent = null) {
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.id === targetId) {
            return parent || this.currentTemplate.elements;
        }
        if (element.elements) {
            const found = this.findElementParent(element.elements, targetId, element.elements);
            if (found) return found;
        }
    }
    return null;
},
  
  // Generate field name from path
  generateFieldName( path ) {
    const fieldName = path.split('/').pop().replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    return fieldName;
  },
  
  // Create notification system
  showNotification( message, type = 'info' ) {
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
    
    // Set background color based on type
    const colors = {
      info: '#3b82f6',
      success: '#059669',
      warning: '#d97706',
      error: '#dc2626'
    };
    
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after delay
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


  // ElementRenderer - used for both character sheet and template editor
  ElementRenderer: {
    renderElement(element, context = {}) {
        const { 
            isPreview = false, 
            viewMode = false, 
            getValue = () => '', 
            updateValue = () => {}, 
            selectedElementId = null,
            instanceRef = null
        } = context;
        
        const isSelected = selectedElementId === element.id;
        const elementId = element.id || 'unknown';
        
        // Common element wrapper for preview mode
        if (isPreview) {
            const selectedClass = isSelected ? 'selected' : '';
            const previewControls = `
                <div class="element-controls">
                    <button class="control-btn tooltip" data-tooltip="Duplicate" onclick="event.stopPropagation(); window.editorInstance.duplicateElement('${elementId}')">📋</button>
                    <button class="control-btn delete tooltip" data-tooltip="Delete" onclick="event.stopPropagation(); window.editorInstance.deleteElement('${elementId}')">×</button>
                </div>`;
            const clickHandler = `draggable="true" ondragstart="window.editorInstance.startCanvasDrag('${elementId}', event)" onclick="event.stopPropagation(); window.editorInstance.selectElement('${elementId}')"`;
            
            const content = this.renderElementContent(element, context);
            return `<div class="form-element canvas-element ${selectedClass}" ${clickHandler}>
                ${previewControls}
                ${content}
            </div>`;
        }
        // Regular character sheet rendering
        return this.renderElementContent(element, context);
    },
    
    applyElementStyles(element, targetType = 'container') {
        let styles = [];
    
        // For container-level styles (Groups, Labels, etc.)
        if (targetType === 'container') {
            if (element.backgroundColor) styles.push(`background-color: ${element.backgroundColor}`);
            if (element.borderColor) styles.push(`border-color: ${element.borderColor}`);
            if (element.textColor) styles.push(`color: ${element.textColor}`);
        }
        // For individual element styles (pills, segments, etc.) - handled by specialized functions
        else if (targetType === 'element') {
            return '';
        }
        return styles.length > 0 ? `style="${styles.join('; ')}"` : '';
    },
    
    generateColorVariations(color) {
        if (!color || color === '#ffffff') return '';
        
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        const darkR = Math.round(r * 0.8);
        const darkG = Math.round(g * 0.8);
        const darkB = Math.round(b * 0.8);
        const darkColor = `rgb(${darkR}, ${darkG}, ${darkB})`;
        
        const lightR = Math.round(r + (255 - r) * 0.9);
        const lightG = Math.round(g + (255 - g) * 0.9);
        const lightB = Math.round(b + (255 - b) * 0.9);
        const lightColor = `rgb(${lightR}, ${lightG}, ${lightB})`;
        
        return `style="--element-color: ${color}; --element-color-dark: ${darkColor}; --element-color-light: ${lightColor};"`;
    },

    generateFieldName(path) {
        if (!path) return 'Field';
        const fieldName = path.split('/').pop().replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        return fieldName;
    },
    
    getElementColors(element, state = 'default') {
        const bgColor = element.backgroundColor;
        const borderColor = element.borderColor;
        const textColor = element.textColor;
        let styles = [];
    
        switch (state) {
            case 'filled':
            case 'selected':
                if (bgColor) {
                    styles.push(`background-color: ${bgColor}`);
                    styles.push(`border-color: ${borderColor || bgColor}`);
                } else {
                    styles.push(`background-color: #3b82f6`);
                    styles.push(`border-color: ${borderColor || '#2563eb'}`);
                }
                if (textColor) styles.push(`color: ${textColor}`);
                break;
            case 'empty':
            case 'unselected':
                styles.push(`background-color: white`);
                styles.push(`border-color: ${borderColor || '#d1d5db'}`);
                if (textColor) styles.push(`color: ${textColor}`);
                break;
            default:
                if (bgColor) styles.push(`background-color: ${bgColor}`);
                if (borderColor) styles.push(`border-color: ${borderColor}`);
                if (textColor) styles.push(`color: ${textColor}`);
        }
        return styles.length > 0 ? styles.join('; ') : '';
    },

    getSegmentColors(element, filled = false) {
        return this.getElementColors(element, filled ? 'filled' : 'empty');
    },
    
    renderElementContent(element, context) {
        const { isPreview = false } = context;
        
        switch (element.type) {
            case 'Control': return this.renderControl(element, context);
            case 'Container': return this.renderContainer(element, context);
            case 'Group': return this.renderGroup(element, context);
            case 'Array': return this.renderArray(element, context);
            case 'LinearTrack': return this.renderLinearTrack(element, context);
            case 'CircularTrack': return this.renderCircularTrack(element, context);
            case 'ComboField': return this.renderComboField(element, context);
            case 'MultiStateToggle': return this.renderMultiStateToggle(element, context);
            case 'SelectGroup': return this.renderSelectGroup(element, context);
            case 'Label': return this.renderLabel(element, context);
            case 'Divider': return this.renderDivider(element, context);
            case 'Image': return this.renderImage(element, context);
            default: return '';
        }
    },

renderControl(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const value = getValue(element.scope) || '';
    const controlType = element.controlType || 'text';
    const elementStyles = this.applyElementStyles(element);
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        let inputElement = '';
        
        let inputStyles = [];
        if (element.textColor) inputStyles.push(`color: ${element.textColor} !important`);
        if (element.backgroundColor) inputStyles.push(`background-color: ${element.backgroundColor}`);
        if (element.borderColor) inputStyles.push(`border-color: ${element.borderColor}`);
        const inputStyleAttr = inputStyles.length > 0 ? `style="${inputStyles.join('; ')}"` : '';
        
        switch (controlType) {
            case 'textarea': 
                const isRichText = element.richText === true;
                inputElement = isRichText ? 
                    `<div class="preview-rich-editor" ${inputStyleAttr}>
                        <div class="preview-rich-toolbar">📝 B I U | • 1. [] 🔗</div>
                        <div class="preview-rich-content">Rich text editor content...</div>
                    </div>` : 
                    `<textarea class="preview-textarea" readonly ${inputStyleAttr}>Sample textarea content</textarea>`; 
                break;
            case 'select': 
                inputElement = `<select class="preview-select" disabled ${inputStyleAttr}><option>Sample Option</option></select>`; 
                break;
            case 'checkbox': 
                inputElement = `<label class="preview-checkbox" ${inputStyleAttr}><input type="checkbox" disabled> ${fieldName}</label>`; 
                break;
            case 'date':
                inputElement = `<input type="date" class="preview-input" readonly value="2024-01-01" ${inputStyleAttr}>`;
                break;
            case 'number':
                inputElement = `<input type="number" class="preview-input" readonly value="999" ${inputStyleAttr}>`;
                break;
            default:
                inputElement = `<input type="text" class="preview-input" readonly value="Sample text input" ${inputStyleAttr}>`;
        }
        
	return `<div class="field-group" ${elementStyles}>
	    ${controlType !== 'checkbox' && controlType !== 'combo' && fieldName ? `<label class="field-label">${fieldName}</label>` : ''}
	    ${controlType === 'combo' && fieldName ? `<div class="preview-combo-label">${fieldName}</div>` : ''}
	    ${inputElement}
	</div>`;
    }
    
    const isReadOnly = instanceRef ? instanceRef.isReadOnly(element.scope) : false;
    const isNumber = controlType === 'number' || typeof value === 'number';
    let inputElement = '';
    
    let inputStyles = [];
    if (element.textColor) inputStyles.push(`color: ${element.textColor}`);
    if (element.backgroundColor) inputStyles.push(`background-color: ${element.backgroundColor}`);
    if (element.borderColor) inputStyles.push(`border-color: ${element.borderColor}`);
    const inputStyleAttr = inputStyles.length > 0 ? `style="${inputStyles.join('; ')}"` : '';
    
    // Common focus handler for saving state before editing
    const focusHandler = viewMode || isReadOnly ? '' : `onfocus="window.characterAppInstance.handleInputFocus('${element.scope}')"`;
    
    switch (controlType) {
        case 'textarea':
            const isRichText = element.richText === true;
            const textareaId = `textarea_${element.id || Math.random().toString(36).substr(2, 9)}`;
            if (isRichText && instanceRef) {
                inputElement = `<div id="${textareaId}" class="rich-text-editor" data-scope="${element.scope}" data-readonly="${isReadOnly || viewMode}" ${inputStyleAttr}></div>`;
                setTimeout(() => {
                    instanceRef.initRichTextEditor(textareaId, element.scope, isReadOnly || viewMode);
                }, 100);
            } else {
                inputElement = `<textarea name="${element.scope}" ${isReadOnly || viewMode ? 'readonly' : ''} ${focusHandler} onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" class="form-control textarea-control" ${inputStyleAttr}>${instanceRef ? instanceRef.formatValue(element.scope, value) : value}</textarea>`;
            }
            break;
        case 'select': 
            inputElement = `<select name="${element.scope}" ${isReadOnly || viewMode ? 'disabled' : ''} ${focusHandler} onchange="window.characterAppInstance.updateValue(event, '${element.scope}')" class="form-control" ${inputStyleAttr}><option value="${value}">${value || 'Select an option...'}</option></select>`; 
            break;
        case 'checkbox': 
            const checked = value === true || value === 'true' || value === 1; 
            inputElement = `<label class="checkbox-label" ${inputStyleAttr}><input type="checkbox" name="${element.scope}" ${checked ? 'checked' : ''} ${isReadOnly || viewMode ? 'disabled' : ''} ${focusHandler} onchange="window.characterAppInstance.updateCheckbox(event, '${element.scope}')" class="checkbox-input"><span>${fieldName}</span></label>`; 
            break;
        case 'date':
            inputElement = `<input type="date" name="${element.scope}" value="${value || ''}" ${isReadOnly || viewMode ? 'readonly' : ''} ${focusHandler} onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" ${!viewMode ? 'onchange="window.characterAppInstance.updateValue(event, \'' + element.scope + '\')"' : ''} class="form-control" ${inputStyleAttr}>`;
            break;
        default:
	    inputElement = `<input type="${controlType}" name="${element.scope}" value="${instanceRef ? instanceRef.formatValue(element.scope, value) : value}" ${isReadOnly || viewMode ? 'readonly' : ''} ${viewMode && isNumber && !isReadOnly ? 'onclick="window.characterAppInstance.handleNumberClick(event, \'' + element.scope + '\')"' : ''} ${focusHandler} onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" ${isNumber && !viewMode ? 'onchange="window.characterAppInstance.updateValue(event, \'' + element.scope + '\')"' : ''} class="form-control" ${inputStyleAttr}>`;
    }
    
    return `<div class="field-group" ${elementStyles}>
        ${controlType !== 'checkbox' && controlType !== 'combo' ? `<label class="field-label">${fieldName}</label>` : ''}
        ${controlType === 'combo' ? `<div class="preview-combo-label">${fieldName}</div>` : ''}
        ${inputElement}
    </div>`;
},

renderGroup(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const layout = element.layout || 'vertical';
    const style = element.style || 'plain';
    const isCollapsible = element.collapsible === true;
    const defaultCollapsed = element.defaultCollapsed === 'collapsed';
    const groupId = `group_${element.id || Math.random().toString(36).substr(2, 9)}`;
    const elementStyles = this.applyElementStyles(element);
    const gap = element.gap || 'medium';
    
    // Show labels for all layouts except combo layouts (which are meant to be inline)
    const showLabel = element.label && !['combo-row', 'combo-compact'].includes(layout);
    
    if (isPreview) {
        // Handle columns layout (like old Container)
        if (layout === 'columns') {
            const columns = element.columns || 2;
            let columnsHtml = '';
            
            // Create the specified number of columns
            for (let i = 0; i < columns; i++) {
                // Safely get column elements
                const columnArray = (element.elements && Array.isArray(element.elements[i])) ? 
                    element.elements[i] : [];
                const columnElements = columnArray.map((el, j) => {
                    return `<div class="element-wrapper container-element-wrapper" data-element-index="${j}">
                                <div class="drag-placeholder"></div>
                                ${this.renderElement(el, context)}
                            </div>`;
                }).join('');
                
                columnsHtml += `
                    <div class="container-column drop-zone" 
                         data-container-id="${element.id}" 
                         data-sub-index="${i}"
                         data-container-type="container-column"
                         ondragover="event.preventDefault(); event.stopPropagation(); window.editorInstance && window.editorInstance.handleContainerDragOver(event, '${element.id}', ${i})"
                         ondragleave="window.editorInstance && window.editorInstance.handleContainerDragLeave(event)"
                         ondrop="event.preventDefault(); event.stopPropagation(); window.editorInstance && window.editorInstance.handleContainerDrop(event, '${element.id}', ${i})">
                        <div class="container-column-header">Column ${i + 1}</div>
                        <div class="container-column-content">
                            ${columnElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                            <div class="drag-placeholder final-placeholder"></div>
                        </div>
                    </div>`;
            }
            
            const layoutClass = `container-columns container-cols-${columns}`;
            const gapClass = `gap-${gap}`;
            
            if (style === 'fieldset') {
                return `<div class="field-group" ${elementStyles}>
                    <fieldset class="element-fieldset ${isCollapsible ? 'collapsible-group' : ''}">
                        ${isCollapsible ? 
                            `<legend class="group-legend collapsible-legend">
                                <span class="collapse-icon ${defaultCollapsed ? 'collapsed' : ''}">${defaultCollapsed ? '▶' : '▼'}</span>
                                ${element.label || 'Group'}
                            </legend>` :
                            `<legend class="group-legend">${element.label || 'Group'}</legend>`
                        }
                        ${isCollapsible ? `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">` : ''}
                        <div class="container-wrapper ${layoutClass} ${gapClass}">
                            ${columnsHtml}
                        </div>
                        ${isCollapsible ? '</div>' : ''}
                    </fieldset>
                </div>`;
            } else {
                return `<div class="field-group group-style-${style}" ${elementStyles}>
                    ${showLabel ? `<div class="group-label">${element.label}</div>` : ''}
                    ${isCollapsible ? `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">` : ''}
                    <div class="container-wrapper ${layoutClass} ${gapClass}">
                        ${columnsHtml}
                    </div>
                    ${isCollapsible ? '</div>' : ''}
                </div>`;
            }
        }
        
        // Handle other layouts (like old Group)
        const groupElements = element.elements ? element.elements.map((el, i) => {
            return `<div class="element-wrapper group-element-wrapper" data-element-index="${i}">
                        <div class="drag-placeholder"></div>
                        ${this.renderElement(el, context)}
                    </div>`;
        }).join('') : '';
        
        // Determine layout class
        let layoutClass = '';
        switch (layout) {
            case 'horizontal':
                layoutClass = 'horizontal-layout';
                break;
            case 'grid':
                layoutClass = 'grid-layout';
                break;
            case 'combo-row':
                layoutClass = 'combo-row-layout';
                break;
            case 'combo-compact':
                layoutClass = 'combo-compact-layout';
                break;
            default:
                layoutClass = 'vertical-layout';
        }
        
        const gapClass = `group-gap-${gap}`;
        
        // Handle different visual styles
        if (style === 'fieldset') {
            // For combo layouts, don't use fieldset even if fieldset style is selected
            if (['combo-row', 'combo-compact'].includes(layout)) {
                return `<div class="field-group" ${elementStyles}>
                    <div class="drop-zone group-drop-zone ${layoutClass} ${gapClass}" 
                         data-container-id="${element.id}"
                         data-container-type="group">
                        ${groupElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                        <div class="drag-placeholder final-placeholder"></div>
                    </div>
                </div>`;
            }
            
            return `<div class="field-group" ${elementStyles}>
                <fieldset class="element-fieldset ${isCollapsible ? 'collapsible-group' : ''}">
                    ${isCollapsible ? 
                        `<legend class="group-legend collapsible-legend">
                            <span class="collapse-icon ${defaultCollapsed ? 'collapsed' : ''}">${defaultCollapsed ? '▶' : '▼'}</span>
                            ${element.label || 'Group'}
                        </legend>` :
                        `<legend class="group-legend">${element.label || 'Group'}</legend>`
                    }
                    ${isCollapsible ? `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">` : ''}
                    <div class="drop-zone group-drop-zone ${layoutClass} ${gapClass}" 
                         data-container-id="${element.id}"
                         data-container-type="group">
                        ${groupElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                        <div class="drag-placeholder final-placeholder"></div>
                    </div>
                    ${isCollapsible ? '</div>' : ''}
                </fieldset>
            </div>`;
        } else {
            // Plain, card, or subtle styles
            const wrapperClass = `group-style-${style}`;
            return `<div class="field-group ${wrapperClass}" ${elementStyles}>
                ${showLabel ? `<div class="group-label">${element.label}</div>` : ''}
                ${isCollapsible ? `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">` : ''}
                <div class="drop-zone group-drop-zone ${layoutClass} ${gapClass}" 
                     data-container-id="${element.id}"
                     data-container-type="group">
                    ${groupElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                    <div class="drag-placeholder final-placeholder"></div>
                </div>
                ${isCollapsible ? '</div>' : ''}
            </div>`;
        }
    }
    
    // Character sheet version (viewMode = false)
    if (style === 'fieldset' || !style || style === 'plain') {
        // For combo layouts, don't use fieldset even if fieldset style is selected
        if (['combo-row', 'combo-compact'].includes(layout)) {
            const layoutClass = layout === 'combo-row' ? 'combo-row-layout' : 'combo-compact-layout';
            const gapClass = `group-gap-${gap}`;
            let content = `<div class="field-group" ${elementStyles}>`;
            content += `<div class="${layoutClass} ${gapClass}">`;
            (element.elements || []).forEach(sub => {
                content += this.renderElement(sub, context);
            });
            content += '</div></div>';
            return content;
        }
        
        // Use fieldset styling for fieldset style or when no style specified (backward compatibility)
        let content = `<fieldset class="group-fieldset ${isCollapsible ? 'collapsible-group' : ''}" ${elementStyles} data-group-id="${groupId}">`;
        
        if (isCollapsible) {
            content += `<legend class="group-legend collapsible-legend" onclick="window.characterAppInstance.toggleGroup('${groupId}')">
                <span class="collapse-icon ${defaultCollapsed ? 'collapsed' : ''}">${defaultCollapsed ? '▶' : '▼'}</span>
                ${element.label || 'Group'}
            </legend>`;
            content += `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">`;
        } else if (showLabel) {
            content += `<legend class="group-legend">${element.label}</legend>`;
        }
        
        // Handle layout for character sheets
        if (layout === 'columns') {
            content += `<div class="container-wrapper container-columns container-cols-${element.columns || 2}">`;
            const columns = element.columns || 2;
            for (let i = 0; i < columns; i++) {
                content += `<div class="container-column">`;
                if (element.elements && element.elements[i]) {
                    element.elements[i].forEach(sub => {
                        content += this.renderElement(sub, context);
                    });
                }
                content += '</div>';
            }
            content += '</div>';
        } else {
            const layoutClass = layout === 'grid' ? 'grid-layout' : 
                               layout === 'horizontal' ? 'horizontal-layout' : 
                               layout === 'combo-row' ? 'combo-row-layout' :
                               layout === 'combo-compact' ? 'combo-compact-layout' :
                               'vertical-layout';
            const gapClass = `group-gap-${gap}`;
            content += `<div class="${layoutClass} ${gapClass}">`;
            (element.elements || []).forEach(sub => {
                content += this.renderElement(sub, context);
            });
            content += '</div>';
        }
        
        if (isCollapsible) {
            content += '</div>';
        }
        
        content += '</fieldset>';
        return content;
    } else {
        // Card or subtle styles for character sheets
        const wrapperClass = `group-style-${style}`;
        
        let content = `<div class="field-group ${wrapperClass}" ${elementStyles}>`;
        
        if (showLabel) {
            content += `<div class="group-label">${element.label}</div>`;
        }
        
        if (isCollapsible) {
            content += `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">`;
        }
        
        if (layout === 'columns') {
            content += `<div class="container-wrapper container-columns container-cols-${element.columns || 2}">`;
            const columns = element.columns || 2;
            for (let i = 0; i < columns; i++) {
                content += `<div class="container-column">`;
                if (element.elements && element.elements[i]) {
                    element.elements[i].forEach(sub => {
                        content += this.renderElement(sub, context);
                    });
                }
                content += '</div>';
            }
            content += '</div>';
        } else {
            const layoutClass = layout === 'grid' ? 'grid-layout' : 
                               layout === 'horizontal' ? 'horizontal-layout' : 
                               layout === 'combo-row' ? 'combo-row-layout' :
                               layout === 'combo-compact' ? 'combo-compact-layout' :
                               'vertical-layout';
            const gapClass = `group-gap-${gap}`;
            content += `<div class="${layoutClass} ${gapClass}">`;
            (element.elements || []).forEach(sub => {
                content += this.renderElement(sub, context);
            });
            content += '</div>';
        }
        
        if (isCollapsible) {
            content += '</div>';
        }
        
        content += '</div>';
        return content;
    }
},

renderContainer(element, context) {
    const { isPreview = false, viewMode = false } = context;
    const layout = element.layout || 'columns';
    const columns = element.columns || 2;
    const gap = element.gap || 'medium';
    const elementStyles = this.applyElementStyles(element);
    
    let layoutClass = '';
    switch (layout) {
        case 'columns':
            layoutClass = `container-columns container-cols-${columns}`;
            break;
        case 'rows':
            layoutClass = 'container-rows';
            break;
        case 'grid':
            layoutClass = 'container-grid';
            break;
        case 'flexbox':
            layoutClass = 'container-flexbox';
            break;
        default:
            layoutClass = 'container-columns container-cols-2';
    }
    
    const gapClass = `gap-${gap}`;
    
    if (isPreview) {
        let columnsHtml = '';
        
        if (layout === 'columns') {
            // Create the specified number of columns
            for (let i = 0; i < columns; i++) {
                // Safely get column elements
                const columnArray = (element.elements && Array.isArray(element.elements[i])) ? element.elements[i] : [];
                const columnElements = columnArray.map((el, j) => {
                    return `<div class="element-wrapper container-element-wrapper" data-element-index="${j}">
                                <div class="drag-placeholder"></div>
                                ${this.renderElement(el, context)}
                            </div>`;
                }).join('');
                
                columnsHtml += `
                    <div class="container-column drop-zone" 
                         data-container-id="${element.id}" 
                         data-sub-index="${i}"
                         data-container-type="container-column"
                         ondragover="event.preventDefault(); event.stopPropagation(); window.editorInstance && window.editorInstance.handleContainerDragOver(event, '${element.id}', ${i})"
                         ondragleave="window.editorInstance && window.editorInstance.handleContainerDragLeave(event)"
                         ondrop="event.preventDefault(); event.stopPropagation(); window.editorInstance && window.editorInstance.handleContainerDrop(event, '${element.id}', ${i})">
                        <div class="container-column-header">Column ${i + 1}</div>
                        <div class="container-column-content">
                            ${columnElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                            <div class="drag-placeholder final-placeholder"></div>
                        </div>
                    </div>`;
            }
        } else {
            // For other layouts, flatten all elements safely
            const allElementsArray = element.elements ? element.elements.flat().filter(el => el) : [];
            const allElements = allElementsArray.map((el, i) => {
                return `<div class="element-wrapper container-element-wrapper" data-element-index="${i}">
                            <div class="drag-placeholder"></div>
                            ${this.renderElement(el, context)}
                        </div>`;
            }).join('');
            
            columnsHtml = `
                <div class="container-area drop-zone" 
                     data-container-id="${element.id}" 
                     data-sub-index="0"
                     data-container-type="container-area"
                     ondragover="event.preventDefault(); event.stopPropagation(); window.editorInstance && window.editorInstance.handleContainerDragOver(event, '${element.id}', 0)"
                     ondragleave="window.editorInstance && window.editorInstance.handleContainerDragLeave(event)"
                     ondrop="event.preventDefault(); event.stopPropagation(); window.editorInstance && window.editorInstance.handleContainerDrop(event, '${element.id}', 0)">
                    ${allElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                    <div class="drag-placeholder final-placeholder"></div>
                </div>`;
        }
        
        return `<div class="field-group" ${elementStyles}>
            <div class="container-label">${element.label || 'Container'}</div>
            <div class="container-wrapper ${layoutClass} ${gapClass}">
                ${columnsHtml}
            </div>
        </div>`;
    }

    let content = `<div class="container-wrapper ${layoutClass} ${gapClass}" ${elementStyles}>`;
    
    if (layout === 'columns' && element.elements) {
        for (let i = 0; i < columns; i++) {
            content += `<div class="container-column">`;
            const columnArray = Array.isArray(element.elements[i]) ? element.elements[i] : [];
            columnArray.forEach(sub => {
                content += this.renderElement(sub, context);
            });
            content += '</div>';
        }
    } else if (element.elements) {
        const flatElements = Array.isArray(element.elements) ? element.elements.flat().filter(el => el) : [];
        flatElements.forEach(sub => {
            content += this.renderElement(sub, context);
        });
    }
    
    content += '</div>';
    return content;
},

renderArray(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const elementStyles = this.applyElementStyles(element);
    const displayStyle = element.displayStyle || 'table';
    const allowAdd = element.allowAdd !== false && !viewMode;
    const allowRemove = element.allowRemove !== false && !viewMode;
    const allowReorder = element.allowReorder !== false && !viewMode;
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        let previewContent = '';
        
        switch (displayStyle) {
            case 'cards':
                previewContent = `
                    <div class="array-cards-preview">
                        <div class="array-card-preview">
                            <div class="array-card-header">Item 1</div>
                            <div class="array-card-content">Sample card content...</div>
                        </div>
                        <div class="array-card-preview">
                            <div class="array-card-header">Item 2</div>
                            <div class="array-card-content">Sample card content...</div>
                        </div>
                    </div>`;
                break;
            case 'compact':
                previewContent = `
                    <div class="array-compact-preview">
                        <div class="array-compact-item">• Sample Item 1</div>
                        <div class="array-compact-item">• Sample Item 2</div>
                        <div class="array-compact-item">• Sample Item 3</div>
                    </div>`;
                break;
            default: // table
                previewContent = `
                    <div class="array-table-preview">
                        <div class="array-table-header">
                            <div>Name</div><div>Quantity</div><div>Weight</div><div>Description</div>
                        </div>
                        <div class="array-table-row">
                            <div>Sample Item</div><div>1</div><div>2.5</div><div>Description here</div>
                        </div>
                    </div>`;
        }
        
        return `<div class="field-group" ${elementStyles}>
            <label class="element-label">${element.label || 'Array Field'}</label>
            ${previewContent}
            <div class="preview-info">Preview: ${previewText} (${displayStyle} style)</div>
        </div>`;
    }
    
    const items = getValue(element.scope) || [];
    const arrayId = `array_${element.id || 'unknown'}`;
    
    let content = `<div class="field-group" ${elementStyles}>
        <div class="array-header-section">
            <label class="field-label">${element.label || 'Array Field'}</label>
            ${allowAdd ? `<button class="btn btn-secondary btn-small" onclick="window.characterAppInstance.addArrayItem('${element.scope}', '${arrayId}')">➕ Add Item</button>` : ''}
        </div>
        <div class="array-container array-style-${displayStyle}" id="${arrayId}" data-scope="${element.scope}" data-allow-reorder="${allowReorder}">`;
    
    if (items.length === 0) {
        content += '<div class="array-empty">No items</div>';
    } else {
        content += this.renderArrayItems(items, element, viewMode, allowRemove, allowReorder);
    }
    
    content += '</div></div>';
    return content;
},

renderArrayItems(items, element, viewMode, allowRemove, allowReorder) {
    const displayStyle = element.displayStyle || 'table';
    const dragClass = allowReorder ? 'draggable-array-item' : '';
    const dragAttrs = allowReorder ? 'draggable="true"' : '';
    
    switch (displayStyle) {
        case 'cards':
            return this.renderArrayCards(items, element, viewMode, allowRemove, allowReorder);
        case 'compact':
            return this.renderArrayCompact(items, element, viewMode, allowRemove, allowReorder);
        default: // table
            return this.renderArrayTable(items, element, viewMode, allowRemove, allowReorder);
    }
},

renderArrayTable(items, element, viewMode, allowRemove, allowReorder) {
    const dragClass = allowReorder ? 'draggable-array-item' : '';
    const dragAttrs = allowReorder ? 'draggable="true"' : '';
    
    let content = `<div class="array-table">
        <div class="array-table-header">
            ${allowReorder ? '<div class="array-drag-column">⋮⋮</div>' : ''}
            <div>Name</div>
            <div>Quantity</div>
            <div>Weight</div>
            <div>Description</div>
            ${allowRemove ? '<div class="array-actions-column">Actions</div>' : ''}
        </div>`;
    
    items.forEach((item, index) => {
        const dragHandlers = allowReorder ? 
            `ondragstart="window.characterAppInstance.startArrayDrag(event, ${index})" 
             ondragover="window.characterAppInstance.handleArrayDragOver(event, ${index})" 
             ondrop="window.characterAppInstance.handleArrayDrop(event, ${index})"` : '';
        
        content += `<div class="array-table-row ${dragClass}" ${dragAttrs} ${dragHandlers} data-index="${index}">
            ${allowReorder ? '<div class="array-drag-handle">⋮⋮</div>' : ''}
            <input type="text" value="${item.name || ''}" ${viewMode ? 'readonly' : ''} 
                onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'name')" 
                class="form-control array-input">
            <input type="number" value="${item.quantity || 0}" ${viewMode ? 'readonly' : ''} 
                onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'quantity')" 
                class="form-control array-input">
            <input type="number" step="0.1" value="${item.weight || 0}" ${viewMode ? 'readonly' : ''} 
                onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'weight')" 
                class="form-control array-input">
            <input type="text" value="${item.description || ''}" ${viewMode ? 'readonly' : ''} 
                onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'description')" 
                class="form-control array-input">
            ${allowRemove ? `<div class="array-item-actions">
                <button class="btn btn-danger btn-small" onclick="window.characterAppInstance.removeArrayItem('${element.scope}', ${index})" title="Remove Item">🗑️</button>
            </div>` : ''}
        </div>`;
    });
    
    content += '</div>';
    return content;
},

renderArrayCards(items, element, viewMode, allowRemove, allowReorder) {
    const dragClass = allowReorder ? 'draggable-array-item' : '';
    const dragAttrs = allowReorder ? 'draggable="true"' : '';
    
    let content = '<div class="array-cards">';
    
    items.forEach((item, index) => {
        const dragHandlers = allowReorder ? 
            `ondragstart="window.characterAppInstance.startArrayDrag(event, ${index})" 
             ondragover="window.characterAppInstance.handleArrayDragOver(event, ${index})" 
             ondrop="window.characterAppInstance.handleArrayDrop(event, ${index})"` : '';
        
        content += `<div class="array-card ${dragClass}" ${dragAttrs} ${dragHandlers} data-index="${index}">
            <div class="array-card-header">
                ${allowReorder ? '<div class="array-drag-handle">⋮⋮</div>' : ''}
                <input type="text" value="${item.name || 'Unnamed Item'}" ${viewMode ? 'readonly' : ''} 
                    onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'name')" 
                    class="form-control array-card-title">
                ${allowRemove ? `<button class="btn btn-danger btn-small" onclick="window.characterAppInstance.removeArrayItem('${element.scope}', ${index})" title="Remove Item">×</button>` : ''}
            </div>
            <div class="array-card-content">
                <div class="array-card-row">
                    <label>Quantity:</label>
                    <input type="number" value="${item.quantity || 0}" ${viewMode ? 'readonly' : ''} 
                        onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'quantity')" 
                        class="form-control">
                </div>
                <div class="array-card-row">
                    <label>Weight:</label>
                    <input type="number" step="0.1" value="${item.weight || 0}" ${viewMode ? 'readonly' : ''} 
                        onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'weight')" 
                        class="form-control">
                </div>
                <div class="array-card-row">
                    <label>Description:</label>
                    <textarea value="${item.description || ''}" ${viewMode ? 'readonly' : ''} 
                        onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'description')" 
                        class="form-control array-card-description">${item.description || ''}</textarea>
                </div>
            </div>
        </div>`;
    });
    
    content += '</div>';
    return content;
},

renderArrayCompact(items, element, viewMode, allowRemove, allowReorder) {
    const dragClass = allowReorder ? 'draggable-array-item' : '';
    const dragAttrs = allowReorder ? 'draggable="true"' : '';
    
    let content = '<div class="array-compact">';
    
    items.forEach((item, index) => {
        const dragHandlers = allowReorder ? 
            `ondragstart="window.characterAppInstance.startArrayDrag(event, ${index})" 
             ondragover="window.characterAppInstance.handleArrayDragOver(event, ${index})" 
             ondrop="window.characterAppInstance.handleArrayDrop(event, ${index})"` : '';
        
        const displayText = item.name || 'Unnamed Item';
        const quantityText = item.quantity > 1 ? ` (×${item.quantity})` : '';
        
        content += `<div class="array-compact-item ${dragClass}" ${dragAttrs} ${dragHandlers} data-index="${index}">
            ${allowReorder ? '<div class="array-drag-handle">⋮⋮</div>' : ''}
            <div class="array-compact-content">
                <span class="array-compact-name">${displayText}${quantityText}</span>
                <input type="text" value="${item.name || ''}" ${viewMode ? 'readonly' : ''} 
                    onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'name')" 
                    class="form-control array-compact-input" style="display: none;" 
                    onfocus="this.parentElement.querySelector('.array-compact-name').style.display='none'; this.style.display='block';"
                    onblur="this.style.display='none'; this.parentElement.querySelector('.array-compact-name').style.display='block';">
            </div>
            ${allowRemove ? `<button class="btn btn-danger btn-small" onclick="window.characterAppInstance.removeArrayItem('${element.scope}', ${index})" title="Remove Item">×</button>` : ''}
        </div>`;
    });
    
    content += '</div>';
    return content;
},
  
renderComboField(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const layout = element.layout || 'vertical';
    const size = element.size || 'medium';
    const colorStyle = this.generateColorVariations(element.backgroundColor);
    const colorAttr = element.backgroundColor ? 'data-color="true"' : '';
    
    const layoutClass = `layout-${layout}`;
    const sizeClass = size !== 'medium' ? size : '';
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        let comboStyles = [];
        if (element.textColor) comboStyles.push(`color: ${element.textColor} !important`);
        if (element.backgroundColor) comboStyles.push(`background-color: ${element.backgroundColor}`);
        if (element.borderColor) comboStyles.push(`border-color: ${element.borderColor}`);
        const comboStyleAttr = comboStyles.length > 0 ? 
            `style="${comboStyles.join('; ')}"` : '';
        
        return `<div class="field-group">
            <div class="combo-field ${layoutClass} ${sizeClass}" ${colorAttr} ${colorStyle} ${comboStyleAttr}>
                <div class="combo-label">${fieldName}</div>
                <div class="combo-score">10</div>
                <div class="combo-modifier">+0</div>
            </div>
            <div class="preview-info">Preview: ${previewText}</div>
        </div>`;
    }

    const value = getValue(element.scope);

    let modifierScope = '';
    if (element.scope) {
        if (element.scope.startsWith('@')) {
            // Convert @abilities.strength to @modifiers.strength
            modifierScope = element.scope.replace('@abilities.', '@modifiers.');
        } else {
            // Handle direct dot notation
            modifierScope = element.scope.replace('abilities.', 'modifiers.');
        }
    }

    const modifier = getValue(modifierScope);
    const isReadOnly = instanceRef ? instanceRef.isReadOnly(element.scope) : false;

    let comboStyles = [];
    if (element.textColor) comboStyles.push(`color: ${element.textColor} !important`);
    if (element.backgroundColor) comboStyles.push(`background-color: ${element.backgroundColor}`);
    if (element.borderColor) comboStyles.push(`border-color: ${element.borderColor}`);
    const comboStyleAttr = comboStyles.length > 0 ? `style="${comboStyles.join('; ')}"` : '';

    let inputStyles = [];
    if (element.textColor) inputStyles.push(`color: ${element.textColor} !important`);
    const inputStyleAttr = inputStyles.length > 0 ? `style="${inputStyles.join('; ')}"` : '';

    // Focus handler for saving state before editing
    const focusHandler = viewMode || isReadOnly ? '' : `onfocus="window.characterAppInstance.handleInputFocus('${element.scope}')"`;

    return `<div class="field-group">
        <div class="combo-field ${layoutClass} ${sizeClass}" ${colorAttr} ${colorStyle} ${comboStyleAttr}>
            <div class="combo-label" ${inputStyleAttr}>${fieldName}</div>
            <input class="combo-score" type="number" name="${element.scope}" value="${value || 10}" 
                ${viewMode ? 'readonly onclick="window.characterAppInstance.handleNumberClick(event, \'' + element.scope + '\')"' : ''} 
                ${focusHandler}
                onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" 
                ${!viewMode ? 'oninput="window.characterAppInstance.updateValue(event, \'' + element.scope + '\')"' : ''} ${inputStyleAttr}>
            <input class="combo-modifier" type="text" value="${instanceRef ? instanceRef.formatValue(modifierScope, modifier) : modifier || '+0'}" readonly ${inputStyleAttr}>
        </div>
    </div>`;
},
    
renderMultiStateToggle(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const states = element.states || 2;
    const shape = element.shape || 'circle';
    const size = element.size || 'medium';
    const labelPosition = element.labelPosition || 'right';
    const toggleId = `toggle_${element.id || 'unknown'}`;
    const colorStyle = this.generateColorVariations(element.backgroundColor);
    const colorAttr = element.backgroundColor ? 'data-color="true"' : '';
    // NO container styles for multi-state toggle
    
    const labelClass = `label-${labelPosition}`;
    const sizeClass = size !== 'medium' ? size : '';
    const shapeClass = shape !== 'circle' ? shape : '';
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        const toggleColors = this.getElementColors(element, 'selected');
        return `<div class="field-group">
            <div class="multi-state-toggle ${labelClass}">
                <div class="multi-state-control ${shapeClass} ${sizeClass} state-1" style="${toggleColors}" ${colorAttr}></div>
                <div class="multi-state-label">${fieldName}</div>
                <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem;">Preview: ${previewText} (${states} states)</div>
            </div>
        </div>`;
    }
    
    const value = getValue(element.scope) || 0;
    const clickHandler = viewMode ? '' : `onclick="window.characterAppInstance.updateMultiStateValue('${element.scope}', ${states})"`;
    const toggleColors = value > 0 ? this.getElementColors(element, 'selected') : this.getElementColors(element, 'unselected');
    
    return `<div class="field-group">
        <div class="multi-state-toggle ${labelClass}" id="${toggleId}" data-scope="${element.scope}" data-states="${states}" ${colorStyle}>
            <div class="multi-state-control ${shapeClass} ${sizeClass} state-${value}" style="${toggleColors}" ${colorAttr} ${clickHandler}></div>
            <div class="multi-state-label">${fieldName}</div>
        </div>
    </div>`;
},

renderSelectGroup(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const selectionType = element.selectionType || 'multi';
    const displayMode = element.displayMode || 'all';
    const style = element.style || 'pills';
    const colorStyle = this.generateColorVariations(element.backgroundColor);
    const colorAttr = element.backgroundColor ? 'data-color="true"' : '';
    // NO container styles for select group
    
    const styleClass = `style-${style}`;
    const modeClass = `mode-${displayMode}`;
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        const selectedColors = this.getElementColors(element, 'selected');
        const unselectedColors = this.getElementColors(element, 'unselected');
        
        return `<div class="field-group">
            <label class="field-label">${fieldName}</label>
            <div class="select-group ${styleClass} ${modeClass}" ${colorAttr} ${colorStyle}>
                <div class="select-group-option selected" style="${selectedColors}">Selected Item</div>
                <div class="select-group-option unselected" style="${unselectedColors}">Available Item</div>
            </div>
            <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.5rem;">Preview: ${previewText} (${selectionType} select)</div>
        </div>`;
    }
    
    const selectedValues = getValue(element.scope) || [];
    
    // Get options from schema field or static list
    let options = [];
    if (element.optionsSource === 'field' && element.optionsScope && instanceRef) {
        const schemaOptions = instanceRef.getSchemaOptions(element.optionsScope);
        options = schemaOptions || [];
    } else if (element.optionsSource === 'static' && element.staticOptions) {
        options = element.staticOptions.split(',').map(opt => opt.trim()).filter(opt => opt);
    }
    
    let optionsHtml = '';
    options.forEach(option => {
        const isSelected = selectionType === 'single' 
            ? selectedValues === option 
            : Array.isArray(selectedValues) && selectedValues.includes(option);
        
        const selectedClass = isSelected ? 'selected' : '';
        const clickHandler = viewMode ? '' : `onclick="window.characterAppInstance.updateSelectGroupValue('${element.scope}', '${option}', '${selectionType}')"`;
        const optionColors = this.getElementColors(element, isSelected ? 'selected' : 'unselected');
        
        optionsHtml += `<div class="select-group-option ${selectedClass}" style="${optionColors}" ${clickHandler}>${option}</div>`;
    });
    
    return `<div class="field-group">
        <label class="field-label">${fieldName}</label>
        <div class="select-group ${styleClass} ${modeClass}" ${colorAttr} data-scope="${element.scope}" data-selection-type="${selectionType}" ${colorStyle}>
            ${optionsHtml}
        </div>
    </div>`;
},

renderLinearTrack(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const segments = element.segments || 6;
    const showCounter = element.showCounter !== false;
    const trackId = `track_${element.id || 'unknown'}`;
    // NO container styles for tracks
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        return `<div class="field-group">
            <label class="element-label">${fieldName}</label>
            <div class="preview-linear-track" data-segments="${segments}">
                ${Array.from({length: segments}, (_, i) => {
                    const filled = i < 2;
                    const segmentColors = this.getElementColors(element, filled ? 'filled' : 'empty');
                    return `<div class="preview-track-segment ${filled ? 'filled' : ''}" style="${segmentColors}"></div>`;
                }).join('')}
            </div>
            <div class="preview-track-info">Preview: ${previewText} (${segments} segments)</div>
        </div>`;
    }
    
    const value = getValue(element.scope) || 0;
    let segmentsHtml = '';
    for (let i = 0; i < segments; i++) {
        const filled = i < value;
        const clickHandler = viewMode ? '' : `onclick="window.characterAppInstance.updateTrackValue('${element.scope}', ${i + 1}, ${segments})"`;
        const segmentColors = this.getElementColors(element, filled ? 'filled' : 'empty');
        segmentsHtml += `<div class="progress-segment ${filled ? 'filled' : ''}" style="${segmentColors}" data-index="${i}" ${clickHandler}></div>`;
    }
    
    const counterHtml = showCounter ? `<div class="progress-track-counter">${value}/${segments}</div>` : '';
    
    return `<div class="field-group">
        <label class="progress-track-label">${fieldName}</label>
        <div class="progress-linear" id="${trackId}" data-scope="${element.scope}" data-max="${segments}">
            ${segmentsHtml}
        </div>
        ${counterHtml}
    </div>`;
},

renderCircularTrack(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const segments = element.segments || 6;
    const showCounter = element.showCounter !== false;
    const trackId = `clock_${element.id || 'unknown'}`;
    // NO container styles for tracks
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        return `<div class="field-group">
            <label class="element-label">${fieldName}</label>
            <div class="preview-circular-track">
                <div class="preview-clock-circle">
                    ${Array.from({length: segments}, (_, i) => {
                        const angle = (i * 360 / segments) - 90;
                        const radian = angle * Math.PI / 180;
                        const x = 50 + 35 * Math.cos(radian);
                        const y = 50 + 35 * Math.sin(radian);
                        const filled = i < 2;
                        const segmentColors = this.getElementColors(element, filled ? 'filled' : 'empty');
                        return `<div class="preview-clock-segment ${filled ? 'filled' : ''}" style="left: ${x}%; top: ${y}%; ${segmentColors}"></div>`;
                    }).join('')}
                </div>
            </div>
            <div class="preview-track-info">Preview: ${previewText} (${segments} segments)</div>
        </div>`;
    }
    
    const value = getValue(element.scope) || 0;
    let segmentsHtml = '';
    const centerX = 50;
    const centerY = 50;
    const radius = 35;
    
    for (let i = 0; i < segments; i++) {
        const angle = (i * 360 / segments) - 90;
        const radian = angle * Math.PI / 180;
        const x = centerX + radius * Math.cos(radian);
        const y = centerY + radius * Math.sin(radian);
        const filled = i < value;
        const clickHandler = viewMode ? '' : `onclick="window.characterAppInstance.updateTrackValue('${element.scope}', ${i + 1}, ${segments})"`;
        const segmentColors = this.getElementColors(element, filled ? 'filled' : 'empty');
        const positionStyle = `left: ${x}%; top: ${y}%;`;
        
        segmentsHtml += `<div class="progress-circle-segment ${filled ? 'filled' : ''}" 
            style="${positionStyle} ${segmentColors}" 
            data-index="${i}" 
            ${clickHandler}></div>`;
    }
    
    const counterHtml = showCounter ? `<div class="progress-track-counter">${value}/${segments}</div>` : '';
    
    return `<div class="field-group">
        <label class="progress-track-label">${fieldName}</label>
        <div class="progress-circular" id="${trackId}" data-scope="${element.scope}" data-max="${segments}">
            <div class="progress-circle">
                ${segmentsHtml}
            </div>
        </div>
        ${counterHtml}
    </div>`;
},
    
    renderLabel(element, context) {
        const { isPreview = false } = context;
        const elementStyles = this.applyElementStyles(element);
        
        if (isPreview) {
            return `<div class="field-group" ${elementStyles}>
                <h3 class="element-heading">${element.label || 'Label Text'}</h3>
            </div>`;
        }
        
        return `<div class="field-group" ${elementStyles}>
            <h3 class="label-heading">${element.label || 'Label Text'}</h3>
        </div>`;
    },
    
    renderDivider(element, context) {
        const { isPreview = false } = context;
        const elementStyles = this.applyElementStyles(element);
        
        if (isPreview) {
            return `<div class="field-group" ${elementStyles}>
                <hr class="element-divider">
            </div>`;
        }
        
        return `<div class="field-group" ${elementStyles}>
            <hr class="divider-line">
        </div>`;
    },
    
    renderImage(element, context) {
       const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
       const fieldName = element.label || 'Image';
       const elementStyles = this.applyElementStyles(element);
       const shapeClass = `image-shape-${element.shape || 'square'}`;
       const borderClass = `image-border-${element.borderStyle || 'thin'}`;
       const containerStyle = `width: ${element.width || 150}px; height: ${element.height || 150}px;`;
       const aspectRatioStyle = element.maintainAspectRatio === true ? 'object-fit: cover;' : 'object-fit: fill;';
       
       if (isPreview) {
           const imageContent = element.src 
               ? `<img src="${element.src}" alt="${element.alt || ''}" class="preview-image" style="${containerStyle}">`
               : `<div class="preview-image-placeholder" style="${containerStyle}">
               <div class="preview-image-placeholder-icon">🖼️</div>
               <div>No image selected</div>
               <div style="font-size: 0.75rem; color: #9ca3af;">
                 ${element.scope ? 'Data-bound' : 'Static'} • ${element.width || 150}×${element.height || 150}px
               </div>
               </div>`;
           const containerClass = element.src ? 'has-image' : '';
           
           return `<div class="field-group" ${elementStyles}>
               <label class="element-label">${fieldName}</label>
               <div class="preview-image-container ${containerClass} ${shapeClass} ${borderClass}" style="${containerStyle}">${imageContent}</div>
           </div>`;
       }
       
       // Character sheet version
       const imageSrc = element.scope ? getValue(element.scope) : element.src;
       const allowUpload = element.allowUpload === true && element.scope && !viewMode;
       
       let imageContent;
       if (imageSrc) {
           imageContent = `<img src="${imageSrc}" alt="${element.alt || fieldName}" class="character-image" style="width: 100%; height: 100%; ${aspectRatioStyle}">`;
           if (allowUpload) {
               imageContent += `<div class="image-upload-overlay" onclick="window.characterAppInstance.uploadImage('${element.scope}', '${element.id}')">📤 Change Image</div>`;
           }
       } else {
           if (allowUpload) {
               imageContent = `<div class="character-image-placeholder" onclick="window.characterAppInstance.uploadImage('${element.scope}', '${element.id}')">
                   <div class="character-image-placeholder-icon">🖼️</div>
                   <div>Click to upload image</div>
                   <div style="font-size: 0.75rem; margin-top: 0.25rem;">${element.width || 150}×${element.height || 150}px</div>
               </div>`;
           } else {
               imageContent = `<div class="character-image-placeholder">
                   <div class="character-image-placeholder-icon">🖼️</div>
                   <div>No image</div>
               </div>`;
           }
       }
       const containerClass = imageSrc ? 'has-image' : '';
       
       return `<div class="field-group" ${elementStyles}>
           <label class="field-label">${fieldName}</label>
           <div class="character-image-container ${containerClass} ${shapeClass} ${borderClass}" style="${containerStyle}">
               ${imageContent}
               ${imageSrc && allowUpload ? `<div class="image-controls">
                   <button class="image-control-btn" onclick="event.stopPropagation(); window.characterAppInstance.uploadImage('${element.scope}', '${element.id}')" title="Change Image">✏️</button>
                   <button class="image-control-btn delete" onclick="event.stopPropagation(); window.characterAppInstance.removeImage('${element.scope}')" title="Remove Image">🗑️</button>
               </div>` : ''}
           </div>
       </div>`;
    }
  }

};

// Reusable Undo/Redo System
Utils.UndoRedoManager = class {
    constructor(maxSteps = 50) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxSteps = maxSteps;
        this.isUndoRedoOperation = false;
        this.onStateChange = null; // Callback for when state changes
    }

saveState(state, description = '') {
    if (this.isUndoRedoOperation) return;
    
    // Check if this state is identical to the last saved state
    if (this.undoStack.length > 0) {
        const lastState = this.undoStack[this.undoStack.length - 1];
        if (JSON.stringify(lastState.data) === JSON.stringify(state)) {
            // Don't save identical states
            return;
        }
    }
    
    const stateSnapshot = {
        data: Utils.deepClone(state),
        description,
        timestamp: Date.now()
    };
    
    this.undoStack.push(stateSnapshot);
    
    // Limit stack size
    if (this.undoStack.length > this.maxSteps) {
        this.undoStack.shift();
    }
    
    // Clear redo stack when new action is performed
    this.redoStack = [];
    
    // Notify about state change
    if (this.onStateChange) {
        this.onStateChange();
    }
}

undo() {
    if (this.undoStack.length === 0) {
        return null;
    }
    
    // Save current state to redo stack first
    const currentState = this.getCurrentState();
    if (currentState) {
        this.redoStack.push({
            data: Utils.deepClone(currentState),
            description: 'Current state',
            timestamp: Date.now()
        });
    }
    
    // Get previous state
    const previousState = this.undoStack.pop();
    this.isUndoRedoOperation = true;
    
    Utils.showNotification(`Undid: ${previousState.description || 'action'}`, 'success');
    
    // Notify about state change
    if (this.onStateChange) {
        this.onStateChange();
    }
    
    return previousState.data;
}

redo() {
    if (this.redoStack.length === 0) {
        return null;
    }
    
    // Save current state to undo stack first
    const currentState = this.getCurrentState();
    if (currentState) {
        this.undoStack.push({
            data: Utils.deepClone(currentState),
            description: 'Current state',
            timestamp: Date.now()
        });
    }
    
    // Get next state
    const nextState = this.redoStack.pop();
    this.isUndoRedoOperation = true;
    
    Utils.showNotification(`Redid: ${nextState.description || 'action'}`, 'success');
    
    // Notify about state change
    if (this.onStateChange) {
        this.onStateChange();
    }
    
    return nextState.data;
}

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.isUndoRedoOperation = false;
        if (this.onStateChange) {
            this.onStateChange();
        }
    }

    setCurrentStateGetter(getter) {
        this.getCurrentState = getter;
    }

    finishUndoRedo() {
        this.isUndoRedoOperation = false;
    }
};

// Keyboard Shortcuts Manager
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

    getShortcut(key) {
        return this.shortcuts.get(key);
    }

    startListening() {
        if (this.isListening) return;
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.isListening = true;
    }

    handleKeyDown(event) {
        const isInInput = ['INPUT', 'TEXTAREA'].includes(event.target.tagName);
        const key = this.getKeyString(event);
        const shortcut = this.shortcuts.get(key);

        if (shortcut && (shortcut.allowInInputs || !isInInput)) {
            if (shortcut.preventDefault) {
                event.preventDefault();
            }
            shortcut.callback(event);
        }
    }

    getAllShortcuts() {
        return Array.from(this.shortcuts.entries()).map(([key, shortcut]) => ({
            key,
            ...shortcut
        }));
    }

    getKeyString(event) {
        const parts = [];
        if (event.ctrlKey || event.metaKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        parts.push(event.key.toLowerCase());
        return parts.join('+');
    }

    getDisplayString(keyString) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlKey = isMac ? '⌘' : 'Ctrl';
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
        
        // Register the keyboard shortcut
        if (shortcutKey && action) {
            keyboardManager.register(shortcutKey, action, { description });
        }
        
        // Apply tooltip to element if it exists
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

// User customization system
Utils.UserShortcuts = class {
    static customOverrides = {}; // User modifications to system shortcuts
    static userShortcuts = {};   // Completely new user shortcuts
    
    // Get all shortcuts for a specific context
    static getResolvedShortcuts(context) {
        const allShortcuts = [];
        
        // Add system shortcuts that apply to this context
        Object.values(Utils.ShortcutRegistry.system).forEach(shortcut => {
            if (shortcut.scope.includes('global') || shortcut.scope.includes(context)) {
                // Check for user override
                const override = this.customOverrides[shortcut.id];
                allShortcuts.push({
                    ...shortcut,
                    key: override?.key || shortcut.defaultKey,
                    enabled: override?.enabled !== false,
                    source: 'system',
                    overridden: !!override
                });
            }
        });
        
        // Add user-defined shortcuts that apply to this context
        Object.values(this.userShortcuts).forEach(shortcut => {
            if (shortcut.scope.includes('global') || shortcut.scope.includes(context)) {
                allShortcuts.push({
                    ...shortcut,
                    enabled: shortcut.enabled !== false,
                    source: 'user'
                });
            }
        });
        
        return allShortcuts.filter(s => s.enabled);
    }
    
    static saveToStorage() {
        try {
            localStorage.setItem('ttrpg_custom_shortcuts', JSON.stringify({
                overrides: this.customOverrides,
                user: this.userShortcuts
            }));
        } catch (error) {
            console.warn('Failed to save shortcuts to localStorage:', error);
        }
    }
    
    static loadFromStorage() {
        try {
            const stored = localStorage.getItem('ttrpg_custom_shortcuts');
            if (stored) {
                const data = JSON.parse(stored);
                this.customOverrides = data.overrides || {};
                this.userShortcuts = data.user || {};
            }
        } catch (error) {
            console.warn('Failed to load shortcuts from localStorage:', error);
            this.customOverrides = {};
            this.userShortcuts = {};
        }
    }
    
    static init() {
        this.loadFromStorage();
    }
};

// Enhanced shortcut application helper
Utils.applyShortcutsFromRegistry = function(keyboardManager, context, actionProvider) {
    // Register the action provider
    Utils.ActionRegistry.registerProvider(context, actionProvider);
    
    const shortcuts = Utils.UserShortcuts.getResolvedShortcuts(context);
    
    shortcuts.forEach(shortcut => {
        const action = actionProvider.getAction(shortcut.actionId || shortcut.id);
        if (action) {
            keyboardManager.register(shortcut.key, action, { 
                description: shortcut.description 
            });
            
            // Apply tooltip to element if it exists
            if (shortcut.elementId) {
                const element = document.getElementById(shortcut.elementId);
                if (element) {
                    const displayShortcut = keyboardManager.getDisplayString(shortcut.key);
                    const tooltip = `${shortcut.description} (${displayShortcut})`;
                    element.setAttribute('title', tooltip);
                }
            }
        }
    });
};

// Initialize on load
Utils.UserShortcuts.init();

// Export for use in other files
if ( typeof window !== 'undefined' ) {
  window.Utils = Utils;
}