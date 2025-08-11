class TemplateEditor {
    constructor() {
        this.schemas = {};
        this.templates = {};
        this.currentTemplate = null;
        this.selectedElementId = null;
        this.selectedSchemaId = '';
        this.selectedTemplateId = '';
        this.isModified = false;
        this.undoManager = new Utils.UndoRedoManager();
        this.sortables = {};
	this.activeTabStates = {};
        this.leftPaneCollapsed = false;
        this.rightPaneCollapsed = false;
        this.init();

	this.property_definitions = {
	    controlType: { type: 'select', label: 'Control Type', group: 'general',
	        options: [
	            { value: 'text', label: 'Text' },
	            { value: 'number', label: 'Number' },
	            { value: 'select', label: 'Select' }
	        ]
	    },
	    scope: { type: 'text', label: 'Scope', group: 'general', hasAutocomplete: true },
	    label: { type: 'text', label: 'Label', group: 'general' },
	    optionsSource: { type: 'text', label: 'Options Source', group: 'general', hasAutocomplete: true },
	    backgroundColor: { type: 'color', label: 'Background Color', group: 'appearance',
		presets: [
	            { name: 'Default', value: '', isDefault: true },
	            { name: 'White', value: '#ffffff' },
	            { name: 'Light Gray', value: '#f8fafc' },
	            { name: 'Blue', value: '#3b82f6' },
	            { name: 'Green', value: '#059669' },
	            { name: 'Red', value: '#dc2626' },
	            { name: 'Orange', value: '#d97706' },
	            { name: 'Purple', value: '#7c3aed' },
	            { name: 'Yellow', value: '#eab308' },
	            { name: 'Teal', value: '#0d9488' }
		]
 	    },
	    borderColor: { type: 'color', label: 'Border Color', group: 'appearance',
		presets: [
	            { name: 'Default', value: '', isDefault: true },
	            { name: 'White', value: '#ffffff' },
	            { name: 'Light Gray', value: '#f8fafc' },
	            { name: 'Blue', value: '#3b82f6' },
	            { name: 'Green', value: '#059669' },
	            { name: 'Red', value: '#dc2626' },
	            { name: 'Orange', value: '#d97706' },
	            { name: 'Purple', value: '#7c3aed' },
	            { name: 'Yellow', value: '#eab308' },
	            { name: 'Teal', value: '#0d9488' }
		]
	    },
	    textColor: { type: 'color', label: 'Text Color', group: 'appearance',
		presets: [
	            { name: 'Default', value: '', isDefault: true },
	            { name: 'Black', value: '#000000' },
	            { name: 'Dark Gray', value: '#374151' },
	            { name: 'Blue', value: '#3b82f6' },
	            { name: 'Green', value: '#059669' },
	            { name: 'Red', value: '#dc2626' },
	            { name: 'Orange', value: '#d97706' },
	            { name: 'Purple', value: '#7c3aed' },
	            { name: 'Yellow', value: '#eab308' },
	            { name: 'Teal', value: '#0d9488' }
		]
	    },
	    textSize: { type: 'select', label: 'Text Size', group: 'typography',
	        options: [
	            { value: 'small', label: 'Small' },
	            { value: 'medium', label: 'Medium' },
	            { value: 'large', label: 'Large' },
	            { value: 'xlarge', label: 'Extra Large' }
	        ], default: 'medium' 
	    },
	    textAlignment: { type: 'select', label: 'Text Alignment', group: 'typography',
	        options: [
	            { value: 'left', label: 'Left' },
	            { value: 'center', label: 'Center' },
	            { value: 'right', label: 'Right' }
	        ], default: 'left'
	    },
	    textBold: { type: 'checkbox', label: 'Bold', group: 'typography' },
	    textItalic: { type: 'checkbox', label: 'Italic', group: 'typography' },
	    textUnderline: { type: 'checkbox', label: 'Underline', group: 'typography' },
	    width: { type: 'select', label: 'Width', group: 'layout',
	        options: [
	            { value: '', label: 'Auto' },
	            { value: 'full', label: 'Full Width' },
	            { value: 'half', label: 'Half Width' },
	            { value: 'third', label: 'Third Width' }
	        ]
	    },
	    layout: { type: 'select', label: 'Layout', group: 'layout',
	        options: [
	            { value: 'vertical', label: 'Vertical' },
	            { value: 'horizontal', label: 'Horizontal' },
	            { value: 'grid', label: 'Auto Grid' },
	            { value: 'compact', label: 'Compact' },
	            { value: 'compact-row', label: 'Compact Row' }
	        ]
	    },
	    readOnly: { type: 'checkbox', label: 'Read Only', group: 'other' },
	    columns: { type: 'number', label: 'Column Count', group: 'general', min: 1, max: 4 },
	    displayStyle: { type: 'select', label: 'Display Style', group: 'general',
	        options: [
	            { value: 'table', label: 'Table' },
	            { value: 'cards', label: 'Cards' },
	            { value: 'compact', label: 'Compact' }
	        ]
	    }
	}

	this.element_definitions = {
	    'Basic Elements': [
	        {
	            type: 'Control', icon: '📝',
	            label: 'Input Control',
	            description: 'Text, number, or other input controls',
	            defaults: { label: 'Input Field', controlType: 'text', scope: '' },
		    properties: ['controlType', 'scope', 'label', 'backgroundColor', 'textColor', 'textAlignment', 'textSize', 'textBold', 'width', 'layout', 'readOnly']
	        },
	        {
	            type: 'Array', icon: '📋',
	            label: 'Array/List',
	            description: 'Dynamic list of items',
	            defaults: { label: 'Item List', scope: '', displayStyle: 'table', allowAdd: true, allowRemove: true },
		    properties: ['scope', 'label', 'backgroundColor', 'width', 'displayStyle']
	        },
	        {
	            type: 'Divider', icon: '➖',
	            label: 'Divider',
	            description: 'Visual separator line',
	            defaults: { label: '' },
		    properties: ['backgroundColor']
	        },
	        {
	            type: 'Image', icon: '🖼️',
	            label: 'Image',
	            description: 'Image upload field',
	            defaults: { label: 'Image', scope: '', width: 150, height: 150, shape: 'square' },
		    properties: ['scope', 'label', 'backgroundColor', 'width', 'displayStyle']
	        },
	        {
	            type: 'Label', icon: '🏷️',
	            label: 'Label',
	            description: 'Text heading or title',
	            defaults: { label: 'Label' },
		    properties: ['label', 'textColor', 'textAlignment', 'textSize', 'textBold', 'textItalic', 'textUnderline']
	        }
	    ],
	    'Layout Elements': [
	        {
	            type: 'Container', icon: '📦',
	            label: 'Container',
	            description: 'Container for organizing elements',
	            defaults: { label: 'Group', layout: 'vertical', gap: 'medium', elements: [] },
		    properties: ['label', 'backgroundColor', 'borderColor', 'textAlignment', 'layout', 'width']
	        },
	        {
	            type: 'Tabs', icon: '📑',
	            label: 'Tabs',
	            description: 'Tab switcher for organizing elements',
	            defaults: { label: '', elements: [ { type: 'Tab', label: 'Tab 1', elements: [] } ] },
		    properties: ['label', 'backgroundColor', 'borderColor']
	        }
	    ],
	    'Advanced Elements': [
	        {
	            type: 'LinearTrack', icon: '▬',
	            label: 'Linear Track',
	            description: 'Progress bar with segments',
	            defaults: { label: 'Progress Track', scope: '', segments: 6, showCounter: true },
		    properties: ['scope', 'label', 'backgroundColor']
	        },
	        {
	            type: 'CircularTrack', icon: '⭕',
	            label: 'Circular Track',
	            description: 'Circular progress indicator',
	            defaults: { label: 'Circular Track', scope: '', segments: 8, showCounter: true },
		    properties: ['scope', 'label', 'backgroundColor']
	        },
	        {
	            type: 'MultiStateToggle', icon: '🔘',
	            label: 'Toggle',
	            description: 'Multi-state toggle button',
	            defaults: { label: 'Toggle', scope: '', states: 3, shape: 'circle', size: 'medium' },
		    properties: ['scope', 'label', 'backgroundColor']
	        },
	        {
	            type: 'SelectGroup', icon: '☑️',
	            label: 'Select Group',
	            description: 'Multiple choice selection',
	            defaults: { label: 'Select Group', scope: '', selectionType: 'multi', style: 'pills' },
		    properties: ['scope', 'label', 'backgroundColor']
	        }
	    ]
	};

    }

    async init() {
        await DataManager.loadAll();
        this.schemas = DataManager.getSchemas();
        this.setupEventListeners();
        this.renderSchemaOptions();
        this.renderPalette();
	this.initSortables();
        this.updateUI();
        window.editorInstance = this;
    }

    initializeFormulaInputs() {
        document.querySelectorAll('.scope-input').forEach(input => {
            const elementId = input.dataset.elementId;
            const property = input.dataset.property;
	    const formulaInput = new Utils.FormulaInput();
	    formulaInput.init(input, this.selectedSchemaId, (value) => {
		this.updateElementProperty(elementId, property, value);
	    });
        });
    }

    setupEventListeners() {
        // Toolbar controls
        document.getElementById('toggle-left-pane').addEventListener('click', () => Utils.togglePaneVisibility('editor-container', 'left', this) );
        document.getElementById('toggle-right-pane').addEventListener('click', () => Utils.togglePaneVisibility('editor-container', 'right', this) );
        document.getElementById('schema-select').addEventListener('change', (e) => this.selectSchema(e.target.value));
        document.getElementById('template-select').addEventListener('change', (e) => this.selectTemplate(e.target.value));
        document.getElementById('save-template-btn').addEventListener('click', () => this.saveTemplate());
	Utils.setPaneVisibility('editor-container', 'left', false, this); Utils.setPaneVisibility('editor-container', 'right', false, this);  // collapse by default

        // Canvas click handling for element selection
        document.getElementById('main-canvas').addEventListener('click', (e) => {
            const elementWrapper = e.target.closest('[data-element-id]');
            if ( elementWrapper ) {
                this.selectElement(elementWrapper.dataset.elementId);
            } else {
                this.selectElement(null);
            }
        });
    }


    //======== Render/Select UI Elements

    renderSchemaOptions() {
        Utils.populateSelect('schema-select', this.schemas, {
            emptyText: 'Select System...',
            sortKey: 'schemas'
        });
    }

    renderTemplateOptions() {
        const disabled = !this.selectedSchemaId;
        document.getElementById('template-select').disabled = disabled;
        if ( !this.selectedSchemaId ) return;

        const schema = DataManager.getSchema(this.selectedSchemaId);
        if ( !schema ) return;

        const templatesWithMetadata = DataManager.getTemplatesWithMetadata();
	const availableTemplates = templatesWithMetadata.filter(template => {
	    const metadata = template.metadata;
	    return metadata && metadata.schema === schema.index;
	});
        const templateOptions = {};
        availableTemplates.forEach(template => {
            const metadata = template.metadata;
            templateOptions[template.id] = { id: template.id, title: metadata ? metadata.title : template.title };
        });
        Utils.populateSelect('template-select', templateOptions, {
            emptyText: 'Select Template...',
            sortKey: 'templates',
            extraOptions: [{ value: '_new', text: '+ Create New Template' }]
        });
    }

    selectSchema( schemaId ) {
        this.selectedSchemaId = schemaId;
        this.templates = DataManager.getTemplates();
        this.renderTemplateOptions();
        this.updateUI();
    }

    selectTemplate( templateId ) {
        this.selectedTemplateId = templateId;
        this.loadTemplate();
	Utils.setPaneVisibility('editor-container', 'left', true, this);
    }

    addTab( tabsElementId ) {
        const tabsElement = Utils.findElementById(this.currentTemplate.elements, tabsElementId);
        if ( !tabsElement )  return;
    
        const newTabIndex = tabsElement.elements.length;
        const newTab = { id: Utils.generateId(), type: 'Tab', label: `Tab ${newTabIndex + 1}`, elements: [] };
    
        this.saveState('Add tab');
        tabsElement.elements.push(newTab);
        this.updateModified();
        this.updateTemplate();
    
        // Switch to the new tab and re-initialize sortables
        setTimeout(() => {
            Utils.switchTab(tabsElementId, newTabIndex, this);
            this.initSortables();
        }, 100);
    }

    removeTab( tabsElementId, tabIndex ) {
        const tabsElement = Utils.findElementById(this.currentTemplate.elements, tabsElementId);
        if ( !tabsElement || tabsElement.elements.length <= 1 ) {
            Utils.showNotification('Cannot remove the last tab', 'warning');
            return;
        }
    
        this.saveState('Remove tab');
        tabsElement.elements.splice(tabIndex, 1);
        this.updateModified();
        this.updateTemplate();
    
        setTimeout(() => {        // Switch to first tab after removal
            Utils.switchTab(tabsElementId, 0, this);
            this.initSortables();
        }, 100);
    }

    renameTab( tabsElementId, tabIndex, newName ) {
        const tabsElement = Utils.findElementById(this.currentTemplate.elements, tabsElementId);
        if ( !tabsElement || !tabsElement.elements[tabIndex] ) return;
        this.saveState('Rename tab');
        tabsElement.elements[tabIndex].label = newName || `Tab ${tabIndex + 1}`;
        this.updateModified();
        this.updateTemplate();
    }

    handleTabRename( tabsElementId, tabIndex ) {
        const editorInstance = window.editorInstance;
        const currentLabel = this.getCurrentTabLabel(tabsElementId, tabIndex);
        const newName = prompt('Enter new tab name:', currentLabel);
        if ( newName !== null && newName.trim() !== '' )  editorInstance.renameTab(tabsElementId, tabIndex, newName.trim());
    }

    getCurrentTabLabel( tabsElementId, tabIndex ) {
        const editorInstance = window.editorInstance;
        let tabsElement = null;
        tabsElement = Utils.findElementById(this.currentTemplate.elements, tabsElementId);
        return tabsElement && tabsElement.elements[tabIndex] ? tabsElement.elements[tabIndex].label : `Tab ${tabIndex + 1}`;
    }


    //============= Template Management Functions

    createNewTemplate() {
	const schema = DataManager.getSchema(this.selectedSchemaId);
        this.currentTemplate = {
            id: Utils.generateId('template'),
            title: 'New Template', 
            schema: schema ? schema.index : this.selectedSchemaId,
            type: 'VerticalLayout',
            elements: []
        };
        this.selectedElementId = null;
        this.activeTemplateTab = 0;
        this.updateTemplate();

    }

    loadTemplate() {
        if ( this.selectedTemplateId === '_new' ) {
            this.createNewTemplate();
            return;
        }
        if ( !this.selectedTemplateId ) {
            this.currentTemplate = null;
            this.selectedElementId = null;
            return;
        }
        const template = DataManager.getTemplate(this.selectedTemplateId);

        if ( template ) {
            this.currentTemplate = Utils.deepClone(template);
            this.selectedElementId = null;
            this.activeTemplateTab = 0;
            this.updateTemplate();
        }
	this.updateModified(false);
    }

    async saveTemplate() {
        if ( !this.currentTemplate ) {
            Utils.showNotification('No template to save', 'error');
            return;
        }
	const titleInput = document.getElementById('template-title-input');
	this.currentTemplate.title = titleInput ? titleInput.value.trim() : (this.currentTemplate.title || '');
	this.currentTemplate.schema = DataManager.getSchema(this.selectedSchemaId)?.index || this.selectedSchemaId;

        if ( !this.currentTemplate.title ) {
            Utils.showNotification('Template must have a title', 'error');
            return;
        }

        try {
            Utils.showNotification('Saving template...', 'info');
            const templateId = await DataManager.saveTemplate(this.currentTemplate);
            this.selectedTemplateId = templateId;
            Utils.showNotification(`Template saved successfully`, 'success');
        } catch ( error ) {
            Utils.showNotification(`Failed to save template: ${error.message}`, 'error');
            console.error('Save template error:', error);
        }
        this.updateModified(false);
    }


    //========== Render Components Functions

    renderTemplate( template, context ) {
        const header = document.getElementById('template-header');
        if ( !this.currentTemplate ) {
            header.innerHTML = '';
            return;
        }
        const metadata = DataManager.getTemplateMetadata(this.currentTemplate.id) || {};
        const currentTitle = metadata.title || this.currentTemplate.title || '';

        header.innerHTML = `
            <div class="template-header-content">
                <input type="text" class="template-title-input" value="${currentTitle}" placeholder="Template Title" id="template-title-input">
            </div>
        `;

        // Add title change listener
        document.getElementById('template-title-input').addEventListener('input', (e) => {
            this.currentTemplate.title = e.target.value;
            this.updateModified(true);
        });

        return template.elements.map( element => 
            ElementRenderer.renderElement( element, {
	    isPreview: true,
	    selectedElementId: this.selectedElementId,
	    getValue: () => '',
	    instanceRef: this
	}) ).join('');
    }

    renderPalette() {
        const paletteContent = document.querySelector('.palette-content');
        if ( !paletteContent ) return;

        // Clear existing element sections (keep template tools and history)
        const existingSections = paletteContent.querySelectorAll('.palette-section');
        existingSections.forEach( section => {
            const title = section.querySelector('.palette-section-title').textContent;
            if ( !title.includes('Template Tools') && !title.includes('History') )  section.remove();
        });

        // Add element sections at the beginning
        const templateToolsSection = paletteContent.querySelector('.palette-section');
        
        Object.entries(this.element_definitions).forEach(([categoryName, items]) => {
            const section = this.createPaletteSection(categoryName, items);
            paletteContent.insertBefore(section, templateToolsSection);
        });
    }

    createPaletteSection( categoryName, items ) {
        const section = document.createElement('div');
        section.className = 'palette-section';

        const title = document.createElement('h4');
        title.className = 'palette-section-title';
        title.textContent = categoryName;
        section.appendChild(title);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'palette-items';

        items.forEach(item => {
            const itemElement = this.createPaletteItem(item);
            itemsContainer.appendChild(itemElement);
        });

        section.appendChild(itemsContainer);
        return section;
    }

    createPaletteItem( item ) {
        const element = document.createElement('div');
        element.className = 'palette-item';
        element.dataset.elementType = item.type;
        element.title = item.description;

        // Store the full definition for easy access
        element._elementDefinition = item;

        const icon = document.createElement('div');
        icon.className = 'palette-item-icon';
        icon.textContent = item.icon;
        element.appendChild(icon);

        const label = document.createElement('div');
        label.className = 'palette-item-label';
        label.textContent = item.label;
        element.appendChild(label);

        return element;
    }


    //========== Drag and Drop with SortableJS

    initSortables() {
        document.querySelectorAll('.palette-items').forEach(container => {
            new Sortable(container, {
                group: { name: 'editor', pull: 'clone', put: false },
                sort: false,
                animation: 150
            });
        });
	const mainCanvas = document.getElementById('main-canvas');
	if ( mainCanvas && this.currentTemplate )  this.sortables.main = this.createSortable(mainCanvas, this.currentTemplate?.elements || []);
	document.querySelectorAll('.drop-zone').forEach(zone => {
	  const targetArray = this.getArrayForZone(zone);
	  this.createSortable(zone, targetArray);
	});
    }

    createElement( evt ) {
        const elementType = evt.item.dataset.elementType;
        if ( !elementType ) return null;

        // Find the element definition and create new element
        const definition = Utils.findElementDefinition(elementType, this.element_definitions);
        if ( !definition ) return null;

	const newElement = { id: Utils.generateId(), type: elementType, ...definition.defaults };

	// Special handling for Tabs - ensure nested tabs get unique IDs
	if ( evt.item.dataset.elementType === 'Tabs' && newElement.elements ) {
            newElement.elements = newElement.elements.map(tab => ({ ...tab, id: Utils.generateId(), elements: tab.elements || [] }));
	}
    
	// Handle other nested structures if they exist
	if ( newElement.elements && evt.item.dataset.elementType !== 'Tabs' )  newElement.elements = newElement.elements.map(el => this.createElement(el));
    
	return newElement;
    }

    createSortable( element, targetArray ) {
	if ( !this.currentTemplate ) return null;
        return Sortable.create(element, {
            group: 'editor',
            animation: 150,
            onAdd: (evt) => {
                this.saveState('Add element');
                const elementData = evt.item.dataset.elementType;
                if ( elementData ) {
                    // Adding from palette - create element HTML, add to template array, and remove dragged item
		    const newElement = this.createElement(evt);
	            targetArray.splice(evt.newIndex, 0, newElement);
		    evt.item.remove();
                } else {
                    // Moving existing element
                    this.handleElementMove(evt, targetArray);
                }
                this.updateModified();
                this.updateTemplate();
            },
            onUpdate: (evt) => {
                this.saveState('Reorder elements');
                const movedElement = targetArray.splice(evt.oldIndex, 1)[0];
                targetArray.splice(evt.newIndex, 0, movedElement);
                this.updateModified();
                this.updateTemplate();
            },
            onStart: (evt) => {
                if ( !evt.item.getAttribute('data-element') ) {
                    // Moving existing element - store its data
                    const elementId = this.getElementIdFromItem(evt.item);
                    evt.item.setAttribute('data-element-id', elementId);
                }
            }
        });
    }

    handleElementMove( evt, targetArray ) {
        const elementId = evt.item.getAttribute('data-element-id');
        if ( elementId ) {
            const element = Utils.findElementById(this.currentTemplate.elements, elementId);
            if ( element ) {
                this.removeElementFromAnywhere(elementId);
                targetArray.splice(evt.newIndex, 0, element);
                evt.item.remove();
            }
        }
    }


    //============== Miscellaneous

    getArrayForZone( zone ) {
        if ( zone.id === 'main-canvas' )  return this.currentTemplate.elements;

        // Tab drop zone - handle tabs specially
        if ( zone.classList.contains('tab-drop-zone') ) {
            const containerId = zone.getAttribute('data-container-id');
            const tabIndex = zone.getAttribute('data-tab-index');
        
            if ( containerId && tabIndex !== null ) {
                const tabsElement = Utils.findElementById(this.currentTemplate.elements, containerId);
                if ( tabsElement && tabsElement.elements ) {
                    const tab = tabsElement.elements[parseInt(tabIndex)];
                    if ( tab )  return tab.elements = tab.elements || [];
                }
            }
            return null;
        }
    
        // Regular container or group
        const containerId = zone.getAttribute('data-container-id');
        const subIndex = zone.getAttribute('data-sub-index');
    
        if ( containerId ) {
            const container = Utils.findElementById(this.currentTemplate.elements, containerId);
            if ( container ) {
                if (container.type === 'Container' && subIndex !== null) {
                    if ( !container.elements ) container.elements = [];
                    if ( !container.elements[parseInt(subIndex)] )  container.elements[parseInt(subIndex)] = [];
                    return container.elements[parseInt(subIndex)];
                } else {
                    return container.elements = container.elements || [];
                }
            }
        }
        return null;
    }

    removeElementFromAnywhere( elementId ) {
        const removeFromElements = (elements) => {
            for (let i = 0; i < elements.length; i++) {
                if (elements[i].id === elementId) {
                    elements.splice(i, 1);
                    return true;
                }
                if (elements[i].elements && removeFromElements(elements[i].elements))  return true;
            }
            return false;
        };
        if ( this.currentTemplate )  removeFromElements(this.currentTemplate.elements);
    }

    selectElement( elementId ) {
        this.selectedElementId = elementId;

        document.querySelectorAll('.canvas-element.selected').forEach(el => {
            el.classList.remove('selected');
        });
        if ( elementId ) {
            const element = document.querySelector(`[data-element-id="${elementId}"]`);
            if ( element )  element.classList.add('selected');
        }
        this.updatePropertiesPanel();
	Utils.setPaneVisibility('editor-container', 'right', true, this);
    }

    deleteElement( elementId ) {
        if ( !elementId ) return;
        this.saveState('Delete element');
        this.removeElementFromAnywhere(elementId);
        this.updateModified(true);
        this.updateTemplate();
        this.updateUI();
    }

    deleteSelectedElement() {
        if ( this.selectedElementId ) {
            this.saveState('Delete element');
            this.removeElementFromAnywhere(this.selectedElementId);
            this.selectedElementId = null;
            this.updateModified(true);
            this.updateTemplate();
            this.updateUI();
        }
    }

    duplicateElement( elementId ) {
        if ( !elementId ) return;
        this.saveState('Duplicate element');

        const element = Utils.findElementById(this.currentTemplate.elements, elementId);
        if ( !element ) return;

        const duplicate = Utils.deepClone(element);
        duplicate.id = Utils.generateId();

        if ( duplicate.label ) {
            duplicate.label = duplicate.label + ' Copy';
        } else {
            duplicate.label = (duplicate.type || 'Element') + ' Copy';
        }
        this.updateNestedIds(duplicate);
           
        const parentContainer = Utils.findElementParent(this.currentTemplate.elements, elementId);
        if ( parentContainer ) {
            parentContainer.push(duplicate);
        } else {
            this.currentTemplate.elements.push(duplicate);
        }
           
        this.updateModified();
        this.updateTemplate();
    }

    updateNestedIds( element ) {
        if ( element.elements ) {
            element.elements.forEach(child => {
                child.id = Utils.generateId();
                this.updateNestedIds(child);
            });
        }
    }

    
    //=========== Properties Pane

    updatePropertiesPanel() {
        const panel = document.getElementById('properties-panel');
        if ( !panel ) return;
    
        if ( !this.selectedElementId ) {
            panel.innerHTML = '<div class="empty-state-small">Select an element to edit properties</div>';
            return;
        }

        const element = Utils.findElementById(this.currentTemplate.elements, this.selectedElementId);
        if ( !element ) {
            panel.innerHTML = '<div class="empty-state-small">Element not found</div>';
            return;
        }

        // Get available fields for autocomplete
        const availableFields = this.selectedSchemaId ? DataManager.generateFieldPaths(this.selectedSchemaId) : [];
        panel.innerHTML = this.renderPropertiesPanel(element, availableFields);

	setTimeout(() => { this.initializeFormulaInputs(); }, 100);
    }

    updateElementProperty( elementId, propertyKey, value ) {
        const element = Utils.findElementById(this.currentTemplate.elements, elementId);
        if ( !element )  return;
    
        this.saveState(`Update ${propertyKey}`);
    
        // Convert string values to appropriate types
        if ( propertyKey === 'columns' ) {
            value = parseInt(value) || 2;
        } else if ( ['textBold', 'textItalic', 'textUnderline', 'readOnly'].includes(propertyKey) ) {
            value = Boolean(value);
        }
    
        element[propertyKey] = value;
	if ( propertyKey === 'controlType' && element.type === 'Control' ) {
            element.controlType = value;
	}

        this.updateModified();
        this.updateTemplate();

        // Re-initialize sortables if layout changed
        if (['layout', 'columns'].includes(propertyKey)) {
            setTimeout(() => { this.initSortables(); }, 100);
        }
    }

    renderPropertiesPanel( element, availableFields = [] ) {
        if ( !element )  return '<div class="empty-state-small">Select an element to edit properties</div>';
        let elementDefinition = null;
    
        // Get properties from element definition
        if ( this.element_definitions ) {
            for ( const category of Object.values(this.element_definitions) ) {
                elementDefinition = category.find(def => def.type === element.type);
                if ( elementDefinition )  break;
            }
        }
        let propertyNames = elementDefinition && elementDefinition.properties ? elementDefinition.properties : ['label'];
	// Add conditional properties based on element state
	if (element.type === 'Control' && element.controlType === 'select') {
	    propertyNames = [...propertyNames, 'optionsSource'];
	}

        // Group properties by their group
        const groupedProperties = {};
        propertyNames.forEach(propName => {
            const propDef = this.property_definitions[propName];
            if ( !propDef ) return;

            const groupName = propDef.group || 'other';
            if ( !groupedProperties[groupName] )  groupedProperties[groupName] = [];
            groupedProperties[groupName].push({ key: propName, ...propDef });
        });

        // Define group titles and order
        const groupTitles = {
            general: 'General',
            appearance: 'Appearance', 
            typography: 'Typography',
            layout: 'Layout',
            other: 'Other'
        };
        const groupOrder = ['general', 'appearance', 'typography', 'layout', 'other'];
        let html = '';

	// Add element type selector at the top
	html += `<div class="element-type-selector">
            <select id="element-type-select" class="form-control" disabled>`;
            Object.entries(this.element_definitions).forEach(([categoryName, elements]) => {
                html += `<optgroup label="${categoryName}">`;
                elements.forEach(elementDef => {
                    const selected = element.type === elementDef.type ? 'selected' : '';
                    html += `<option value="${elementDef.type}" ${selected}>${elementDef.label}</option>`;
                });
                html += '</optgroup>';
            });
        html += `</select></div>`;

	groupOrder.forEach(groupName => {
            const properties = groupedProperties[groupName];
            if ( !properties || properties.length === 0 ) return;

            // Check if any properties in this group have values set
            const hasSetValues = properties.some(prop => {
                const value = element[prop.key];
                return value !== undefined && value !== null && value !== '' && value !== false;
            });
            const isExpanded = hasSetValues;
            const expandedClass = isExpanded ? '' : 'collapsed';
            const groupId = `group-${groupName}-${element.id}`;

            html += `<div class="property-group ${expandedClass}">
            <div class="property-group-header" onclick="window.editorInstance.togglePropertyGroup('${groupId}')">
                <h4 class="property-group-title"> <span class="collapse-icon ${expandedClass}">▼</span> ${groupTitles[groupName]} </h4>
            </div>
            <div class="property-group-content" id="${groupId}">`;

            properties.forEach(property => {
                html += this.renderPropertyField(property, element, availableFields);
            });
            html += '</div></div>';
	});

        // Add actions section
        html += `<div class="palette-section">
            <h4 class="palette-section-title">Actions</h4>
            <button class="btn btn-secondary btn-full-width btn-with-margin" onclick="window.editorInstance.duplicateElement('${element.id}')">📋 Duplicate</button>
            <button class="btn btn-danger btn-full-width" onclick="window.editorInstance.deleteElement('${element.id}')">🗑️ Delete</button>
        </div>`;
    
        return html;
    }

    renderPropertyField( field, element, availableFields ) {
        const value = element[field.key] !== undefined ? element[field.key] : (field.default || '');
        const fieldId = `prop-${field.key}`;
        let fieldHtml = `<div class="property-field"><label for="${fieldId}">${field.label}</label>`;
    
        switch ( field.type ) {
            case 'text':
                if ( field.hasAutocomplete ) {
                    // Enhanced input with formula support
                    fieldHtml += `<input type="text" id="${fieldId}" value="${value}" 
                         class="form-control property-input scope-input" 
                         data-property="${field.key}"
                         data-element-id="${element.id}"
                         placeholder="Enter @field or formula...">`;
                } else {
                    // Regular text input
                    fieldHtml += `<input type="text" id="${fieldId}" value="${value}" 
                         class="form-control property-input" 
                         data-property="${field.key}"
                         onchange="window.editorInstance.updateElementProperty('${element.id}', '${field.key}', this.value)">`;
                }
                break;

            case 'color':
		const presets = field.presets || [];
		fieldHtml += `<div class="color-enhanced-field"><div class="color-presets">`;

		// Render preset color buttons
		const maxPresets = Math.min(9, presets.length);
		for ( let i = 0; i < maxPresets; i++ ) {
		    const preset = presets[i];
		    const isSelected = value === preset.value;
		    const isDefault = preset.isDefault;
		    const bgStyle = preset.value ? `background-color: ${preset.value}` : 'background: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 8px 8px; background-position: 0 0, 0 4px, 4px -4px, -4px 0px;';
        
		    fieldHtml += `<button type="button" 
                        class="color-preset-btn ${isSelected ? 'selected' : ''} ${isDefault ? 'default' : ''}"
                        style="${bgStyle}"
                        title="${preset.name}"
                        onclick="window.editorInstance.updateElementProperty('${element.id}', '${field.key}', '${preset.value}')">
			${isDefault ? '×' : ''}
		    </button>`;
		};

		const customSelected = value && !presets.some(p => p.value === value);
		fieldHtml += `<label class="color-preset-btn custom-color-btn ${customSelected ? 'selected' : ''}" title="Custom Color">
		    <input type="color" value="${value || '#ffffff'}" class="color-picker-input" onchange="window.editorInstance.updateElementProperty('${element.id}', '${field.key}', this.value)">
		    <span class="color-picker-icon">🎨</span>
		</label>`;
		fieldHtml += `</div></div>`;
                break;

            case 'select':
                fieldHtml += `<select id="${fieldId}" class="form-control property-input" 
                         data-property="${field.key}"
                         onchange="window.editorInstance.updateElementProperty('${element.id}', '${field.key}', this.value)">`;
                field.options.forEach(option => {
                    const selected = value === option.value ? 'selected' : '';
                    fieldHtml += `<option value="${option.value}" ${selected}>${option.label}</option>`;
                });
                fieldHtml += '</select>';
                break;
            
            case 'checkbox':
                const checked = value ? 'checked' : '';
                fieldHtml += `<label class="checkbox-wrapper">
                    <input type="checkbox" id="${fieldId}" ${checked}
                       class="property-input" 
                       data-property="${field.key}"
                       onchange="window.editorInstance.updateElementProperty('${element.id}', '${field.key}', this.checked)">
                    <span class="checkbox-label">${field.label}</span>
                </label>`;
                break;
            
        case 'number':
                const min = field.min !== undefined ? `min="${field.min}"` : '';
                const max = field.max !== undefined ? `max="${field.max}"` : '';
                fieldHtml += `<input type="number" id="${fieldId}" value="${value}" 
                         class="form-control property-input" 
                         data-property="${field.key}" ${min} ${max}
                         onchange="window.editorInstance.updateElementProperty('${element.id}', '${field.key}', this.value)">`;
                break;
        }
    
        fieldHtml += '</div>';
        return fieldHtml;
    }

    getElementIdFromItem( item ) {
	// Find element ID from the wrapper or element
	const elementId = item.getAttribute('data-element-id');
	if ( elementId )  return elementId;           
	// Try to find it in child elements
	const wrapper = item.querySelector('[data-element-id]');
	return wrapper ? wrapper.getAttribute('data-element-id') : null;
    }

    saveState( description ) {
        if ( this.currentTemplate )  this.undoManager.saveState(Utils.deepClone(this.currentTemplate), description);
    }

    togglePropertyGroup( groupId ) {
        const content = document.getElementById(groupId);
        const group = content?.closest('.property-group');
        const icon = group?.querySelector('.collapse-icon');
        if ( content && group && icon ) {
            const isCollapsed = group.classList.contains('collapsed');
            group.classList.toggle('collapsed', !isCollapsed);
            icon.classList.toggle('collapsed', !isCollapsed);
            icon.textContent = isCollapsed ? '▼' : '▶';
        }
    }

    updateModified( modified = true ) {
        this.isModified = modified;
        this.updateSaveButton();
        const indicator = document.querySelector('.modified-indicator');
        if ( indicator ) {
	    if ( modified ) { indicator.textContent = '• Modified'; } else { indicator.textContent = ''; }
	}
    }

    updateSaveButton() {
        const saveBtn = document.getElementById('save-template-btn');
        saveBtn.disabled = !this.currentTemplate || !this.isModified;
    }

    updateTemplate() {
        this.updateModified();
        this.currentTemplate = { ...this.currentTemplate };
	document.getElementById('main-canvas').innerHTML = this.renderTemplate(this.currentTemplate);
	this.initSortables();

        // Restore active tab states after re-render
        Object.entries(this.activeTabStates).forEach(([tabsElementId, activeIndex]) => {
            Utils.switchTab(tabsElementId, activeIndex, this);
        });
    }

    updateUI() {
        //this.updateCanvas();
        this.updatePropertiesPanel();
        this.updateSaveButton();
    }

}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    new TemplateEditor();
});