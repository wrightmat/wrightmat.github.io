class CharacterEditor {
    constructor() {
        this.schemas = {};
        this.templates = {};
        this.characters = {};
        this.character = null;
        this.selectedSchemaId = '';
        this.selectedTemplateId = '';
        this.selectedCharacterId = '';
        this.viewMode = false;
        this.isModified = false;
	this.activeTabStates = {};
        this.leftPaneCollapsed = false;
        this.rightPaneCollapsed = false;
        this.richTextEditors = new Map();
        
        // Initialize undo manager with callback
        this.undoManager = new Utils.UndoRedoManager((state, action) => {
            this.cleanupRichTextEditors();
            Object.assign(this.character, Utils.deepClone(state));
            const schema = DataManager.getSchema(this.selectedSchemaId);
            if ( schema ) {
                Utils.FormulaEngine.evaluateAllFormulas(schema, this.character.data);
            }
            this.isModified = true;
            this.renderCharacterSheet();
        });
        this.init();
    }

    async init() {
        await DataManager.loadAll();
        this.schemas = DataManager.getSchemas();
        this.setupEventListeners();
        this.renderSchemaOptions();
        this.updateUI();
        window.characterAppInstance = this;
    }

    initRichTextEditor( elementId, scope, readOnly = false ) {
        const element = document.getElementById(elementId);
        if ( !element ) return;

        try {
            const editor = new toastui.Editor({
                el: element,
                height: '200px',
                initialEditType: 'wysiwyg',
                previewStyle: 'vertical',
                initialValue: this.getValue(scope) || '',
                viewer: readOnly,
                events: {
                    change: () => {
                        if (!readOnly && this.character) {
                            this.saveState('Update rich text');
                            Utils.setNestedValue(this.character.data, scope, editor.getHTML());
                            this.markAsModified('Update rich text');
                        }
                    }
                }
            });
            this.richTextEditors.set(elementId, editor);
        } catch (error) {
            console.error('Failed to initialize rich text editor:', error);
            element.innerHTML = `<textarea class="form-control" onblur="window.characterAppInstance.updateValue(event, '${scope}')">${this.getValue(scope) || ''}</textarea>`;
        }
    }

    setupEventListeners() {
        // Pane toggles
	document.getElementById('toggle-left-pane').addEventListener('click', () => Utils.togglePaneVisibility('editor-container', 'left', this) );
	document.getElementById('toggle-right-pane').addEventListener('click', () => Utils.togglePaneVisibility('editor-container', 'right', this) );
	Utils.setPaneVisibility('editor-container', 'left', false, this); Utils.setPaneVisibility('editor-container', 'right', false, this);  // collapse by default

        // Toolbar
        document.getElementById('schema-select').addEventListener('change', (e) => this.selectSchema(e.target.value));
        document.getElementById('template-select').addEventListener('change', (e) => this.selectTemplate(e.target.value));
        document.getElementById('character-select').addEventListener('change', (e) => this.selectCharacter(e.target.value));
        document.getElementById('save-character-btn').addEventListener('click', () => this.saveCharacter());
        document.getElementById('toggle-view-mode').addEventListener('click', () => this.toggleViewMode());
    }


    //======== Render/Select UI Elements

    renderSchemaOptions() {
        Utils.populateSelect('schema-select', this.schemas, {
            emptyText: 'Select System...',
            sortKey: 'schemas'
        });
    }

    selectSchema(schemaId) {
        this.selectedSchemaId = schemaId;
        this.templates = DataManager.getTemplates();
        this.renderTemplateOptions();
        this.updateUI();
    }

    renderTemplateOptions() {
	this.availableTemplates = {};
        const disabled = !this.selectedSchemaId;
        document.getElementById('template-select').disabled = disabled;
	if (!this.selectedSchemaId) return;

	const schema = DataManager.getSchema(this.selectedSchemaId);
	if ( schema && this.templates ) {
	    this.availableTemplates = Object.fromEntries(
                Object.entries(this.templates).filter(([_, template]) => template.schema === schema.index )
            );
            Utils.populateSelect('template-select', this.availableTemplates, {
                emptyText: 'Select Template...',
                sortKey: 'templates'
            });
        }
    }

    selectTemplate(templateId) {
        this.selectedTemplateId = templateId;
        this.characters = DataManager.getCharacters();
        this.renderCharacterOptions();
        this.updateUI();
    }

    renderCharacterOptions() {
	this.availableCharacters = {};
        const disabled = !this.selectedTemplateId;
        document.getElementById('character-select').disabled = disabled;        
        if (!this.selectedTemplateId) return;

	const schema = DataManager.getSchema(this.selectedSchemaId);
	const template = DataManager.getTemplate(this.selectedTemplateId);
	if ( schema && template && this.characters ) {
            this.availableCharacters = Object.fromEntries(
                Object.entries(this.characters).filter(([_, character]) => character.system === schema.index && character.template === template.index )
            );
            Utils.populateSelect('character-select', this.availableCharacters, {
                emptyText: 'Select Character...',
                textField: 'data.name',
                sortKey: 'modified',
                extraOptions: [{ value: '_new', text: '+ Create New Character' }]
            });
        }
    }

    selectCharacter(characterId) {
        this.selectedCharacterId = characterId;
        
        if (characterId === '_new') {
            this.createNewCharacter();
        } else if (characterId) {
            this.loadCharacter(characterId);
        } else {
            this.character = null;
            this.updateUI();
        }
    }


    //============= Character Management Functions

    createNewCharacter() {
        const template = this.templates[this.selectedTemplateId];
        const schema = this.schemas[this.selectedSchemaId];
        
        this.character = {
            id: Utils.generateId(),
            system: this.selectedSchemaId,
            template: this.selectedTemplateId,
            data: this.initializeCharacterData(schema),
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        };
        
        this.isModified = true;
        this.renderCharacterSheet();
        this.updateUI();
    }

    initializeCharacterData(schema) {
        const data = {};
        
        if (schema.properties) {
            Object.entries(schema.properties).forEach(([key, property]) => {
                if (property.default !== undefined) {
                    data[key] = property.default;
                } else if (property.type === 'array') {
                    data[key] = [];
                } else if (property.type === 'object') {
                    data[key] = {};
                }
            });
        }
        
        return data;
    }

    loadCharacter(characterId) {
        this.character = Utils.deepClone(this.characters[characterId]);
        this.isModified = false;
        this.renderCharacterSheet();
        this.updateUI();
    }

    importCharacter() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if ( file ) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const importedData = JSON.parse(e.target.result);
                        this.handleCharacterImport(importedData);
                    } catch (error) {
                        Utils.showNotification('Invalid JSON file. Please check the file format.', 'error');
                        console.error('Import error:', error);
                    }
                };
                reader.onerror = () => {
                    Utils.showNotification('Error reading file', 'error');
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    exportCharacter() {
        const filename = (this.character.data.name || 'character').toLowerCase().replace(/\s+/g, '_') + '.json';
        Utils.exportAsJson(this.character, filename);
        Utils.showNotification('Character exported successfully', 'success');
    }

    async saveCharacter() {
        if (!this.selectedCharacterId || this.selectedCharacterId === '_new') {
            Utils.showNotification('No character selected to save', 'error');
            return;
        }

        try {
            this.character.modified = new Date().toISOString();
            this.characters[this.selectedCharacterId] = Utils.deepClone(this.character);
            
            await DataManager.saveCharacter(this.selectedCharacterId, this.character);
            this.isModified = false;
            this.updateSaveButton();
            
            Utils.showNotification(`Character "${this.character.data.name}" saved successfully`, 'success');
        } catch (error) {
            Utils.showNotification(`Failed to save character: ${error.message}`, 'error');
            console.error('Save character error:', error);
        }
    }


    //============ Update Element Functions

    updateValue( event, scope ) {
        if ( !this.character || this.viewMode ) return;

        this.saveState('Update field value');
        const value = event.target.type === 'number' ? parseFloat(event.target.value) || 0 : event.target.value;
        
        Utils.setNestedValue(this.character.data, scope, value);
        this.markAsModified('Update field value');
        
        // Re-evaluate formulas
        const schema = this.schemas[this.selectedSchemaId];
        if ( schema )  Utils.FormulaEngine.evaluateAllFormulas(schema, this.character.data);
    }

    updateCheckbox( event, scope ) {
        if (!this.character || this.viewMode) return;
        this.saveState('Update checkbox');
        Utils.setNestedValue(this.character.data, scope, event.target.checked);
        this.markAsModified('Update checkbox');
    }

    updateMultiStateDisplay( scope, value ) {
        const toggles = document.querySelectorAll(`[data-scope="${scope}"]`);
        toggles.forEach(toggle => {
            const control = toggle.querySelector('.multi-state-control');
            if ( control ) {
                // Remove all state classes
                control.className = control.className.replace(/state-\d+/g, '');
                // Add current state class
                control.classList.add(`state-${value}`);
                // Update colors based on element configuration
                const element = this.findElementByScope(scope);
                if ( element ) {
                    const toggleColors = ElementRenderer.getElementColors(element, value > 0 ? 'selected' : 'unselected');
                    control.setAttribute('style', toggleColors);
                }
            }
        });
    }

    updateMultiStateValue( scope, maxStates ) {
        this.saveState('Multi-state toggle: ' + scope.split('/').pop());
        // Convert scope format if needed
        let normalizedScope = scope;
        if (scope.startsWith('@')) {
            normalizedScope = scope.substring(1); // Remove @ prefix for dot notation
        } else if (scope.startsWith('#/properties/')) {
            // Convert JSON Pointer to dot notation
            normalizedScope = scope.replace('#/properties/', '').replace(/\/properties\//g, '.');
        }
        const currentValue = this.getValue(normalizedScope) || 0;
        const newValue = (currentValue + 1) % maxStates;
        Utils.setNestedValue(this.character.data, normalizedScope, newValue);
        Utils.FormulaEngine.evaluateAllFormulas(this.schemas[this.selectedSchemaId], this.character.data);
        this.markAsModified('Multi-state toggle: ' + normalizedScope.split('.').pop());
        this.updateMultiStateDisplay(normalizedScope, newValue);
    }

    updateSelectGroupDisplay( scope, selectedValues, selectionType ) {
        const selectGroups = document.querySelectorAll(`[data-scope="${scope}"]`);
        selectGroups.forEach(group => {
            const options = group.querySelectorAll('.select-group-option');
            options.forEach(option => {
                const optionText = option.textContent.trim();
                const isSelected = selectionType === 'single' ? selectedValues === optionText : Array.isArray(selectedValues) && selectedValues.includes(optionText);
                if ( isSelected ) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
                // Update colors based on element configuration
                const element = this.findElementByScope(scope);
                if ( element ) {
                    const optionColors = ElementRenderer.getElementColors(element, isSelected ? 'selected' : 'unselected');
                    option.setAttribute('style', optionColors);
                }
            });
        });
    }

    updateSelectGroupValue( scope, option, selectionType ) {
        this.saveState('Selection change: ' + option);
        // Convert scope format if needed
        let normalizedScope = scope;
        if (scope.startsWith('@')) normalizedScope = scope.substring(1);
        let currentValues = this.getValue(scope) || (selectionType === 'single' ? '' : []);
        if ( selectionType === 'single' ) {
            // Single select: toggle or set value
            const newValue = currentValues === option ? '' : option;
            Utils.setNestedValue(this.character.data, normalizedScope, newValue);
        } else {
            // Multi select: add/remove from array
            if ( !Array.isArray(currentValues) ) currentValues = [];
            const index = currentValues.indexOf(option);
            if ( index > -1 ) {
                currentValues.splice(index, 1);
            } else {
                currentValues.push(option);
            }
            Utils.setNestedValue(this.character.data, normalizedScope, currentValues);
        }
        Utils.FormulaEngine.evaluateAllFormulas(this.schemas[this.selectedSchemaId], this.character.data);
        this.markAsModified('Selection change: ' + option);
        this.updateSelectGroupDisplay(scope, this.getValue(scope), selectionType);
    }

    updateTrackDisplay( scope, value, maxValue ) {
        const tracks = document.querySelectorAll(`[data-scope="${scope}"]`);
        tracks.forEach(track => {
            const segments = track.querySelectorAll('.progress-segment, .progress-circle-segment');
            segments.forEach((segment, index) => {
                const wasFilled = segment.classList.contains('filled');
                const shouldBeFilled = index < value;
                if ( shouldBeFilled !== wasFilled ) {
                    segment.classList.toggle('filled', shouldBeFilled);
                    // Re-apply colors based on the current element configuration
                    const element = this.findElementByScope(scope);
                    if ( element ) {
                        const segmentColors = ElementRenderer.getElementColors(element, shouldBeFilled ? 'filled' : 'empty');
                        // Preserve position for circular segments
                        if (segment.classList.contains('progress-circle-segment')) {
                            const currentStyle = segment.getAttribute('style') || '';
                            const positionMatch = currentStyle.match(/(left:\s*[^;]+;\s*top:\s*[^;]+;)/);
                            const positionStyle = positionMatch ? positionMatch[1] + ' ' : '';
                            segment.setAttribute('style', positionStyle + segmentColors);
                        } else {
                            segment.setAttribute('style', segmentColors);
                        }
                    }
                }
            });
            const counter = track.parentElement.querySelector('.progress-track-counter');
            if ( counter )  counter.textContent = `${value}/${maxValue}`;
        });
    }

    updateTrackValue( scope, newValue, maxValue ) {
        this.saveState('Track change: ' + scope.split('/').pop());
        const currentValue = this.getValue(scope) || 0;
    
        // Toggle behavior: if clicking on a filled segment, unfill from there
        if ( newValue <= currentValue )  newValue = newValue - 1;
    
        newValue = Math.max(0, Math.min(newValue, maxValue));
        Utils.setNestedValue(this.character.data, scope, newValue);
        Utils.FormulaEngine.evaluateAllFormulas(this.schemas[this.selectedSchemaId], this.character.data);
        this.markAsModified('Track change: ' + scope.split('/').pop());
        this.updateTrackDisplay(scope, newValue, maxValue);
    }


    //============== Array UI Elements (different from array functions in Utils)

    addArrayItem( scope, arrayId ) {
        if (!this.character || this.viewMode) return;
        
        this.saveState('Add array item');
        Utils.addArrayItem(this.character, scope);
        this.markAsModified('Add array item');
        this.renderCharacterSheet();
    }

    removeArrayItem(scope, index) {
        if (!this.character || this.viewMode) return;
        
        this.saveState('Remove array item');
        if (Utils.removeArrayItem(this.character, scope, index)) {
            this.markAsModified('Remove array item');
            this.renderCharacterSheet();
        }
    }

    updateArrayValue(event, scope, index, field) {
        if (!this.character || this.viewMode) return;
        
        this.saveState('Update array value');
        const items = Utils.getNestedValue(this.character.data, scope) || [];
        if (index >= 0 && index < items.length) {
            const value = event.target.type === 'number' ? 
                parseFloat(event.target.value) || 0 : 
                event.target.value;
            items[index][field] = value;
            Utils.setNestedValue(this.character.data, scope, items);
            this.markAsModified('Update array value');
        }
    }


    //============== Character Editor Specific Render Functions

    renderCharacterSheet() {
        const content = document.getElementById('main-content-inner');
        
        if ( !this.character || !this.selectedTemplateId ) {
            content.innerHTML = '<div class="character-sheet-placeholder"><p>Select a system, template, and character to begin editing.</p></div>';
            return;
        }

        const template = this.templates[this.selectedTemplateId];
        const schema = this.schemas[this.selectedSchemaId];
        
        if (!template || !schema) {
            content.innerHTML = '<div class="empty-state">Template or schema not found</div>';
            return;
        }
        const context = {
            isPreview: false,
            viewMode: this.viewMode,
            getValue: (scope) => this.getValue(scope),
            instanceRef: this
        };
        content.innerHTML = this.renderTemplate(template, context);
        if ( !this.viewMode )  this.initArraySortables();
    }

    renderTemplate( template, context ) {
        //if ( template.type === 'Tabs' ) {
            //return this.renderTabsTemplate(template, context);
        //} else {
            return this.renderStandardTemplate(template, context);
        //}
    }

    renderStandardTemplate(template, context) {
        return template.elements.map(element => 
            ElementRenderer.renderElement(element, context)
        ).join('');
    }

    renderTabsTemplate(template, context) {
        let html = '<div>';
        html += '<div class="tab-nav">';
        template.elements.forEach((tab, index) => {
            html += `<button class="tab-button ${index === 0 ? 'active' : ''}" 
                            onclick="window.characterAppInstance.switchTab(${index})"
                            data-tab-index="${index}">
                ${tab.label || `Tab ${index + 1}`}
            </button>`;
        });
        html += '</div>';
        html += '<div class="tab-contents">';
        template.elements.forEach((tab, index) => {
            const isActive = index === 0 ? 'active' : '';
            html += `<div class="tab-content ${isActive}" data-tab-index="${index}">`;
            if (tab.elements) {
                html += tab.elements.map(element => 
                    ElementRenderer.renderElement(element, context)
                ).join('');
            }
            html += '</div>';
        });
        html += '</div></div>';
        return html;
    }


    //============== Miscellaneous

    getValue( scope ) {
        if ( !scope || !this.character ) return '';
        
        // Check if this is a formula
        if (Utils.FormulaEngine.isFormula(scope)) {
            const schema = this.schemas[this.selectedSchemaId];
            return Utils.FormulaEngine.evaluateFormula(scope, this.character.data, schema);
        }
        
        // Handle @ prefix for dot notation field references
        let normalizedScope = scope;
        if (scope.startsWith('@')) {
            normalizedScope = scope.substring(1);
        }
        
        // Use dot notation to access nested values
        const pathParts = normalizedScope.split('.');
        let current = this.character.data;
        
        for (const part of pathParts) {
            if (current === null || current === undefined) return '';
            current = current[part];
        }
        
        return current !== null && current !== undefined ? current : '';
    }

    handleNumberClick( event, scope ) {
        if (this.viewMode)  Utils.showNotification(`Field: ${scope.split('/').pop()}, Value: ${this.getValue(scope)}`, 'info');
    }

    markAsModified(description = 'Character change') {
        this.isModified = true;
        this.updateSaveButton();
    }

    saveState(description) {
        if (this.character) {
            this.undoManager.saveState(this.character, description);
        }
    }

    switchTab( tabIndex ) {
        document.querySelectorAll('.tab-button').forEach((header, index) => { header.classList.toggle('active', index === tabIndex); });
        document.querySelectorAll('.tab-content').forEach((content, index) => { content.classList.toggle('active', index === tabIndex); });
    }

    toggleViewMode() {
        this.viewMode = !this.viewMode;
        this.updateViewModeButton();
        this.renderCharacterSheet();
    }

    updateSaveButton() {
        const saveBtn = document.getElementById('save-character-btn');
        if (saveBtn) {
            saveBtn.disabled = !this.character || !this.isModified || this.selectedCharacterId === '_new';
        }
    }

    updateViewModeButton() {
        const btn = document.getElementById('toggle-view-mode');
        if (btn) {
            btn.textContent = this.viewMode ? '👁️ View' : '✏️ Edit';
            btn.className = this.viewMode ? 'btn btn-success' : 'btn btn-primary';
        }
    }

    updateUI() {
        this.updateSaveButton();
        this.renderCharacterSheet();
    }

    initArraySortables() {
        if (!this.viewMode) {
            Utils.initArraySortables('.array-container[data-allow-reorder="true"]', 
                (scope, oldIndex, newIndex) => {
                    this.saveState('Reorder array items');
                    if (Utils.reorderArrayItems(this.character, scope, oldIndex, newIndex)) {
                        this.markAsModified('Reorder array items');
                    }
                }
            );
        }
    }

    cleanupRichTextEditors() {
        this.richTextEditors.forEach(editor => {
            try {
                editor.destroy();
            } catch (e) {
                console.warn('Error destroying rich text editor:', e);
            }
        });
        this.richTextEditors.clear();
    }

}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    new CharacterEditor();
});