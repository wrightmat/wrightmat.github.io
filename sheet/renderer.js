// ===== ELEMENT RENDERER - Character Sheet and Template Rendering System =====
const ElementRenderer = {

  // Style cache for performance improvement
  _styleCache: new Map(),

  // ===== STYLING AND LAYOUT FUNCTIONS =====
  
  applyElementStyles( element, targetType = 'container' ) {
      const cacheKey = `${element.id || 'no-id'}-${targetType}-${element.backgroundColor || ''}-${element.borderColor || ''}-${element.textColor || ''}-${element.textSize || ''}-${element.textBold || ''}-${element.textItalic || ''}-${element.textUnderline || ''}`;
      let styles = [];
      let classes = [];

      if ( this._styleCache && this._styleCache.has(cacheKey) )  return this._styleCache.get(cacheKey);

      if ( targetType === 'container' ) {
          if ( element.backgroundColor )  styles.push(`background-color: ${element.backgroundColor}`);
          if ( element.borderColor )  styles.push(`border-color: ${element.borderColor}`);
          if ( element.textColor )  styles.push(`color: ${element.textColor}`);
          if ( element.textSize )  classes.push(`text-size-${element.textSize}`);
          if ( element.textBold )  classes.push('text-bold');
          if ( element.textItalic )  classes.push('text-italic');
          if ( element.textUnderline )  classes.push('text-underline');
      }
      // For individual element styles (pills, segments, etc.) - handled by specialized functions
      else if ( targetType === 'element' ) {
          const result = '';
          if ( this._styleCache )  this._styleCache.set(cacheKey, result);
          return result;
      }

      let result = '';
      if ( styles.length > 0 )  result += `style="${styles.join('; ')}"`;
      if ( classes.length > 0 ) {
          if ( result )  result += ' ';
          result += `class="${classes.join(' ')}"`;
      }
      if ( this._styleCache )  this._styleCache.set(cacheKey, result);
      return result;
  },
  
  
  // ===== GETTER FUNCTIONS =====
  
  getControlContainerStyles( element ) {
    const styles = [];
    if (element.width && element.width !== 'auto' && element.width !== '') {
        const widthValue = parseInt(element.width);
        if (!isNaN(widthValue) && widthValue > 0) {
            styles.push(`width: ${widthValue}px`);
        }
    }
    return styles.length > 0 ? `style="${styles.join('; ')}"` : '';
  },
  
  getControlLayoutClasses( element ) {
    const classes = [];
    if ( element.layout ) classes.push(`control-layout-${element.layout}`);
    if ( element.labelPosition ) classes.push(`label-position-${element.labelPosition}`);
    if ( element.inputAlignment ) classes.push(`input-align-${element.inputAlignment}`);
    return classes.join(' ');
  },
  
  getElementColors( element, state = 'default' ) {
    const bgColor = element.backgroundColor;
    const borderColor = element.borderColor;
    const textColor = element.textColor;
    let styles = [];

    switch ( state ) {
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
  
  getPreviewArrayItems( displayStyle ) {
    switch ( displayStyle ) {
        case 'cards':
            return [
                { name: 'Sample Card 1', description: 'Card description' },
                { name: 'Sample Card 2', description: 'Another description' }
            ];
        case 'compact':
            return [
                { name: 'Sample Item 1', quantity: 2 },
                { name: 'Sample Item 2', quantity: 1 },
                { name: 'Sample Item 3', quantity: 3 }
            ];
        default:
            return [
                { name: 'Sample Item', quantity: 1, weight: 2.5, description: 'Description here' },
                { name: 'Another Item', quantity: 3, weight: 1.2, description: 'More info' }
            ];
    }
  },
  
  getPreviewValue( controlType ) {
    switch ( controlType ) {
        case 'text': return 'Sample Text';
        case 'number': return '42';
        case 'textarea': return 'Sample multiline text\nSecond line here';
        case 'date': return '2024-01-15';
        case 'select': return 'Option 1';
        case 'checkbox': return true;
        default: return 'Preview';
    }
  },
  
  getSchemaOptions( optionsSource, schema ) {
    const fieldPath = optionsSource.substring(1);
    const pathParts = fieldPath.split('.');
    let current = schema;
    for (const part of pathParts) {
        current = current?.properties?.[part];
        if (!current) break;
    }
    return current?.enum || [];
  },
  
  getSelectOptions( element, instanceRef ) {
    let options = [];
    if ( element.optionsSource ) {
        if ( element.optionsSource.trim().startsWith('[') && element.optionsSource.trim().endsWith(']') ) {
            try {
                options = JSON.parse(element.optionsSource);
            } catch (e) {
                console.warn('Error parsing static options:', e);
                options = [];
            }
        }
        else if ( element.optionsSource.startsWith('@') && instanceRef ) {
            const schema = instanceRef.schemas ? instanceRef.schemas[instanceRef.selectedSchemaId] : null;
            if ( schema ) {
                options = this.getSchemaOptions(element.optionsSource, schema);
            }
        }
    }
    return options;
  },


  // ===== MAIN RENDER FUNCTIONS =====

  renderElement( element, context = {} ) {
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
    
    if ( isPreview ) {
        const selectedClass = isSelected ? 'selected' : '';
        const previewControls = `
            <div class="element-controls">
                <button class="control-btn tooltip" data-tooltip="Duplicate" onclick="event.stopPropagation(); window.editorInstance.duplicateElement('${elementId}')">📋</button>
                <button class="control-btn delete tooltip" data-tooltip="Delete" onclick="event.stopPropagation(); window.editorInstance.deleteElement('${elementId}')">×</button>
            </div>`;
        const clickHandler = `onclick="event.stopPropagation(); window.editorInstance.selectElement('${elementId}')"`;
        const scopeIndicator = element.scope ? `<div class="scope-indicator">Scope: ${element.scope}</div>` : '';
        const content = this.renderElementContent(element, context);
        return `<div class="form-element canvas-element ${selectedClass}" data-element-id="${elementId}" ${clickHandler}>
            ${previewControls}
            ${scopeIndicator}
            ${content}
        </div>`;
    }
    return this.renderElementContent(element, context);
  },

  renderElementContent( element, context ) {
    switch ( element.type ) {
        case 'Control':		return this.renderControl(element, context);
        case 'Label':		return this.renderLabel(element, context);
        case 'Group':		return this.renderContainer(element, context);
        case 'Container':	return this.renderContainer(element, context);
	case 'Tabs':		return this.renderTabs(element, context);
        case 'Array':		return this.renderArray(element, context);
        case 'LinearTrack':	return this.renderLinearTrack(element, context);
        case 'CircularTrack':	return this.renderCircularTrack(element, context);
        case 'MultiStateToggle':return this.renderMultiStateToggle(element, context);
        case 'SelectGroup':	return this.renderSelectGroup(element, context);
        case 'Divider':		return this.renderDivider(element, context);
        case 'Image':		return this.renderImage(element, context);
        default:		return `<div class="unknown-element">Unknown element type: ${element.type}</div>`;
    }
  },


  // ===== ELEMENT-SPECIFIC RENDER FUNCTIONS =====

  renderArray( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const elementStyles = this.applyElementStyles(element);
    const displayStyle = element.displayStyle || 'table';
    const allowAdd = element.allowAdd !== false && !viewMode && !isPreview;
    const allowRemove = element.allowRemove !== false && !viewMode && !isPreview;
    const allowReorder = element.allowReorder !== false && !viewMode && !isPreview;
    const items = isPreview ? this.getPreviewArrayItems(displayStyle) : (getValue(element.scope) || []);
    const arrayId = `array_${element.id || 'unknown'}`;
    
    let content = `<div class="field-group" ${elementStyles}>
        <div class="array-header-section">
            <label class="field-label">${element.label || 'Array Field'}</label>`;
    
    if ( allowAdd ) content += `<button class="btn btn-secondary btn-small" onclick="window.characterAppInstance.addArrayItem('${element.scope}', '${arrayId}')">➕ Add Item</button>`;
    content += `</div>
        <div class="array-container array-style-${displayStyle}" id="${arrayId}" data-scope="${element.scope}" data-allow-reorder="${allowReorder}">`;
    
    if ( items.length === 0 ) {
        content += isPreview ? '<div class="array-empty">Preview: No items to display</div>' : '<div class="array-empty">No items</div>';
    } else {
        content += this.renderArrayItems(items, element, isPreview, viewMode, allowRemove, allowReorder);
    }
    
    content += '</div></div>';
    return content;
  },

  renderArrayCards( items, element, viewMode, allowRemove, allowReorder ) {
    let content = '<div class="array-cards">';
    
    items.forEach((item, index) => {        
        content += `<div class="array-card data-index="${index}">
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
                        class="form-control array-input">
                </div>
                <div class="array-card-row">
                    <label>Description:</label>
                    <textarea value="${item.description || ''}" ${viewMode ? 'readonly' : ''} 
                        onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'description')" 
                        class="form-control array-input">${item.description || ''}</textarea>
                </div>
            </div>
        </div>`;
    });
    
    content += '</div>';
    return content;
  },

  renderArrayCompact( items, element, viewMode, allowRemove, allowReorder ) {
    let content = '<div class="array-compact">';
    
    items.forEach((item, index) => {        
        content += `<div class="array-compact-row data-index="${index}">
            ${allowReorder ? '<div class="array-drag-handle">⋮⋮</div>' : ''}
            <input type="text" value="${item.name || ''}" ${viewMode ? 'readonly' : ''} 
                onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'name')" 
                class="form-control array-input array-name-input" placeholder="Item name">
            <input type="number" value="${item.quantity || 0}" ${viewMode ? 'readonly' : ''} 
                onblur="window.characterAppInstance.updateArrayValue(event, '${element.scope}', ${index}, 'quantity')" 
                class="form-control array-input array-quantity-input" title="Quantity">
            ${allowRemove ? `<button class="btn btn-danger btn-small" onclick="window.characterAppInstance.removeArrayItem('${element.scope}', ${index})" title="Remove Item">×</button>` : ''}
        </div>`;
    });
    
    content += '</div>';
    return content;
  },
  
  renderArrayItems( items, element, isPreview, viewMode, allowRemove, allowReorder ) {
    const displayStyle = element.displayStyle || 'table';
    
    switch ( displayStyle ) {
        case 'cards':
            return this.renderArrayCards(items, element, isPreview, viewMode, allowRemove, allowReorder);
        case 'compact':
            return this.renderArrayCompact(items, element, isPreview, viewMode, allowRemove, allowReorder);
        default:
            return this.renderArrayTable(items, element, viewMode, allowRemove, allowReorder);
    }
  },

  renderArrayTable( items, element, viewMode, allowRemove, allowReorder ) {
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
        content += `<div class="array-table-row data-index="${index}">
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
  
  renderControl( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const controlType = element.controlType || 'text';
    const elementStyles = this.applyElementStyles(element);
    const labelPosition = element.labelPosition || 'above';
    const labelAlignment = element.labelAlignment || 'left';
    const textAlignment = element.textAlignment || 'left';
    const inputAlignment = element.inputAlignment || 'left';
    const layout = element.layout || 'vertical';
    const width = element.width || 'auto';
    const value = isPreview ? this.getPreviewValue(controlType) : ( getValue(element.scope) !== null && getValue(element.scope) !== undefined ? getValue(element.scope) : '' );
    const isReadOnly = isPreview || element.readOnly === true;
    const isInteractive = !isPreview && !viewMode && !isReadOnly;
    const layoutClasses = this.getControlLayoutClasses(element);
    const containerStyles = this.getControlContainerStyles(element);
    const content = `<div class="field-group ${layoutClasses}" ${elementStyles} ${containerStyles}>
        ${labelPosition === 'above' || labelPosition === 'below' ? 
            `${labelPosition === 'above' && controlType !== 'checkbox' && fieldName ? this.renderControlLabel(fieldName, labelAlignment) : ''}
             ${this.renderControlInput(element, context, value, isInteractive)}
             ${labelPosition === 'below' && controlType !== 'checkbox' && fieldName ? this.renderControlLabel(fieldName, labelAlignment) : ''}` :
            `<div class="control-horizontal-container">
                ${labelPosition === 'left' && controlType !== 'checkbox' && fieldName ? this.renderControlLabel(fieldName, labelAlignment, 'horizontal-label') : ''}
                ${this.renderControlInput(element, context, value, isInteractive)}
                ${labelPosition === 'right' && controlType !== 'checkbox' && fieldName ? this.renderControlLabel(fieldName, labelAlignment, 'horizontal-label') : ''}
             </div>`
        }
    </div>`;
    return content;
  },
  
  renderControlInput( element, context, value, isInteractive ) {
    const { isPreview = false, viewMode = false, instanceRef = null } = context;
    const controlType = element.controlType || 'text';
    const fieldName = element.label || '';
    const textAlignment = element.textAlignment || 'left';
    const elementStyles = this.applyElementStyles(element, 'container');
    
    let inputStyles = [];
    if ( element.textColor ) inputStyles.push(`color: ${element.textColor}`);
    if ( element.backgroundColor ) inputStyles.push(`background-color: ${element.backgroundColor}`);
    if ( element.borderColor ) inputStyles.push(`border-color: ${element.borderColor}`);
    if ( textAlignment !== 'left' ) inputStyles.push(`text-align: ${textAlignment}`);
    const inputStyleAttr = inputStyles.length > 0 ? ` style="${inputStyles.join('; ')}"` : '';
    const nameAttr = element.scope ? `name="${element.scope}"` : '';
    const readonlyAttr = (!isInteractive || viewMode) ? 'readonly' : '';
    const disabledAttr = isPreview ? 'disabled' : '';
    const focusHandler = ''//!isPreview ? `onfocus="window.characterAppInstance.handleFocus(this)"` : '';
    const blurHandler = !isPreview ? `onblur="window.characterAppInstance.updateValue(event, '${element.scope}')"` : '';
    const changeHandler = !isPreview ? `onchange="window.characterAppInstance.updateValue(event, '${element.scope}')"` : '';
    const numberClickHandler = controlType === 'number' && !isPreview ? `onclick="this.select()"` : '';
    const textAlignClass = textAlignment !== 'left' ? ` text-${textAlignment}` : '';
    const textSizeClass = element.textSize ? ` text-${element.textSize}` : '';
    const textStyleClass = element.textStyle ? ` text-${element.textStyle}` : '';
    const wrapperStart = controlType === 'checkbox' ? `<label class="checkbox-wrapper">` : '';
    const wrapperEnd = controlType === 'checkbox' ? `<span class="checkbox-label">${fieldName}</span></label>` : '';

    switch ( controlType ) {
        case 'textarea':
            return `${wrapperStart}<textarea ${elementStyles} ${nameAttr} ${readonlyAttr} ${disabledAttr} ${focusHandler} ${blurHandler} ${changeHandler} class="form-control${textAlignClass}${textSizeClass}${textStyleClass}" ${inputStyleAttr}>${value}</textarea>${wrapperEnd}`;

        case 'select':
            const options = this.getSelectOptions(element, instanceRef);
            const optionTags = options.map(option => 
                `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`
            ).join('');
            return `${wrapperStart}<select ${nameAttr} ${readonlyAttr} ${disabledAttr} ${focusHandler} ${blurHandler} ${changeHandler} class="form-control${textAlignClass}${textSizeClass}${textStyleClass}" ${inputStyleAttr}>${optionTags}</select>${wrapperEnd}`;

        case 'checkbox':
            const checkedAttr = (value === true || value === 'true' || value === 'on') ? 'checked' : '';
            return `${wrapperStart}<input type="checkbox" ${nameAttr} ${checkedAttr} ${readonlyAttr} ${disabledAttr} ${focusHandler} ${blurHandler} ${changeHandler} class="form-control-check" ${inputStyleAttr}>${wrapperEnd}`;

        case 'date':
            const dateValue = value instanceof Date ? value.toISOString().split('T')[0] : (value !== null && value !== undefined ? value : '');
            return `${wrapperStart}<input type="date" ${elementStyles} ${nameAttr} value="${dateValue}" ${readonlyAttr} ${disabledAttr} ${focusHandler} ${blurHandler} ${changeHandler} class="form-control${textAlignClass}${textSizeClass}${textStyleClass}" ${inputStyleAttr}>${wrapperEnd}`;

        default:
            const displayValue = isPreview ? value : value;
            return `${wrapperStart}<input type="${controlType}" ${elementStyles} ${nameAttr} value="${displayValue}" ${readonlyAttr} ${disabledAttr} ${focusHandler} ${blurHandler} ${changeHandler} ${numberClickHandler} class="form-control${textAlignClass}${textSizeClass}${textStyleClass}" ${inputStyleAttr}>${wrapperEnd}`;
    }
  },

  renderControlLabel( fieldName, alignment, extraClass = '', element = {} ) {
    const alignClass = `label-align-${alignment}`;
    const elementStyles = this.applyElementStyles(element, 'container');
    return `<label class="field-label ${alignClass} ${extraClass}" ${elementStyles}>${fieldName}</label>`;
  },

  renderContainer(element, context) {
    let containerType;
    if ( element.type === 'Group' && element.layout === 'columns' ) {
        containerType = 'columns';
    } else {
        containerType = 'group';
    }
    
    // Common container setup
    const { isPreview = false, viewMode = false, instanceRef = null } = context;
    const elementStyles = this.applyElementStyles(element);
    const showLabel = element.label && containerType !== 'tabs';
    
    // Add helper classes for colored containers
    let extraClasses = '';
    if ( element.borderColor ) extraClasses += ' has-border';
    if ( element.backgroundColor ) extraClasses += ' has-background';
    
    let content = `<div class="field-group${extraClasses}" ${elementStyles}>`;
    
    // Add label (except for tabs which handle their own)
    if ( showLabel ) {
        const labelAlignment = element.labelAlignment || 'left';
        const labelAlignClass = labelAlignment !== 'left' ? ` group-label-align-${labelAlignment}` : '';
        content += `<div class="group-label${labelAlignClass}">${element.label}</div>`;
    }
    
    switch ( containerType ) {
        case 'columns':
            content += this.renderContainerColumns(element, context);
            break;
        default: // 'group'
            content += this.renderContainerGroup(element, context);
            break;
    }
    content += '</div>';
    return content;
  },

  renderContainerGroup( element, context ) {
    const { isPreview = false } = context;
    const layout = element.layout || 'vertical';
    const isCollapsible = element.collapsible === true;
    const defaultCollapsed = element.defaultCollapsed === 'collapsed';
    const groupId = `group_${element.id || Math.random().toString(36).substr(2, 9)}`;
    const gap = element.gap || 'medium';
    
    // Layout logic
    const layoutClass = layout === 'grid' ? 'grid-layout' : 
                       layout === 'horizontal' ? 'horizontal-layout' : 
                       layout === 'combo-row' ? 'combo-row-layout' :
                       layout === 'combo-compact' ? 'combo-compact-layout' :
                       'vertical-layout';
    const gapClass = `group-gap-${gap}`;
    
    // Content alignment
    const contentAlignment = element.contentAlignment || 'left';
    const contentAlignClass = contentAlignment !== 'left' ? ` group-content-align-${contentAlignment}` : '';
    const finalLayoutClass = `${layoutClass}${contentAlignClass}`;
    
    let content = '';
    
    // Add collapsible wrapper if needed
    if ( isCollapsible ) {
        const clickHandler = !isPreview ? `onclick="window.characterAppInstance.toggleGroup('${groupId}')"` : '';
        content += `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content" ${clickHandler}>`;
    }
    
    // Render group content
    if  ( isPreview ) {
        const groupElements = element.elements ? element.elements.map((el, i) => {
            return `<div class="element-wrapper group-element-wrapper" data-element-index="${i}">
                        <div class="drag-placeholder"></div>
                        ${this.renderElement(el, context)}
                    </div>`;
        }).join('') : '';
        
        content += `<div class="drop-zone group-drop-zone ${finalLayoutClass} ${gapClass}" 
                         data-container-id="${element.id}"
                         data-container-type="group"
                         ondragover="event.preventDefault(); event.stopPropagation();"
                         ondrop="event.preventDefault(); event.stopPropagation();">
                        ${groupElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                        <div class="drag-placeholder final-placeholder"></div>
                    </div>`;
    } else {
        content += `<div class="${finalLayoutClass} ${gapClass}">`;
        (element.elements || []).forEach(sub => {
            content += this.renderElement(sub, context);
        });
        content += '</div>';
    }
    
    if ( isCollapsible ) content += '</div>';
    return content;
  },

  renderContainerColumns( element, context ) {
    const { isPreview = false } = context;
    const columns = element.columns || 2;
    const gap = element.gap || 'medium';
    const isCollapsible = element.collapsible === true;
    const defaultCollapsed = element.defaultCollapsed === 'collapsed';
    const groupId = `group_${element.id || Math.random().toString(36).substr(2, 9)}`;
    
    let content = '';
    
    // Add collapsible wrapper if needed
    if ( isCollapsible ) {
        const clickHandler = !isPreview ? `onclick="window.characterAppInstance.toggleGroup('${groupId}')"` : '';
        content += `<div class="group-content ${defaultCollapsed ? 'collapsed' : ''}" id="${groupId}-content" ${clickHandler}>`;
    }
    
    content += `<div class="container-wrapper container-columns container-cols-${columns} gap-${gap}">`;
    
    for ( let i = 0; i < columns; i++ ) {
        if ( isPreview ) {
            const columnArray = (element.elements && Array.isArray(element.elements[i])) ? element.elements[i] : [];
            const columnElements = columnArray.map((el, j) => {
                return `<div class="element-wrapper container-element-wrapper" data-element-index="${j}">
                            <div class="drag-placeholder"></div>
                            ${this.renderElement(el, context)}
                        </div>`;
            }).join('');
            
            content += `<div class="container-column drop-zone" 
                             data-container-id="${element.id}" 
                             data-sub-index="${i}"
                             data-container-type="container-column"
                             ondragover="event.preventDefault(); event.stopPropagation();"
                             ondrop="event.preventDefault(); event.stopPropagation();">
                            <div class="container-column-header">Column ${i + 1}</div>
                            <div class="container-column-content">
                                ${columnElements || '<div class="drop-zone-empty">Drop elements here</div>'}
                                <div class="drag-placeholder final-placeholder"></div>
                            </div>
                        </div>`;
        } else {
            content += `<div class="container-column">`;
            if (element.elements && element.elements[i]) {
                element.elements[i].forEach(sub => {
                    content += this.renderElement(sub, context);
                });
            }
            content += '</div>';
        }
    }
    
    content += '</div>';
    if ( isCollapsible ) content += '</div>';
    return content;
  },

  renderTabs( element, context ) {
    const { isPreview = false } = context;
    const editorInstance = window.editorInstance;
    const characterInstance = window.characterAppInstance;
    const elementStyles = this.applyElementStyles(element);
    let activeTabIndex = 0;

    if ( editorInstance && editorInstance.activeTabStates !== undefined ) {
	activeTabIndex = isPreview && window.editorInstance ? (window.editorInstance.activeTabStates[element.id] || 0) : 0;
    } else if ( characterInstance && characterInstance.activeTabStates !== undefined ) {
	activeTabIndex = isPreview && window.editorInstance ? (window.characterInstance.activeTabStates[element.id] || 0) : 0;
    } else { console.error('No valid app instance found for tab switching'); }
    const elementId = element.id || 'unknown';
    let content = `<div class="tabs-container" data-element-id="${elementId}" ${elementStyles}>`;
    
    // Tab headers
    content += `<div class="tab-headers">`;
    element.elements.forEach((tab, index) => {
        const isActive = index === activeTabIndex;
        content += `<div class="tab-header ${isActive ? 'active' : ''}" 
                         data-tab-index="${index}"
                         onclick="Utils.switchTab('${element.id}', ${index})"
            ${isPreview ? ` ondblclick="window.editorInstance.handleTabRename('${element.id}', ${index})"` : '' }>
            ${tab.label || `Tab ${index + 1}`}
            ${isPreview ? `<button class="tab-close-btn" onclick="event.stopPropagation(); window.editorInstance.removeTab('${element.id}', ${index})">×</button>` : ''}
        </div>`;
    });
    
    if ( isPreview )  content += `<button class="add-tab-btn" onclick="window.editorInstance.addTab('${element.id}')">+ Add Tab</button>`;
    content += `</div>`;
    
    // Tab contents
    content += `<div class="tab-contents">`;
    element.elements.forEach((tab, index) => {
        const isActive = index === activeTabIndex;
        content += `<div class="tab-content ${isActive ? 'active' : ''}" data-tab-index="${index}">`;
        
        if ( isPreview ) {
            // Template editor - add drop zone
            content += `<div class="drop-zone tab-drop-zone" 
                             data-container-id="${element.id}" 
                             data-tab-index="${index}"
                             data-container-type="tab">`;
            
            if ( tab.elements && tab.elements.length > 0 ) {
                tab.elements.forEach(childElement => {
                    content += this.renderElement(childElement, context);
                });
            } else {
                content += `<div class="drop-zone-empty">Drop elements here for ${tab.label}</div>`;
            }
            content += `</div>`;
        } else {
            if ( tab.elements ) {
                tab.elements.forEach(childElement => {
                    content += this.renderElement(childElement, context);
                });
            }
        }
        content += `</div>`;
    });
    content += `</div>`;
    content += `</div>`;
    return content;
  },

  renderDivider( element, context ) {
    const { isPreview = false } = context;
    const elementStyles = this.applyElementStyles(element);
        
    return `<div class="field-group" ${elementStyles}>
        <hr class="divider-line">
    </div>`;
  },

  renderImage( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const elementStyles = this.applyElementStyles(element);
    const imageSrc = isPreview ? 'https://via.placeholder.com/200x150/cccccc/666666?text=Image+Preview' : (getValue(element.scope) || element.defaultSrc || '');
    const altText = element.altText || 'Image';
    const width = element.width || 'auto';
    const height = element.height || 'auto';
    const alignment = element.alignment || 'left';
    const imageStyles = [];
    if (width !== 'auto') imageStyles.push(`width: ${width}px`);
    if (height !== 'auto') imageStyles.push(`height: ${height}px`);
    if (element.borderColor) imageStyles.push(`border: 2px solid ${element.borderColor}`);
    const imageStyleAttr = imageStyles.length > 0 ? ` style="${imageStyles.join('; ')}"` : '';
    const alignClass = alignment !== 'left' ? ` image-align-${alignment}` : '';
   
    let content = `<div class="field-group image-container${alignClass}" ${elementStyles}>`;
    if (element.label) {
       content += `<label class="field-label">${element.label}</label>`;
    }
   
    if ( imageSrc ) {
       content += `<img src="${imageSrc}" alt="${altText}" class="form-image" ${imageStyleAttr}>`;
    } else if (!isPreview) {
       content += `<div class="image-placeholder" ${imageStyleAttr}>
           <span class="placeholder-text">No image selected</span>
       </div>`;
    }
   
    content += '</div>';
    return content;
  },
  
  renderLabel( element, context ) {
    const { isPreview = false } = context;
    const elementStyles = this.applyElementStyles(element);
    const text = element.text || element.label || 'Label Text';
    const alignment = element.alignment || 'left';
    const textSize = element.textSize || 'medium';
    const textStyle = element.textStyle || 'normal';
    const htmlTag = element.htmlTag || 'div';
    const alignClass = alignment !== 'left' ? ` text-${alignment}` : '';
    const sizeClass = textSize !== 'medium' ? ` text-${textSize}` : '';
    const styleClass = textStyle !== 'normal' ? ` text-${textStyle}` : '';
   
    return `<${htmlTag} class="field-label label-element${alignClass}${sizeClass}${styleClass}" ${elementStyles}>
       ${text}
    </${htmlTag}>`;
  },

  renderMultiStateToggle( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const states = element.states || 2;
    const shape = element.shape || 'circle';
    const size = element.size || 'medium';
    const labelPosition = element.labelPosition || 'right';
    const toggleId = `toggle_${element.id || 'unknown'}`;
    const colorStyle = this.generateColorVariations(element.backgroundColor);
    const colorAttr = element.backgroundColor ? 'data-color="true"' : '';
    const labelClass = `label-${labelPosition}`;
    const sizeClass = size !== 'medium' ? size : '';
    const shapeClass = shape !== 'circle' ? shape : '';
    
    if ( isPreview ) {
        const previewText = element.scope || 'No field selected';
        const toggleColors = this.getElementColors(element, 'selected');
        return `<div class="field-group">
            <div class="multi-state-toggle ${labelClass}">
                <div class="multi-state-control ${shapeClass} ${sizeClass} state-1" style="${toggleColors}" ${colorAttr}></div>
                <div class="multi-state-label">${fieldName}</div>
                <div class="preview-info">(${states} states)</div>
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

  renderSelectGroup( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const selectionType = element.selectionType || 'multi';
    const displayMode = element.displayMode || 'all';
    const style = element.style || 'pills';
    const colorStyle = this.generateColorVariations(element.backgroundColor);
    const colorAttr = element.backgroundColor ? 'data-color="true"' : '';
    const styleClass = `style-${style}`;
    const modeClass = `mode-${displayMode}`;
    
    if ( isPreview ) {
        const previewText = element.scope || 'No field selected';
        const selectedColors = this.getElementColors(element, 'selected');
        const unselectedColors = this.getElementColors(element, 'unselected');
        
        return `<div class="field-group">
            <label class="field-label">${fieldName}</label>
            <div class="select-group ${styleClass} ${modeClass}" ${colorAttr} ${colorStyle}>
                <div class="select-group-option selected" style="${selectedColors}">Selected Item</div>
                <div class="select-group-option unselected" style="${unselectedColors}">Available Item</div>
            </div>
            <div class="preview-info">(${selectionType} select)</div>
        </div>`;
    }
    
    let scopeForGet = element.scope;
    if (scopeForGet && !scopeForGet.startsWith('@'))  scopeForGet = '@' + scopeForGet;
    const selectedValues = getValue(scopeForGet) || (selectionType === 'single' ? '' : []);
    
    // Get options using the new unified approach
    let options = [];
    if ( element.optionsSource ) {
        // Check if it's a static array like ["Option 1", "Option 2"]
        if (element.optionsSource.trim().startsWith('[') && element.optionsSource.trim().endsWith(']')) {
            try {
                options = JSON.parse(element.optionsSource);
            } catch (e) {
                console.warn('Error parsing static options:', e);
                options = [];
            }
        }
        // Handle @field.path format
        else if (element.optionsSource.startsWith('@') && instanceRef) {
            const schema = instanceRef.schemas ? instanceRef.schemas[instanceRef.selectedSchemaId] : null;
            if (schema)  options = this.getSchemaOptions(element.optionsSource, schema);
        }
    }
    let optionsHtml = '';
    options.forEach(option => {
	const isSelected = (() => {
	    if ( selectionType === 'single' ) {	        // For single select, handle both string and array formats
	        if (Array.isArray(selectedValues))  return selectedValues.includes(option);
	        return selectedValues === option;
	    } else {	        			// For multi select, handle both string and array formats
	        if (Array.isArray(selectedValues))  return selectedValues.includes(option);
	        return selectedValues === option;
	    }
	})();
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

  renderCircularTrack( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const segments = element.segments || 6;
    const showCounter = element.showCounter !== false;
    const trackId = `clock_${element.id || 'unknown'}`;
    
    const value = getValue(element.scope) || 0;
    let segmentsHtml = '';
    const centerX = 50;
    const centerY = 50;
    const radius = 35;
    
    for ( let i = 0; i < segments; i++ ) {
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

  renderLinearTrack( element, context ) {
    const { isPreview = false, viewMode = false, getValue = () => '', instanceRef = null } = context;
    const fieldName = element.label || '';
    const segments = element.segments || 6;
    const showCounter = element.showCounter !== false;
    const trackId = `track_${element.id || 'unknown'}`;
    
    const value = getValue(element.scope) || 0;
    let segmentsHtml = '';
    for ( let i = 0; i < segments; i++ ) {
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


  // Miscellaneous functions
  generateColorVariations( color ) {
    if ( !color || color === '#ffffff' ) return '';
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
  }

};