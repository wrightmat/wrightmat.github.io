class SchemaEditor {
    constructor() {
        this.schemas = {};
        this.currentSchema = null;
        this.selectedSchemaId = '';
        this.selectedPropertyPath = null;
        this.isModified = false;
        this.leftPaneCollapsed = false;
        this.rightPaneCollapsed = false;
        this.undoManager = new Utils.UndoRedoManager();
        this.sortables = {};
        
        this.dataTypeIcons = {
            string: '📝',
            integer: '🔢',
            number: '🔢',
            boolean: '☑️',
            object: '📦',
            array: '📋',
            date: '📅'
        };
        
        this.init();
    }

    async init() {
        await DataManager.loadAll();
        this.schemas = DataManager.getSchemas();
        this.setupEventListeners();
        this.renderSchemaOptions();
        this.renderToolsPanel();
        this.updateUI();
        window.schemaEditorInstance = this;
    }

    setupEventListeners() {
        document.getElementById('toggle-left-pane').addEventListener('click', () => Utils.togglePaneVisibility('editor-container', 'left', this));
        document.getElementById('toggle-right-pane').addEventListener('click', () => Utils.togglePaneVisibility('editor-container', 'right', this));
        document.getElementById('schema-select').addEventListener('change', (e) => this.selectSchema(e.target.value));
        document.getElementById('save-schema-btn').addEventListener('click', () => this.saveSchema());
        
        Utils.setPaneVisibility('editor-container', 'left', false, this);
        Utils.setPaneVisibility('editor-container', 'right', false, this);
    }

    renderSchemaOptions() {
    	const schemasWithMetadata = DataManager.getSchemasWithMetadata();
    	const schemaOptions = {};
    	schemasWithMetadata.forEach(schema => {
    	    const metadata = schema.metadata;
    	    if ( metadata )  schemaOptions[schema.id] = { id: schema.id, title: metadata.title || schema.title || schema.id };
    	});
        Utils.populateSelect('schema-select', schemaOptions, {
            emptyText: 'Select Schema...',
            sortKey: 'schemas',
            extraOptions: [{ value: '_new', text: '+ Create New Schema' }]
        });
    }

    selectSchema( schemaId ) {
        this.selectedSchemaId = schemaId;
        if ( schemaId === '_new' ) {
            this.createNewSchema();
        } else if ( schemaId ) {
            this.loadSchema(schemaId);
        } else {
            this.currentSchema = null;
            this.updateUI();
        }
    }

    createNewSchema() {
        this.currentSchema = {
            id: Utils.generateId('schema'),
            title: 'New Schema',
            type: 'object',
            properties: {},
            categories: {},
            importers: [],
            required: []
        };
        this.selectedPropertyPath = null;
        this.isModified = true;
        this.renderSchema();
        this.updateUI();
    }

    async loadSchema( schemaId ) {
        try {
            // Always fetch fresh from server, bypass cache
            const response = await fetch(`data/schemas/${schemaId}.json`);
            if ( !response.ok ) throw new Error(`Failed to load schema: ${schemaId}`);
            const schema = await response.json();
        
            this.currentSchema = Utils.deepClone(schema);
            this.selectedPropertyPath = null;
            this.isModified = false;
            this.renderSchema();
            this.updateUI();
        } catch ( error ) {
            Utils.showNotification(`Error loading schema: ${error.message}`, 'error');
        }
    }

    async saveSchema() {
        if ( !this.currentSchema ) return;
        try {
            Utils.showNotification('Saving schema...', 'info');
            const schemaId = await DataManager.saveSchema(this.currentSchema);

            // Get the updated schema with new metadata from DataManager
            this.currentSchema = DataManager.getSchema(schemaId);
            this.selectedSchemaId = schemaId;
        
            Utils.showNotification('Schema saved successfully', 'success');
            this.updateModified(false);
            this.renderSchemaHeader(); // Refresh to show updated metadata
        } catch ( error ) {
            Utils.showNotification(`Failed to save schema: ${error.message}`, 'error');
        }
    }

    renderSchema() {
        this.renderSchemaHeader();
        this.renderSchemaTree();
    }

    renderSchemaHeader() {
        const header = document.getElementById('schema-header');
        if ( !this.currentSchema ) {
            header.innerHTML = '';
            return;
        }
        const metadata = DataManager.getSchemaMetadata(this.currentSchema.id) || {};
	this.currentSchema.title = metadata.title;
	this.currentSchema.index = metadata.index;
        
        header.innerHTML = `
            <div class="schema-header-content">
                <div class="form-group">
                    <label>Schema Title</label>
                    <input type="text" class="form-control" value="${this.currentSchema.title || ''}" placeholder="Schema Title" id="schema-title-input">
                </div>
                <div class="form-group">
                    <label>Index</label>
                    <input type="text" class="form-control" value="${this.currentSchema.index || ''}" placeholder="Unique Index" id="schema-index-input">
                </div>
                <div class="form-group">
                    <label>ID</label>
                    <input type="text" class="form-control" value="${this.currentSchema.id || ''}" readonly>
                </div>
                <div class="form-group">
                    <label>Public?</label>
                    <input type="text" class="form-control" value="${metadata.is_public || this.currentSchema.is_public || 1}" readonly>
                </div>
                <div class="form-group">
                    <label>Created</label>
                    <input type="text" class="form-control" value="${metadata.created_at || this.currentSchema.created_at || ''}" readonly>
                </div>
                <div class="form-group">
                    <label>Modified</label>
                    <input type="text" class="form-control" value="${metadata.modified_at || this.currentSchema.modified_at || ''}" readonly>
                </div>
            </div>
        `;

        document.getElementById('schema-title-input').addEventListener('input', (e) => {
            this.currentSchema.title = e.target.value;
            this.updateModified(true);
        });

        document.getElementById('schema-index-input').addEventListener('input', (e) => {
            this.currentSchema.index = e.target.value;
            this.updateModified(true);
        });
    }

    renderSchemaTree() {
        const container = document.getElementById('schema-tree-container');
        if (!this.currentSchema) {
            container.innerHTML = '<div class="empty-state">Create or select a schema to begin editing</div>';
            return;
        }
        container.innerHTML = `
            <div class="schema-tree">
                <div class="tree-actions">
                    <button class="btn btn-secondary btn-small" onclick="window.schemaEditorInstance.addProperty('')">+ Add Root Property</button>
                </div>
                <div class="tree-root" id="tree-root">
                    ${this.renderProperties(this.currentSchema.properties, '')}
                </div>
            </div>
        `;
        this.initSortables();
    }

    renderProperties( properties, parentPath ) {
        if ( !properties ) return '';
        
        return Object.entries(properties).map(([key, property]) => {
            const path = parentPath ? `${parentPath}.${key}` : key;
            const hasComplexConfig = this.hasComplexConfiguration(property);
            const isSelected = this.selectedPropertyPath === path;
            
            return `
                <div class="tree-node ${isSelected ? 'selected' : ''}" data-path="${path}">
                    <div class="tree-node-header" onclick="window.schemaEditorInstance.selectProperty('${path}')">
                        <span class="tree-expand" onclick="event.stopPropagation(); window.schemaEditorInstance.toggleExpand('${path}')">
                            ${property.type === 'object' || property.type === 'array' ? '▼' : ''}
                        </span>
                        <span class="tree-icon">${this.dataTypeIcons[property.type] || '📝'}</span>
                        <input type="text" class="tree-key-input" value="${key}" 
                               onblur="window.schemaEditorInstance.updatePropertyKey('${path}', this.value)"
                               onclick="event.stopPropagation()">
                        <select class="tree-type-select" onchange="window.schemaEditorInstance.updatePropertyType('${path}', this.value)"
                                onclick="event.stopPropagation()">
                            <option value="string" ${property.type === 'string' ? 'selected' : ''}>string</option>
                            <option value="integer" ${property.type === 'integer' ? 'selected' : ''}>integer</option>
                            <option value="number" ${property.type === 'number' ? 'selected' : ''}>number</option>
                            <option value="boolean" ${property.type === 'boolean' ? 'selected' : ''}>boolean</option>
                            <option value="object" ${property.type === 'object' ? 'selected' : ''}>object</option>
                            <option value="array" ${property.type === 'array' ? 'selected' : ''}>array</option>
                        </select>
                        <button class="tree-btn ${this.isRequired(path) ? 'active' : ''}" 
                                onclick="event.stopPropagation(); window.schemaEditorInstance.toggleRequired('${path}')" 
                                title="Required">R</button>
                        <button class="tree-btn ${hasComplexConfig ? 'active' : ''}" 
                                onclick="event.stopPropagation(); window.schemaEditorInstance.openComplexConfig('${path}')" 
                                title="Complex Configuration">⚙️</button>
                        <button class="tree-btn delete" 
                                onclick="event.stopPropagation(); window.schemaEditorInstance.deleteProperty('${path}')" 
                                title="Delete">×</button>
                    </div>
                    <div class="tree-node-details">
                        <div class="tree-inline-field">
                            <label>Label:</label>
                            <input type="text" class="form-control" value="${property.label || ''}"  onblur="window.schemaEditorInstance.updatePropertyField('${path}', 'label', this.value)">
                        </div>
                        <div class="tree-inline-field">
                            <label>Description:</label>
                            <input type="text" class="form-control" value="${property.description || ''}"  onblur="window.schemaEditorInstance.updatePropertyField('${path}', 'description', this.value)">
                        </div>
                        <div class="tree-inline-field">
                            <label>Category:</label>
			    <select class="form-control" onblur="window.schemaEditorInstance.updatePropertyField('${path}', 'category', this.value)">
				<option value="">Select category...</option>
				${this.getCategoryOptions(property.category)}
			    </select>
                        </div>
                    </div>
                    ${this.renderChildProperties(property, path)}
                </div>
            `;
        }).join('');
    }

    renderChildProperties( property, path ) {
        if (property.type === 'object' && property.properties) {
            return `
                <div class="tree-children">
                    <button class="btn btn-secondary btn-small" onclick="window.schemaEditorInstance.addProperty('${path}')">+ Add Property</button>
                    ${this.renderProperties(property.properties, path)}
                </div>
            `;
        } else if (property.type === 'array' && property.items) {
            return `
                <div class="tree-children">
                    <div class="array-items-label">Array Items:</div>
                    ${this.renderArrayItems(property.items, path)}
                </div>
            `;
        }
        return '';
    }

    renderArrayItems( items, path ) {
        if (items.type === 'object' && items.properties) {
            return `
                <button class="btn btn-secondary btn-small" onclick="window.schemaEditorInstance.addArrayProperty('${path}')">+ Add Item Property</button>
                ${this.renderProperties(items.properties, `${path}.items`)}
            `;
        }
        return `<div class="array-item-type">Type: ${items.type || 'string'}</div>`;
    }

    // Property manipulation methods
    addProperty( parentPath ) {
        this.saveState('Add property');
        const newKey = this.generateUniqueKey(parentPath, 'newProperty');
        const newProperty = {
            type: 'string',
            label: '',
            description: '',
            category: ''
        };
        
        if ( parentPath === '' ) {
            this.currentSchema.properties[newKey] = newProperty;
        } else {
            const parent = this.getPropertyAtPath(parentPath);
            if (!parent.properties) parent.properties = {};
            parent.properties[newKey] = newProperty;
        }
        
        this.updateModified(true);
        this.renderSchemaTree();
    }

    addArrayProperty( arrayPath ) {
        this.saveState('Add array property');
        const arrayProperty = this.getPropertyAtPath(arrayPath);
        if ( !arrayProperty.items ) arrayProperty.items = { type: 'object', properties: {} };
        if ( !arrayProperty.items.properties ) arrayProperty.items.properties = {};
        
        const newKey = this.generateUniqueKey(`${arrayPath}.items`, 'newProperty');
        arrayProperty.items.properties[newKey] = {
            type: 'string',
            label: '',
            description: '',
            category: ''
        };
        
        this.updateModified(true);
        this.renderSchemaTree();
    }

    updatePropertyKey( path, newKey ) {
        if ( !newKey.trim() ) return;
        
        this.saveState('Rename property');
        const pathParts = path.split('.');
        const oldKey = pathParts.pop();
        const parentPath = pathParts.join('.');
        const parent = parentPath ? this.getPropertyAtPath(parentPath) : this.currentSchema;
        const properties = parent.properties || parent.items?.properties;

        if ( properties && properties[oldKey] && newKey !== oldKey ) {
            // Check for duplicate key
            if ( properties[newKey] ) {
                Utils.showNotification(`Property "${newKey}" already exists`, 'error');
                this.renderSchemaTree(); // Reset the input
                return;
            }
            // Preserve order by rebuilding object with same key positions
            const newProperties = {};
            Object.keys(properties).forEach(key => {
                const actualKey = key === oldKey ? newKey : key;
                newProperties[actualKey] = properties[key];
            });
            if ( parent.properties ) parent.properties = newProperties;
            else if ( parent.items?.properties ) parent.items.properties = newProperties;
            this.updateModified(true);
            this.renderSchemaTree();
        }
    }

    updatePropertyType( path, newType ) {
        this.saveState('Change property type');
        const property = this.getPropertyAtPath(path);
        property.type = newType;
        
        // Initialize type-specific properties
        if (newType === 'object' && !property.properties) {
            property.properties = {};
        } else if (newType === 'array' && !property.items) {
            property.items = { type: 'string' };
        }
        
        this.updateModified(true);
        this.renderSchemaTree();
    }

    updatePropertyField( path, field, value ) {
        const property = this.getPropertyAtPath(path);
        property[field] = value;
        this.updateModified(true);
    }

    toggleRequired( path ) {
        this.saveState('Toggle required');
        const pathParts = path.split('.');
        const key = pathParts.pop();
        const parentPath = pathParts.join('.');

        let parent, requiredArray;
        if ( parentPath === '' ) {
            parent = this.currentSchema;
            if ( !parent.required ) parent.required = [];
            requiredArray = parent.required;
        } else {
            parent = this.getPropertyAtPath(parentPath);
            if ( !parent.required ) parent.required = [];
            requiredArray = parent.required;
        }
    
        const index = requiredArray.indexOf(key);
        if ( index > -1 ) {
            requiredArray.splice(index, 1);
        } else {
            requiredArray.push(key);
        }
    
        this.updateModified(true);
        this.renderSchemaTree();
    }

    deleteProperty( path ) {
        this.saveState('Delete property');
        const pathParts = path.split('.');
        const key = pathParts.pop();
        const parentPath = pathParts.join('.');
        const parent = parentPath ? this.getPropertyAtPath(parentPath) : this.currentSchema;
        const properties = parent.properties || parent.items?.properties;
        
        if ( properties ) {
            delete properties[key];
            this.updateModified(true);
            this.renderSchemaTree();
        }
    }

    selectProperty( path ) {
        this.selectedPropertyPath = path;
        this.renderSchemaTree();
        this.renderPropertiesPanel();
        Utils.setPaneVisibility('editor-container', 'right', true, this);
    }

    openComplexConfig( path ) {
        this.selectProperty(path);
    }

    // Helper methods
    getCategoryOptions( selectedCategory ) {
        if (!this.currentSchema.categories) return '';
        return Object.entries(this.currentSchema.categories)
            .map(([key, cat]) => `<option value="${key}" ${key === selectedCategory ? 'selected' : ''}>${cat.label || key}</option>`)
            .join('');
    }

    getPropertyAtPath( path ) {
        if ( !path ) return this.currentSchema;
        
        const parts = path.split('.');
        let current = this.currentSchema;
        
        for ( const part of parts ) {
            if ( part === 'items' ) {
                current = current.items;
            } else {
                current = current.properties?.[part];
            }
	    if ( !current ) return undefined;
        }
        return current;
    }

    generateUniqueKey( parentPath, baseName ) {
        const parent = parentPath ? this.getPropertyAtPath(parentPath) : this.currentSchema;
        const properties = parent.properties || parent.items?.properties || {};
        
        let counter = 1;
        let key = baseName;
        while (properties[key]) {
            key = `${baseName}${counter}`;
            counter++;
        }
        return key;
    }

    isRequired( path ) {
        try {
            if ( !this.currentSchema ) return false;
        
            const pathParts = path.split('.');
            const key = pathParts.pop();
            const parentPath = pathParts.join('.');
        
            if ( parentPath === '' ) {
                return this.currentSchema.required && this.currentSchema.required.includes(key);
            } else {
                const parent = this.getPropertyAtPath(parentPath);
                return parent && parent.required && parent.required.includes(key);
            }
        } catch ( error ) {
            console.error('Error in isRequired:', error, 'path:', path);
            return false;
        }
    }

    hasComplexConfiguration( property ) {
        return !!(
            property['x-formula'] ||
            property.enum ||
            property.minimum ||
            property.maximum ||
            property.default ||
            (property.type === 'array' && property.items)
        );
    }

    renderPropertiesPanel() {
        const panel = document.getElementById('properties-panel');
        if ( !this.selectedPropertyPath ) {
            panel.innerHTML = '<div class="empty-state-small">Select a property to configure advanced options</div>';
            return;
        }
        const property = this.getPropertyAtPath(this.selectedPropertyPath);
        panel.innerHTML = `
            <div class="property-config">
                <h4>${this.selectedPropertyPath}</h4>
                <div class="property-field">
                    <label>Default Value</label>
                    <input type="text" class="form-control" value="${property.default || ''}" 
                           onblur="window.schemaEditorInstance.updateAdvancedField('default', this.value)">
                </div>
                <div class="property-field">
                    <label>Formula (x-formula)</label>
                    <input type="text" class="form-control" value="${property['x-formula'] || ''}" 
                           onblur="window.schemaEditorInstance.updateAdvancedField('x-formula', this.value)">
                </div>
                ${this.renderTypeSpecificFields(property)}
            </div>
        `;
    }

    renderTypeSpecificFields( property ) {
        switch ( property.type ) {
            case 'integer':
            case 'number':
                return `
                    <div class="property-field">
                        <label>Minimum</label>
                        <input type="number" class="form-control" value="${property.minimum || ''}" 
                               onblur="window.schemaEditorInstance.updateAdvancedField('minimum', this.value)">
                    </div>
                    <div class="property-field">
                        <label>Maximum</label>
                        <input type="number" class="form-control" value="${property.maximum || ''}" 
                               onblur="window.schemaEditorInstance.updateAdvancedField('maximum', this.value)">
                    </div>
                `;
            case 'string':
                return `
                    <div class="property-field">
                        <label>Enum Values (comma-separated)</label>
                        <input type="text" class="form-control" value="${property.enum ? property.enum.join(', ') : ''}" 
                               onblur="window.schemaEditorInstance.updateEnumField(this.value)">
                    </div>
                `;
            default:
                return '';
        }
    }

    updateAdvancedField( field, value ) {
        const property = this.getPropertyAtPath(this.selectedPropertyPath);
        if ( value.trim() ) {
            if (field === 'minimum' || field === 'maximum') {
                property[field] = parseFloat(value) || 0;
            } else {
                property[field] = value;
            }
        } else {
            delete property[field];
        }
        this.updateModified(true);
    }

    updateEnumField( value ) {
        const property = this.getPropertyAtPath(this.selectedPropertyPath);
        if ( value.trim() ) {
            property.enum = value.split(',').map(v => v.trim()).filter(v => v);
        } else {
            delete property.enum;
        }
        this.updateModified(true);
    }

    renderToolsPanel() {
        const panel = document.getElementById('tools-panel');
        panel.innerHTML = `
        <div class="tools-content">
            <div class="tool-section">
                <h4 class="tool-section-title">Categories</h4>
                <div class="category-listbox" id="category-listbox">
                    ${this.renderCategoryList()}
                </div>
                <div class="category-controls">
                    <button class="btn btn-secondary btn-small" onclick="window.schemaEditorInstance.addCategory()">+ Add</button>
                    <button class="btn btn-secondary btn-small" onclick="window.schemaEditorInstance.moveCategory(-1)">↑</button>
                    <button class="btn btn-secondary btn-small" onclick="window.schemaEditorInstance.moveCategory(1)">↓</button>
                    <button class="btn btn-danger btn-small" onclick="window.schemaEditorInstance.removeSelectedCategory()">Delete</button>
                </div>
            </div>
            <div class="tool-section">
                <h4 class="tool-section-title">Importers</h4>
                <div id="importers-list">
                    ${this.renderImporters()}
                </div>
                <button class="btn btn-secondary btn-full-width" onclick="window.schemaEditorInstance.addImporter()">+ Add Importer</button>
            </div>
	</div>
        `;
    }

    renderCategoryList() {
        if (!this.currentSchema?.categories) return '';
    
        return Object.entries(this.currentSchema.categories)
            .sort((a, b) => (a[1].order || 1) - (b[1].order || 1))
            .map(([key, cat]) => `
              <div class="category-item" data-key="${key}" 
                 onclick="window.schemaEditorInstance.selectCategory('${key}')"
                 ondblclick="window.schemaEditorInstance.editCategoryLabel('${key}')">
                ${cat.label || key}
              </div>
            `).join('');
    }

    selectCategory( key ) {
        document.querySelectorAll('.category-item').forEach(item => item.classList.remove('selected'));
        document.querySelector(`[data-key="${key}"]`).classList.add('selected');
        this.selectedCategory = key;
    }

    editCategoryLabel( key ) {
        const item = document.querySelector(`[data-key="${key}"]`);
        const currentLabel = this.currentSchema.categories[key].label || key;
        const newLabel = prompt('Edit category label:', currentLabel);
        if ( newLabel !== null ) {
            this.currentSchema.categories[key].label = newLabel;
            this.updateModified(true);
            this.renderToolsPanel();
        }
    }

    addCategory() {
        if (!this.currentSchema.categories) this.currentSchema.categories = {};
        const maxOrder = Math.max(0, ...Object.values(this.currentSchema.categories).map(c => c.order || 0));
        const key = `category${Object.keys(this.currentSchema.categories).length + 1}`;
        this.currentSchema.categories[key] = { label: 'New Category', order: maxOrder + 1 };
        this.updateModified(true);
        this.renderToolsPanel();
    }

    moveCategory( direction ) {
        if ( !this.selectedCategory ) return;
        const categories = Object.entries(this.currentSchema.categories).sort((a, b) => (a[1].order || 1) - (b[1].order || 1));
        const index = categories.findIndex(([key]) => key === this.selectedCategory);
        const newIndex = index + direction;
    
        if ( newIndex >= 0 && newIndex < categories.length ) {
            const temp = categories[index][1].order;
            categories[index][1].order = categories[newIndex][1].order;
            categories[newIndex][1].order = temp;
            this.updateModified(true);
            this.renderToolsPanel();
        }
    }

    removeSelectedCategory() {
        if ( !this.selectedCategory ) return;
        delete this.currentSchema.categories[this.selectedCategory];
        this.selectedCategory = null;
        this.updateModified(true);
        this.renderToolsPanel();
    }

    renderImporters() {
        if ( !this.currentSchema || !this.currentSchema.importers ) return '';
        return this.currentSchema.importers.map((importer, index) => `
            <div class="importer-item">
                <div class="importer-header">
                    <input type="text" class="importer-icon-input" value="${importer.icon || '📄'}"  title="Icon"
                       onblur="window.schemaEditorInstance.updateImporter(${index}, 'icon', this.value)">
                    <strong>${importer.id || 'unnamed'}</strong>
                    <button class="btn btn-danger btn-small" onclick="window.schemaEditorInstance.removeImporter(${index})">×</button>
                </div>
                <div class="importer-fields">
                    <input type="text" placeholder="Name" title="Name" value="${importer.name || ''}" onblur="window.schemaEditorInstance.updateImporter(${index}, 'name', this.value)">
                    <input type="text" placeholder="Description" title="Description" value="${importer.description || ''}" onblur="window.schemaEditorInstance.updateImporter(${index}, 'description', this.value)">
                    <input type="text" placeholder="Handler Function" title="Handler Function" value="${importer.handler || ''}" onblur="window.schemaEditorInstance.updateImporter(${index}, 'handler', this.value)">
                    <input type="text" placeholder="File Types (.json,.csv)" title="File Types (.json,.csv)" value="${(importer.fileTypes || []).join(',')}"
			onblur="window.schemaEditorInstance.updateImporterFileTypes(${index}, this.value)">
                </div>
            </div>
        `).join('');
    }

    updateImporterFileTypes( index, value ) {
        this.currentSchema.importers[index].fileTypes = value.split(',').map(t => t.trim()).filter(t => t);
        this.updateModified(true);
    }

    addImporter() {
        if ( !this.currentSchema.importers ) this.currentSchema.importers = [];
        this.currentSchema.importers.push({
            id: '',
            name: '',
            description: '',
            fileTypes: ['.json'],
            handler: 'importFromJson'
        });
        this.updateModified(true);
        this.renderToolsPanel();
    }

    removeImporter( index ) {
        this.currentSchema.importers.splice(index, 1);
        this.updateModified(true);
        this.renderToolsPanel();
    }

    updateImporter( index, field, value ) {
        this.currentSchema.importers[index][field] = value;
        this.updateModified(true);
    }

    validateSchema() {
	if ( !this.currentSchema ) return ['No schema loaded'];

	const errors = [];
        const btn = document.getElementById('validation-status-btn');

	if ( !this.currentSchema.title?.trim() ) errors.push('Schema must have a title');
	if ( !this.currentSchema.index?.trim() ) errors.push('Schema must have an index');
	if ( !this.currentSchema.type ) errors.push('Schema must have a type');
	if ( !this.currentSchema.properties ) errors.push('Schema must have properties');
	if ( this.currentSchema.categories ) {
            const keys = Object.keys(this.currentSchema.categories);
            if ( keys.length !== new Set(keys).size ) errors.push('Duplicate category keys found');
        }
	this.validateProperties(this.currentSchema.properties, '', errors);

	if ( !this.currentSchema ) {
            btn.className = 'btn btn-secondary';
            btn.textContent = '⚪ No Schema';
            this.validationErrors = [];
        } else if ( errors.length === 0 ) {
            btn.className = 'btn btn-success';
            btn.textContent = '✓ Valid';
            this.validationErrors = [];
        } else {
            btn.className = 'btn btn-danger';
            btn.textContent = '⚠ Invalid';
            this.validationErrors = errors;
        }
    }

    validateProperties(properties, path, errors) {
        if ( !properties ) return;
        Object.entries(properties).forEach(([key, prop]) => {
            const fullPath = path ? `${path}.${key}` : key;
            if ( !prop.type ) errors.push(`Property ${fullPath} missing type`);
            if ( prop.type === 'object' && prop.properties ) this.validateProperties(prop.properties, fullPath, errors);
            if ( prop.type === 'array' && prop.items?.properties ) this.validateProperties(prop.items.properties, `${fullPath}.items`, errors);
        });
    }

    showValidationDetails() {
        if ( this.validationErrors?.length > 0 ) {
            Utils.showNotification(`Validation errors: ${this.validationErrors.join(', ')}`, 'error');
        } else {
            Utils.showNotification('Schema is valid', 'success');
        }
    }

    saveState( description ) {
        if ( this.currentSchema ) this.undoManager.saveState(Utils.deepClone(this.currentSchema), description);
    }

    updateModified( modified = true ) {
        this.isModified = modified;
	this.validateSchema();
        this.updateSaveButton();
        const indicator = document.querySelector('.modified-indicator');
        if ( indicator ) indicator.textContent = modified ? '• Modified' : '';
    }

    updateSaveButton() {
        const saveBtn = document.getElementById('save-schema-btn');
	const hasErrors = this.validationErrors?.length > 0;
        saveBtn.disabled = !this.currentSchema || !this.isModified || hasErrors;
    }

    updateUI() {
	this.validateSchema();
        this.updateSaveButton();
        this.renderToolsPanel();
    }

    initSortables() {
        document.querySelectorAll('.tree-root, .tree-children').forEach(container => {
            if ( this.sortables[container.id] ) this.sortables[container.id].destroy();
            this.sortables[container.id] = Sortable.create(container, {
                group: 'schema-properties',
                animation: 150,
                handle: '.tree-node-header',
                onUpdate: (evt) => {
                    this.saveState('Reorder properties');

                    const path = evt.to.dataset.parentPath || '';
                    const parent = path ? this.getPropertyAtPath(path) : this.currentSchema;
                    const properties = parent.properties || parent.items?.properties;
                
                    // Reorder properties object
                    const keys = Object.keys(properties);
                    const [movedKey] = keys.splice(evt.oldIndex, 1);
                    keys.splice(evt.newIndex, 0, movedKey);
                
                    const reordered = {};
                    keys.forEach(key => reordered[key] = properties[key]);
                    if (parent.properties) parent.properties = reordered;
                    else if (parent.items?.properties) parent.items.properties = reordered;

                    this.updateModified(true);
                }
            });
        });
    }
}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    new SchemaEditor();
});
