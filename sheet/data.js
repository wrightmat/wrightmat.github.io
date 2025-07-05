// TTRPG Data Manager - Handles loading JSON files and server communication for saving

class DataManagerClass {
    constructor() {
        this.schemas = {};
        this.templates = {};
        this.characters = {};
        this.loaded = false;
        this.serverUrl = window.location.origin; // Use current origin for server requests
    }

    // Load all data files
    async loadAll() {
	if ( this.loaded ) return;
    
	try {
	    await this.loadAllSchemas();
            await this.loadAllTemplates();
            await this.loadAllCharacters();
            this.loaded = true;
            console.log('All data loaded successfully');
	} catch ( error ) {
            console.error('Error loading data:', error);
	}
    }

async loadAllTemplates() {
    try {
        const response = await fetch('/list/templates');
        if (response.ok) {
            const templateIds = await response.json();
            const templatePromises = templateIds.map(id => this.loadTemplate(id));
            await Promise.all(templatePromises);
            console.log(`Loaded ${templateIds.length} templates from filesystem`);
        } else {
            throw new Error('Failed to fetch template list');
        }
    } catch (error) {
        console.warn('Could not load template list, falling back to hardcoded templates:', error);
        // Fallback to hardcoded templates
        await Promise.all([
            this.loadTemplate('5e-default'),
            this.loadTemplate('bitd-default')
        ]);
    }
}

async loadAllCharacters() {
    try {
        const response = await fetch('/list/characters');
        if (response.ok) {
            const characterIds = await response.json();
            const characterPromises = characterIds.map(id => this.loadCharacter(id));
            await Promise.all(characterPromises);
            console.log(`Loaded ${characterIds.length} characters from filesystem`);
        } else {
            throw new Error('Failed to fetch character list');
        }
    } catch (error) {
        console.warn('Could not load character list, falling back to hardcoded characters:', error);
        // Fallback to hardcoded characters
        await Promise.all([
            this.loadCharacter('branik'),
            this.loadCharacter('elandra')
        ]);
    }
}

async loadAllSchemas() {
    try {
        const response = await fetch('/list/schemas');
        if (response.ok) {
            const schemaIds = await response.json();
            const schemaPromises = schemaIds.map(id => this.loadSchema(id));
            await Promise.all(schemaPromises);
            console.log(`Loaded ${schemaIds.length} schemas from filesystem`);
        } else {
            throw new Error('Failed to fetch schema list');
        }
    } catch (error) {
        console.warn('Could not load schema list, falling back to hardcoded schemas:', error);
        // Fallback to hardcoded schemas
        await Promise.all([
            this.loadSchema('5e'),
            this.loadSchema('bitd')
        ]);
    }
}

    async loadSchema(schemaId) {
        try {
            const response = await fetch(`schemas/${schemaId}.json`);
            if (!response.ok) throw new Error(`Failed to load schema: ${schemaId}`);
            this.schemas[schemaId] = await response.json();
        } catch (error) {
            console.error(`Error loading schema ${schemaId}:`, error);
        }
    }

    async loadTemplate(templateId) {
        try {
            const response = await fetch(`templates/${templateId}.json`);
            if (!response.ok) throw new Error(`Failed to load template: ${templateId}`);
            this.templates[templateId] = await response.json();
        } catch (error) {
            console.error(`Error loading template ${templateId}:`, error);
        }
    }

    async loadCharacter(characterId) {
        try {
            const response = await fetch(`characters/${characterId}.json`);
            if (!response.ok) throw new Error(`Failed to load character: ${characterId}`);
            this.characters[characterId] = await response.json();
        } catch (error) {
            console.error(`Error loading character ${characterId}:`, error);
        }
    }

    // Server communication helper
    async makeServerRequest(endpoint, data = null) {
        const url = `${this.serverUrl}/${endpoint}`;
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        };

        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Server request failed: ${endpoint}`, error);
            throw error;
        }
    }

// Save schema with metadata and actual server write
async saveSchema(schemaData) {
    // For new schemas without an ID, generate one
    if (!schemaData.id) {
        const dataWithMeta = Utils.addMetadata(schemaData, 'schema');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataWithMeta)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to save schema: ${response.statusText}`);
            }
            
            this.schemas[dataWithMeta.id] = dataWithMeta;
            console.log(`Schema ${dataWithMeta.title} saved as ${filename}`);
            return dataWithMeta.id;
        } catch (error) {
            console.error('Error saving schema:', error);
            throw error;
        }
    } else {
        // For existing schemas, update metadata and save with existing ID
        const updatedData = Utils.updateMetadata(schemaData);
        const filename = `${updatedData.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to update schema: ${response.statusText}`);
            }
            
            this.schemas[updatedData.id] = updatedData;
            console.log(`Schema ${updatedData.title} updated`);
            return updatedData.id;
        } catch (error) {
            console.error('Error updating schema:', error);
            throw error;
        }
    }
}

// Save template with metadata and actual server write
async saveTemplate(templateData) {
    // For new templates without an ID, generate one
    if (!templateData.id) {
        const dataWithMeta = Utils.addMetadata(templateData, 'template');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataWithMeta)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to save template: ${response.statusText}`);
            }
            
            this.templates[dataWithMeta.id] = dataWithMeta;
            console.log(`Template ${dataWithMeta.title} saved as ${filename}`);
            return dataWithMeta.id;
        } catch (error) {
            console.error('Error saving template:', error);
            throw error;
        }
    } else {
        // For existing templates, update metadata and save with existing ID
        const updatedData = Utils.updateMetadata(templateData);
        const filename = `${updatedData.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to update template: ${response.statusText}`);
            }
            
            this.templates[updatedData.id] = updatedData;
            console.log(`Template ${updatedData.title} updated`);
            return updatedData.id;
        } catch (error) {
            console.error('Error updating template:', error);
            throw error;
        }
    }
}

// Save character with metadata and actual server write
async saveCharacter(characterData) {
    // For new characters without an ID, generate one
    if (!characterData.id) {
        const dataWithMeta = Utils.addMetadata(characterData, 'character');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=characters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataWithMeta)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to save character: ${response.statusText}`);
            }
            
            this.characters[dataWithMeta.id] = dataWithMeta;
            console.log(`Character ${dataWithMeta.data?.name || dataWithMeta.title} saved as ${filename}`);
            return dataWithMeta.id;
        } catch (error) {
            console.error('Error saving character:', error);
            throw error;
        }
    } else {
        // For existing characters, update metadata and save with existing ID
        const updatedData = Utils.updateMetadata(characterData);
        const filename = `${updatedData.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=characters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to update character: ${response.statusText}`);
            }
            
            this.characters[updatedData.id] = updatedData;
            console.log(`Character ${updatedData.data?.name || updatedData.title} updated`);
            return updatedData.id;
        } catch (error) {
            console.error('Error updating character:', error);
            throw error;
        }
    }
}

    // Delete schema from server
    async deleteSchema(schemaId) {
        try {
            await this.makeServerRequest(`delete?file=${schemaId}.json&dir=schemas`);
            delete this.schemas[schemaId];
            console.log(`Schema ${schemaId} deleted from server`);
            return true;
        } catch (error) {
            console.error(`Failed to delete schema ${schemaId}:`, error);
            // Still remove from memory
            delete this.schemas[schemaId];
            throw error;
        }
    }

    // Delete template from server
    async deleteTemplate(templateId) {
        try {
            await this.makeServerRequest(`delete?file=${templateId}.json&dir=templates`);
            delete this.templates[templateId];
            console.log(`Template ${templateId} deleted from server`);
            return true;
        } catch (error) {
            console.error(`Failed to delete template ${templateId}:`, error);
            // Still remove from memory
            delete this.templates[templateId];
            throw error;
        }
    }

    // Delete character from server
    async deleteCharacter(characterId) {
        try {
            await this.makeServerRequest(`delete?file=${characterId}.json&dir=characters`);
            delete this.characters[characterId];
            console.log(`Character ${characterId} deleted from server`);
            return true;
        } catch (error) {
            console.error(`Failed to delete character ${characterId}:`, error);
            // Still remove from memory
            delete this.characters[characterId];
            throw error;
        }
    }

generateFieldPaths(schemaId) {
    const schema = this.getSchema(schemaId);
    if (!schema) return [];
    
    const paths = [];
    
    function extractPaths(obj, basePath = '#/properties', parentLabel = '') {
        if (!obj || !obj.properties) return;
        
        for (const [key, prop] of Object.entries(obj.properties)) {
            const currentPath = `${basePath}/${key}`;
            const fieldLabel = prop.label || Utils.generateFieldName(key);
            const fullLabel = parentLabel ? `${parentLabel} > ${fieldLabel}` : fieldLabel;
            
            if (prop.type === 'object' && prop.properties) {
                // Add the object itself if it has a meaningful label
                if (prop.label) {
                    paths.push({
                        path: currentPath,
                        label: fullLabel,
                        type: prop.type,
                        category: prop.category,
                        description: prop.description
                    });
                }
                
                // Recursively add nested properties
                extractPaths(prop, `${currentPath}/properties`, fullLabel);
            } else if (prop.type !== 'array' || prop.items?.type !== 'object') {
                // Add primitive properties and simple arrays
                paths.push({
                    path: currentPath,
                    label: fullLabel,
                    type: prop.type,
                    category: prop.category,
                    description: prop.description
                });
            } else {
                // Add array properties
                paths.push({
                    path: currentPath,
                    label: fullLabel + ' (Array)',
                    type: prop.type,
                    category: prop.category,
                    description: prop.description
                });
            }
        }
    }
    
    extractPaths(schema);
    
    // Sort by category order, then by label
    const categoryOrder = schema.categories || {};
    return paths.sort((a, b) => {
        const aCategoryOrder = categoryOrder[a.category]?.order || 999;
        const bCategoryOrder = categoryOrder[b.category]?.order || 999;
        
        if (aCategoryOrder !== bCategoryOrder) {
            return aCategoryOrder - bCategoryOrder;
        }
        return a.label.localeCompare(b.label);
    });
}

    // Get all schemas
    getSchemas() {
        return this.schemas;
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

// Get schema by index or ID
getSchemaByIndex(index) {
    return Object.values(this.schemas).find(schema => schema.index === index);
}

// Get template by index or ID  
getTemplateByIndex(index) {
    return Object.values(this.templates).find(template => template.index === index);
}

// Get character by index or ID
getCharacterByIndex(index) {
    return Object.values(this.characters).find(character => character.index === index);
}

// Update existing getSchema to handle both ID and index
getSchema(ref) {
    // Try direct ID lookup first
    if (this.schemas[ref]) {
        return this.schemas[ref];
    }
    // Fall back to index lookup
    return this.getSchemaByIndex(ref);
}

// Update existing getTemplate to handle both ID and index
getTemplate(ref) {
    // Try direct ID lookup first
    if (this.templates[ref]) {
        return this.templates[ref];
    }
    // Fall back to index lookup
    return this.getTemplateByIndex(ref);
}

// Update existing getCharacter to handle both ID and index
getCharacter(ref) {
    // Try direct ID lookup first
    if (this.characters[ref]) {
        return this.characters[ref];
    }
    // Fall back to index lookup
    return this.getCharacterByIndex(ref);
}

    // Export data as downloadable files (unchanged)
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

    // Import data from files (unchanged)
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