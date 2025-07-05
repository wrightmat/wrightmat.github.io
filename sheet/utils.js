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

  // Evaluate formulas in character data
  evaluateFormulas( schema, data ) {
    const evaluateNode = (node, basePath) => {
      const pathArr = Array.isArray(basePath) ? basePath : [];

      if (!node?.properties) return;

      for (const [key, field] of Object.entries(node.properties)) {
        const path = [...pathArr, key];

        if (field['x-formula']) {
          try {
            const result = Function('with(this) { return ' + field['x-formula'] + '; }').call(data);
            let target = data;
            for (let i = 0; i < path.length - 1; i++) {
              target = target[path[i]] ??= {};
            }
            target[path.at(-1)] = result;
          } catch (e) {
            console.warn('Failed to evaluate formula for', key, e);
          }
        } else if (field.type === 'object') {
          evaluateNode(field, path);
        }
      }
    };

    evaluateNode(schema, []);
  },

  createUnifiedSelector(containerId, options = {}) {
    const {
        onSchemaChange = () => {},
        onTemplateChange = () => {},
        onCharacterChange = () => {},
        showCharacterSelector = true,
        showCreateNew = false
    } = options;

    return {
        selectedSchemaId: '',
        selectedTemplateId: '', 
        selectedCharacterId: '',
        availableTemplates: {},
        availableCharacters: {},

        init() {
            // Initialize with first available schema if none selected
            const schemas = DataManager.getSchemas();
            if (!this.selectedSchemaId && Object.keys(schemas).length > 0) {
                this.selectedSchemaId = Object.keys(schemas)[0];
                this.loadTemplatesForSchema();
            }
        },

        loadTemplatesForSchema() {
            this.availableTemplates = {};
            this.availableCharacters = {};
            this.selectedTemplateId = '';
            this.selectedCharacterId = '';

            if (!this.selectedSchemaId) {
                onSchemaChange('', '', '');
                return;
            }

            // Find templates that reference this schema by index
            const schema = DataManager.getSchema(this.selectedSchemaId);
            if (schema) {
                const allTemplates = DataManager.getTemplates();
                this.availableTemplates = Object.fromEntries(
                    Object.entries(allTemplates).filter(([_, template]) => 
                        template.schema === schema.index
                    )
                );
            }
            onSchemaChange(this.selectedSchemaId, '', '');
        },

        loadCharactersForTemplate() {
            this.availableCharacters = {};
            this.selectedCharacterId = '';

            if (!this.selectedTemplateId) {
                onTemplateChange(this.selectedSchemaId, this.selectedTemplateId, '');
                return;
            }

            if (showCharacterSelector) {
                // Find characters that reference this schema and template by index
                const schema = DataManager.getSchema(this.selectedSchemaId);
                const template = DataManager.getTemplate(this.selectedTemplateId);
                
                if (schema && template) {
                    const allCharacters = DataManager.getCharacters();
                    this.availableCharacters = Object.fromEntries(
                        Object.entries(allCharacters).filter(([_, character]) => 
                            character.system === schema.index && character.template === template.index
                        )
                    );
                }
            }
            onTemplateChange(this.selectedSchemaId, this.selectedTemplateId, '');
        },

        selectSchema( schemaId ) {
            this.selectedSchemaId = schemaId;
            this.loadTemplatesForSchema();
        },

        selectTemplate( templateId ) {
            this.selectedTemplateId = templateId;
            this.loadCharactersForTemplate();
        },

        selectCharacter( characterId ) {
            this.selectedCharacterId = characterId;
            onCharacterChange(this.selectedSchemaId, this.selectedTemplateId, this.selectedCharacterId);
        },

        getSchemas() { return DataManager.getSchemas(); }
    };
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
    if (typeof path === 'string') {
      path = path.replace('#/properties/', '').split('/properties/');
    }
    
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]] ??= {};
    }
    current[path[path.length - 1]] = value;
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
    for (let element of elements) {
      if (element.id === id) {
        return element;
      }
      
      // Search in nested elements
      if (element.elements) {
        const found = this.findElementById(element.elements, id);
        if (found) return found;
      }
    }
    return null;
  },
  
  // Remove element by ID from nested structure
  removeElementById( elements, id ) {
    for ( let i = 0; i < elements.length; i++ ) {
      if ( elements[i].id === id ) {
        elements.splice(i, 1);
        return true;
      }
      if ( elements[i].elements ) {      // Search in nested elements
        if ( this.removeElementById(elements[i].elements, id )) return true;
      }
    }
    return false;
  },
  
  // Find parent container of element
  findElementParent( elements, id, parent = null ) {
    for (let element of elements) {
      if (element.id === id) return parent;
      if (element.elements) {
        const found = this.findElementParent(element.elements, id, element.elements);
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
    const fieldName = element.label || this.generateFieldName(element.scope);
    const value = getValue(element.scope) || '';
    const controlType = element.controlType || 'text';
    const elementStyles = this.applyElementStyles(element);
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        let inputElement = '';
        
        // Apply text color to preview inputs
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
            ${controlType !== 'checkbox' && controlType !== 'combo' ? `<label class="field-label">${fieldName}</label>` : ''}
            ${controlType === 'combo' ? `<div class="preview-combo-label">${fieldName}</div>` : ''}
            ${inputElement}
            <div class="preview-info">Preview: ${previewText}</div>
        </div>`;
    }
    
    // Character sheet rendering - apply text color to inputs
    const isReadOnly = instanceRef ? instanceRef.isReadOnly(element.scope) : false;
    const isNumber = controlType === 'number' || typeof value === 'number';
    let inputElement = '';
    
    // Apply text color to character sheet inputs too
    let inputStyles = [];
    if (element.textColor) inputStyles.push(`color: ${element.textColor}`);
    if (element.backgroundColor) inputStyles.push(`background-color: ${element.backgroundColor}`);
    if (element.borderColor) inputStyles.push(`border-color: ${element.borderColor}`);
    const inputStyleAttr = inputStyles.length > 0 ? `style="${inputStyles.join('; ')}"` : '';
    
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
                inputElement = `<textarea name="${element.scope}" ${isReadOnly || viewMode ? 'readonly' : ''} onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" class="form-control textarea-control" ${inputStyleAttr}>${instanceRef ? instanceRef.formatValue(element.scope, value) : value}</textarea>`;
            }
            break;
        case 'select': 
            inputElement = `<select name="${element.scope}" ${isReadOnly || viewMode ? 'disabled' : ''} onchange="window.characterAppInstance.updateValue(event, '${element.scope}')" class="form-control" ${inputStyleAttr}><option value="${value}">${value || 'Select an option...'}</option></select>`; 
            break;
        case 'checkbox': 
            const checked = value === true || value === 'true' || value === 1; 
            inputElement = `<label class="checkbox-label" ${inputStyleAttr}><input type="checkbox" name="${element.scope}" ${checked ? 'checked' : ''} ${isReadOnly || viewMode ? 'disabled' : ''} onchange="window.characterAppInstance.updateCheckbox(event, '${element.scope}')" class="checkbox-input"><span>${fieldName}</span></label>`; 
            break;
        case 'date':
            inputElement = `<input type="date" name="${element.scope}" value="${value || ''}" ${isReadOnly || viewMode ? 'readonly' : ''} onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" ${!viewMode ? 'onchange="window.characterAppInstance.updateValue(event, \'' + element.scope + '\')"' : ''} class="form-control" ${inputStyleAttr}>`;
            break;
        default: 
            inputElement = `<input type="${controlType}" name="${element.scope}" value="${instanceRef ? instanceRef.formatValue(element.scope, value) : value}" ${isReadOnly || viewMode ? 'readonly' : ''} ${viewMode && isNumber && !isReadOnly ? 'onclick="window.characterAppInstance.handleNumberClick(event, \'' + element.scope + '\')"' : ''} onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" ${isNumber && !viewMode ? 'oninput="window.characterAppInstance.updateValue(event, \'' + element.scope + '\')"' : ''} class="form-control" ${inputStyleAttr}>`;
    }
    
    return `<div class="field-group" ${elementStyles}>
        ${controlType !== 'checkbox' && controlType !== 'combo' ? `<label class="field-label">${fieldName}</label>` : ''}
        ${controlType === 'combo' ? `<div class="preview-combo-label">${fieldName}</div>` : ''}
        ${inputElement}
    </div>`;
},
   
    renderGroup(element, context) {
        const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
        const layoutClass = element.layout === 'grid' ? 'grid-layout' : element.layout === 'horizontal' ? 'horizontal-layout' : 'vertical-layout';
        const isCollapsible = element.collapsible === true;
        const defaultCollapsed = element.defaultCollapsed === 'collapsed';
        const groupId = `group_${element.id || Math.random().toString(36).substr(2, 9)}`;
        const elementStyles = this.applyElementStyles(element);
        
        if (isPreview) {
            const groupElements = element.elements ? element.elements.map((el, i) => this.renderElement(el, context)).join('') : '';
            return `<div class="field-group" ${elementStyles}>
                <fieldset class="element-fieldset ${isCollapsible ? 'collapsible-group' : ''}" data-group-id="${groupId}">
                    ${isCollapsible ? 
                        `<legend class="group-legend collapsible-legend">
                            <span class="collapse-icon ${defaultCollapsed ? 'collapsed' : ''}">${defaultCollapsed ? '▶' : '▼'}</span>
                            ${element.label || 'Group'}
                        </legend>` :
                        `<legend class="group-legend">${element.label || 'Group'}</legend>`
                    }
                    ${isCollapsible ? `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">` : ''}
                    <div class="${layoutClass}">
                        ${groupElements || '<div class="group-drop-zone-empty">Drop elements here</div>'}
                    </div>
                    ${isCollapsible ? '</div>' : ''}
                </fieldset>
            </div>`;
        }
        
        // Character sheet version
        let content = `<fieldset class="group-fieldset ${isCollapsible ? 'collapsible-group' : ''}" ${elementStyles} data-group-id="${groupId}">`;
        
        if (isCollapsible) {
            content += `<legend class="group-legend collapsible-legend" onclick="window.characterAppInstance.toggleGroup('${groupId}')">
                <span class="collapse-icon ${defaultCollapsed ? 'collapsed' : ''}">${defaultCollapsed ? '▶' : '▼'}</span>
                ${element.label || 'Group'}
            </legend>`;
            content += `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content">`;
        } else {
            content += `<legend class="group-legend">${element.label || 'Group'}</legend>`;
        }
        
        content += `<div class="${layoutClass}">`;
        (element.elements || []).forEach(sub => {
            content += this.renderElement(sub, context);
        });
        content += '</div>';
        
        if (isCollapsible) {
            content += '</div>';
        }
        
        content += '</fieldset>';
        return content;
    },
    
    renderArray(element, context) {
        const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
        const elementStyles = this.applyElementStyles(element);
        
        if (isPreview) {
            return `<div class="field-group" ${elementStyles}>
                <label class="element-label">${element.label || 'Array Field'}</label>
                <div class="preview-array">Array items will appear here (${element.scope || 'No field selected'})</div>
            </div>`;
        }
        
        const items = getValue(element.scope) || [];
        let content = `<div class="field-group" ${elementStyles}><label class="field-label">${element.label || 'Array Field'}</label><div class="array-container">`;
        
        if (items.length === 0) {
            content += '<div class="array-empty">No items</div>';
        } else {
            content += '<div class="array-header"><div>Name</div><div>Quantity</div><div>Weight</div><div>Description</div></div>';
            items.forEach((item, index) => {
                content += `<div class="array-item">
                    <input type="text" value="${item.name || ''}" ${viewMode ? 'readonly' : ''} onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'name')" class="form-control">
                    <input type="number" value="${item.quantity || 0}" ${viewMode ? 'readonly' : ''} onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'quantity')" class="form-control">
                    <input type="number" step="0.1" value="${item.weight || 0}" ${viewMode ? 'readonly' : ''} onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'weight')" class="form-control">
                    <input type="text" value="${item.description || ''}" ${viewMode ? 'readonly' : ''} onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'description')" class="form-control">
                </div>`;
            });
        }
        content += '</div></div>';
        return content;
    },
    
renderComboField(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || this.generateFieldName(element.scope);
    const layout = element.layout || 'vertical';
    const size = element.size || 'medium';
    const colorStyle = this.generateColorVariations(element.borderColor || element.backgroundColor);
    const colorAttr = (element.borderColor || element.backgroundColor) ? 'data-color="true"' : '';
    const elementStyles = this.applyElementStyles(element, 'container');
    
    const layoutClass = `layout-${layout}`;
    const sizeClass = `size-${size}`;
    
    if (isPreview) {
        const previewText = element.scope || 'No field selected';
        
        let comboStyles = [];        // Apply text color directly to combo elements
        if (element.textColor) comboStyles.push(`color: ${element.textColor} !important`);
        if (element.backgroundColor) comboStyles.push(`background-color: ${element.backgroundColor}`);
        if (element.borderColor) comboStyles.push(`border-color: ${element.borderColor}`);
        const comboStyleAttr = comboStyles.length > 0 ? `style="${comboStyles.join('; ')}"` : '';
        
        return `<div class="field-group" ${elementStyles}>
            <div class="combo-field ${layoutClass} ${sizeClass}" ${colorAttr} ${colorStyle} ${comboStyleAttr}>
                <div class="combo-label">${fieldName}</div>
                <div class="combo-score">10</div>
                <div class="combo-modifier">+0</div>
            </div>
            <div class="preview-info">Preview: ${previewText}</div>
        </div>`;
    }

    // Character sheet version - apply text color directly to combo-field
const value = getValue(element.scope);
const modifierScope = element.scope.replace('/properties/abilities/', '/properties/modifiers/');
const modifier = getValue(modifierScope);
const isReadOnly = instanceRef ? instanceRef.isReadOnly(element.scope) : false;

let comboStyles = [];	// Apply text color to the combo field itself
if (element.textColor) comboStyles.push(`color: ${element.textColor} !important`);
if (element.backgroundColor) comboStyles.push(`background-color: ${element.backgroundColor}`);
if (element.borderColor) comboStyles.push(`border-color: ${element.borderColor}`);
const comboStyleAttr = comboStyles.length > 0 ? `style="${comboStyles.join('; ')}"` : '';

let inputStyles = [];	// Also apply text color to individual inputs
if (element.textColor) inputStyles.push(`color: ${element.textColor} !important`);
const inputStyleAttr = inputStyles.length > 0 ? `style="${inputStyles.join('; ')}"` : '';

return `<div class="field-group">
    <div class="combo-field ${layoutClass} ${sizeClass}" ${colorAttr} ${colorStyle} ${comboStyleAttr}>
        <div class="combo-label" ${inputStyleAttr}>${fieldName}</div>
        <input class="combo-score" type="number" name="${element.scope}" value="${value || 10}" 
            ${viewMode ? 'readonly onclick="window.characterAppInstance.handleNumberClick(event, \'' + element.scope + '\')"' : ''} 
            onblur="window.characterAppInstance.updateValue(event, '${element.scope}')" 
            ${!viewMode ? 'oninput="window.characterAppInstance.updateValue(event, \'' + element.scope + '\')"' : ''} ${inputStyleAttr}>
        <input class="combo-modifier" type="text" value="${instanceRef ? instanceRef.formatValue(modifierScope, modifier) : modifier || '+0'}" readonly ${inputStyleAttr}>
    </div>
</div>`;
},
    
renderMultiStateToggle(element, context) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || this.generateFieldName(element.scope);
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
    const fieldName = element.label || this.generateFieldName(element.scope);
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
    const fieldName = element.label || this.generateFieldName(element.scope);
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
    const fieldName = element.label || this.generateFieldName(element.scope);
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

// Export for use in other files
if ( typeof window !== 'undefined' ) {
  window.Utils = Utils;
}