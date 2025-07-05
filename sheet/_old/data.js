// TTRPG Data Manager - Handles loading JSON files

class DataManagerClass {
    constructor() {
        this.schemas = {};
        this.templates = {};
        this.characters = {};
        this.loaded = false;
    }

    // Load all data files
    async loadAll() {
        if (this.loaded) return;
        
        try {
            // Load schemas
            await Promise.all([
                this.loadSchema('5e'),
                this.loadSchema('bitd')
            ]);

            // Load templates
            await Promise.all([
                this.loadTemplate('5e-default'),
                this.loadTemplate('bitd-default')
            ]);

            // Load characters
            await Promise.all([
                this.loadCharacter('branik'),
                this.loadCharacter('elandra')
            ]);

            this.loaded = true;
            console.log('All data loaded successfully');
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    // Load individual schema
    async loadSchema(schemaId) {
        try {
            const response = await fetch(`schemas/${schemaId}.json`);
            if (!response.ok) throw new Error(`Failed to load schema: ${schemaId}`);
            this.schemas[schemaId] = await response.json();
        } catch (error) {
            console.error(`Error loading schema ${schemaId}:`, error);
        }
    }

    // Load individual template
    async loadTemplate(templateId) {
        try {
            const response = await fetch(`templates/${templateId}.json`);
            if (!response.ok) throw new Error(`Failed to load template: ${templateId}`);
            this.templates[templateId] = await response.json();
        } catch (error) {
            console.error(`Error loading template ${templateId}:`, error);
        }
    }

    // Load individual character
    async loadCharacter(characterId) {
        try {
            const response = await fetch(`characters/${characterId}.json`);
            if (!response.ok) throw new Error(`Failed to load character: ${characterId}`);
            this.characters[characterId] = await response.json();
        } catch (error) {
            console.error(`Error loading character ${characterId}:`, error);
        }
    }

    // Save schema
    async saveSchema(schemaId, schemaData) {
        this.schemas[schemaId] = schemaData;
        // In a real app, this would save to server
        console.log(`Schema ${schemaId} saved to memory`);
        return true;
    }

    // Save template
    async saveTemplate(templateId, templateData) {
        this.templates[templateId] = templateData;
        // In a real app, this would save to server
        console.log(`Template ${templateId} saved to memory`);
        return true;
    }

    // Save character
    async saveCharacter(characterId, characterData) {
        this.characters[characterId] = characterData;
        // In a real app, this would save to server
        console.log(`Character ${characterId} saved to memory`);
        return true;
    }

    // Get all schemas
    getSchemas() {
        return this.schemas;
    }

    // Get schema by ID
    getSchema(schemaId) {
        return this.schemas[schemaId];
    }

    // Get all templates
    getTemplates() {
        return this.templates;
    }

    // Get templates for a specific schema
    getTemplatesForSchema(schemaId) {
        return Object.entries(this.templates)
            .filter(([_, template]) => template.schema === schemaId)
            .reduce((obj, [id, template]) => {
                obj[id] = template;
                return obj;
            }, {});
    }

    // Get template by ID
    getTemplate(templateId) {
        return this.templates[templateId];
    }

    // Get all characters
    getCharacters() {
        return this.characters;
    }

    // Get characters for a specific system and template
    getCharactersForTemplate(schemaId, templateId) {
        return Object.entries(this.characters)
            .filter(([_, char]) => char.system === schemaId && char.template === templateId)
            .reduce((obj, [id, char]) => {
                obj[id] = char;
                return obj;
            }, {});
    }

    // Get character by ID
    getCharacter(characterId) {
        return this.characters[characterId];
    }

    // Delete schema
    deleteSchema(schemaId) {
        delete this.schemas[schemaId];
        return true;
    }

    // Delete template
    deleteTemplate(templateId) {
        delete this.templates[templateId];
        return true;
    }

    // Delete character
    deleteCharacter(characterId) {
        delete this.characters[characterId];
        return true;
    }

    // Generate field paths for a schema
    generateFieldPaths(schemaId) {
        const schema = this.getSchema(schemaId);
        if (!schema) return [];
        
        const paths = [];
        
        function extractPaths(obj, basePath = '#/properties') {
            if (!obj || !obj.properties) return;
            
            for (const [key, prop] of Object.entries(obj.properties)) {
                const currentPath = `${basePath}/${key}`;
                
                if (prop.type === 'object' && prop.properties) {
                    // Add the object itself
                    paths.push({
                        path: currentPath,
                        label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
                    });
                    
                    // Recursively add nested properties
                    extractPaths(prop, `${currentPath}/properties`);
                } else if (prop.type !== 'array') {
                    // Add primitive properties
                    paths.push({
                        path: currentPath,
                        label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
                    });
                } else {
                    // Add array properties
                    paths.push({
                        path: currentPath,
                        label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1') + ' (Array)'
                    });
                }
            }
        }
        
        extractPaths(schema);
        return paths;
    }

    // Export data as downloadable files
    exportSchema(schemaId) {
        const schema = this.getSchema(schemaId);
        if (!schema) return false;
        
        const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${schemaId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    exportTemplate(templateId) {
        const template = this.getTemplate(templateId);
        if (!template) return false;
        
        const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${templateId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    exportCharacter(characterId) {
        const character = this.getCharacter(characterId);
        if (!character) return false;
        
        const blob = new Blob([JSON.stringify(character, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${characterId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    // Import data from files
    importSchema(file, schemaId) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const schema = JSON.parse(e.target.result);
                    this.schemas[schemaId] = schema;
                    resolve(schema);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    importTemplate(file, templateId) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const template = JSON.parse(e.target.result);
                    this.templates[templateId] = template;
                    resolve(template);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    importCharacter(file, characterId) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const character = JSON.parse(e.target.result);
                    this.characters[characterId] = character;
                    resolve(character);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
}

// Create global instance
const DataManager = new DataManagerClass();

// Export for use in other files
if (typeof window !== 'undefined') {
    window.DataManager = DataManager;
}