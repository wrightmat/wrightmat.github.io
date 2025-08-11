// TTRPG Data Manager - Handles loading JSON files and server communication for CRUD operations

class DataManagerClass {
    constructor() {
        this.schemas = {};
        this.templates = {};
        this.characters = {};
	this.schemaIndexMap = {};
        this.templateIndexMap = {};
        this.characterIndexMap = {};
        this.loaded = false;
        this.serverUrl = window.location.origin; // Use current origin for server requests
    }

    //============= Load Functions
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

    async loadAllSchemas() {
        try {
            const response = await fetch('/list/schemas');
            if ( response.ok ) {
                const schemaIds = await response.json();
                const schemaPromises = schemaIds.map(id => this.loadSchema(id));
                await Promise.all(schemaPromises);
                console.log(`Loaded ${schemaIds.length} schemas from filesystem`);
            } else {
                throw new Error('Failed to fetch schema list');
            }

        } catch (error) {
            console.warn('Could not load schema list, falling back to hardcoded schemas:', error);
            // Fallback to hardcoded schemas - TODO: UPDATE TO A SINGLE DUMMY/EXAMPLE SCHEMA
            await Promise.all([
                this.loadSchema('5e'),
                this.loadSchema('bitd')
            ]);
        }
    }

    async loadAllTemplates() {
        try {
            const response = await fetch('/list/templates');
            if ( response.ok ) {
                const templateIds = await response.json();
                const templatePromises = templateIds.map(id => this.loadTemplate(id));
                await Promise.all(templatePromises);
                console.log(`Loaded ${templateIds.length} templates from filesystem`);
            } else {
                throw new Error('Failed to fetch template list');
            }

        } catch (error) {
            console.warn('Could not load template list, falling back to hardcoded templates:', error);
            // Fallback to hardcoded templates - TODO: UPDATE TO A SINGLE DUMMY/EXAMPLE TEMPLATE
            await Promise.all([
                this.loadTemplate('5e-default'),
                this.loadTemplate('bitd-default')
            ]);
        }
    }

    async loadAllCharacters() {
        try {
            const response = await fetch('/list/characters');
            if ( response.ok ) {
                const characterIds = await response.json();
                const characterPromises = characterIds.map(id => this.loadCharacter(id));
                await Promise.all(characterPromises);
                console.log(`Loaded ${characterIds.length} characters from filesystem`);
            } else {
                throw new Error('Failed to fetch character list');
            }

        } catch (error) {
            console.warn('Could not load character list, falling back to hardcoded characters:', error);
            // Fallback to hardcoded characters - TODO: UPDATE TO A SINGLE DUMMY/EXAMPLE CHARACTER
            await Promise.all([
                this.loadCharacter('branik'),
                this.loadCharacter('elandra')
            ]);
        }
    }

    async loadSchema( schemaId ) {
        try {
            const response = await fetch(`schemas/${schemaId}.json`);
            if (!response.ok) throw new Error(`Failed to load schema: ${schemaId}`);
            const schema = await response.json();
            this.schemas[schemaId] = schema;
            if ( schema.index )  this.schemaIndexMap[schema.index] = schemaId;

        } catch (error) {
            console.error(`Error loading schema ${schemaId}:`, error);
        }
    }

    async loadTemplate( templateId ) {
        try {
            const response = await fetch(`templates/${templateId}.json`);
            if (!response.ok) throw new Error(`Failed to load template: ${templateId}`);
            const template = await response.json();
            this.templates[templateId] = template;
            if ( template.index )  this.templateIndexMap[template.index] = templateId;

        } catch (error) {
            console.error(`Error loading template ${templateId}:`, error);
        }
    }

    async loadCharacter( characterId ) {
        try {
            const response = await fetch(`characters/${characterId}.json`);
            if (!response.ok) throw new Error(`Failed to load character: ${characterId}`);
            const character = await response.json();
            this.characters[characterId] = character;
            if ( character.index )  this.characterIndexMap[character.index] = characterId;

        } catch (error) {
            console.error(`Error loading character ${characterId}:`, error);
        }
    }


    //========== Get Functions

    getSchemas() {  return this.schemas;  }
    getTemplates() {  return this.templates;  }
    getCharacters() {  return this.characters;  }

    getSchema( ref ) {
        if ( this.schemas[ref] )  return this.schemas[ref];
        return this.getSchemaByIndex(ref);    // Fall back to index lookup if direct ID lookup fails
    }

    getTemplate( ref ) {
        if ( this.templates[ref] )  return this.templates[ref];
        return this.getTemplateByIndex(ref);    // Fall back to index lookup if direct ID lookup fails
    }

    getCharacter( ref ) {
        if ( this.characters[ref] )  return this.characters[ref];
        return this.getCharacterByIndex(ref);    // Fall back to index lookup if direct ID lookup fails
    }

    getSchemaByIndex( index ) {
        const schemaId = this.schemaIndexMap[index];
        return schemaId ? this.schemas[schemaId] : undefined;
    }

    getTemplateByIndex( index ) {
        const templateId = this.templateIndexMap[index];
        return templateId ? this.templates[templateId] : undefined;
    }

    getCharacterByIndex( index ) {
        const characterId = this.characterIndexMap[index];
        return characterId ? this.characters[characterId] : undefined;
    }

    getTemplatesForSchema( schemaId ) {
        return Object.entries(this.templates)
            .filter(([_, template]) => template.schema === schemaId)
            .reduce((obj, [id, template]) => { obj[id] = template; return obj;
            }, {});
    }

    getCharactersForTemplate( schemaId, templateId ) {
        return Object.entries(this.characters)
            .filter(([_, char]) => char.system === schemaId && char.template === templateId)
            .reduce((obj, [id, char]) => { obj[id] = char; return obj;
            }, {});
    }


    //========== CRUD Functions
async saveSchema( schemaData ) {
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
            if ( !response.ok )  throw new Error(`Failed to save schema: ${response.statusText}`);
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
            if ( !response.ok )  throw new Error(`Failed to update schema: ${response.statusText}`);
            this.schemas[updatedData.id] = updatedData;
            console.log(`Schema ${updatedData.title} updated`);
            return updatedData.id;
        } catch (error) {
            console.error('Error updating schema:', error);
            throw error;
        }
    }
}

async saveTemplate( templateData ) {
    // For new templates without an ID, generate one
    if ( !templateData.id ) {
        const dataWithMeta = Utils.addMetadata(templateData, 'template');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataWithMeta)
            });
            if ( !response.ok )  throw new Error(`Failed to save template: ${response.statusText}`);
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
            if ( !response.ok )  throw new Error(`Failed to update template: ${response.statusText}`);
            this.templates[updatedData.id] = updatedData;
            console.log(`Template ${updatedData.title} updated`);
            return updatedData.id;
        } catch (error) {
            console.error('Error updating template:', error);
            throw error;
        }
    }

    // Update index map after successful save
    if ( template.index && savedId )  this.templateIndexMap[template.index] = savedId;
}

async saveCharacter( characterData ) {
    // For new characters without an ID, generate one
    if ( !characterData.id ) {
        const dataWithMeta = Utils.addMetadata(characterData, 'character');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=characters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataWithMeta)
            });
            if ( !response.ok )  throw new Error(`Failed to save character: ${response.statusText}`);
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
            if ( !response.ok )  throw new Error(`Failed to update character: ${response.statusText}`);
            this.characters[updatedData.id] = updatedData;
            console.log(`Character ${updatedData.data?.name || updatedData.title} updated`);
            return updatedData.id;
        } catch (error) {
            console.error('Error updating character:', error);
            throw error;
        }
    }

    // Update index map after successful save
    if (character.index && savedId)  this.characterIndexMap[character.index] = savedId;
}

    async deleteSchema( schemaId ) {
        try {
	    const schema = this.schemas[schemaId];
            await this.makeServerRequest(`delete?file=${schemaId}.json&dir=schemas`);
            delete this.schemas[schemaId];
            if ( schema && schema.index )  delete this.schemaIndexMap[schema.index];
            console.log(`Schema ${schemaId} deleted from server`);
            return true;
        } catch (error) {
            console.error(`Failed to delete schema ${schemaId}:`, error);
            // Still remove from memory
            delete this.schemas[schemaId];
            throw error;
        }
    }

    async deleteTemplate( templateId ) {
        try {
	    const template = this.templates[templateId];
            await this.makeServerRequest(`delete?file=${templateId}.json&dir=templates`);
            delete this.templates[templateId];
            if ( template && template.index )  delete this.templateIndexMap[template.index];
            console.log(`Template ${templateId} deleted from server`);
            return true;
        } catch (error) {
            console.error(`Failed to delete template ${templateId}:`, error);
            // Still remove from memory
            delete this.templates[templateId];
            throw error;
        }
    }

    async deleteCharacter( characterId ) {
        try {
	    const character = this.characters[characterId];
            await this.makeServerRequest(`delete?file=${characterId}.json&dir=characters`);
            delete this.characters[characterId];
            if ( character && character.index )  delete this.characterIndexMap[character.index];
            console.log(`Character ${characterId} deleted from server`);
            return true;
        } catch (error) {
            console.error(`Failed to delete character ${characterId}:`, error);
            // Still remove from memory
            delete this.characters[characterId];
            throw error;
        }
    }


    //=============== Import/Export (JSON) Functions

    exportSchema( schemaId ) {
        const schema = this.getSchema(schemaId);
        if ( !schema ) return false;
        
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

    exportTemplate( templateId ) {
        const template = this.getTemplate(templateId);
        if ( !template ) return false;
        
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

    exportCharacter( characterId ) {
        const character = this.getCharacter(characterId);
        if ( !character ) return false;
        
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

    importSchema( file, schemaId ) {
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

    importTemplate( file, templateId ) {
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

    importCharacter( file, characterId ) {
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


    //========== Helper Functions

    generateFieldPaths( schemaId ) {
        const schema = this.getSchema(schemaId);
        if ( !schema ) return [];

        const paths = [];
        const generatePaths = (obj, currentPath = '', parentLabel = '') => {
            if (!obj || !obj.properties) return;
            for (const [key, field] of Object.entries(obj.properties)) {
                const path = currentPath ? `${currentPath}.${key}` : key;
                const label = field.label || Utils.generateFieldName(key);
                const fullLabel = parentLabel ? `${parentLabel} > ${label}` : label;
            
                // Add the field itself - this will include arrays like "spells" and "inventory"
	        const fieldData = {
		    path: path,
		    label: fullLabel,
		    type: field.type,
		    category: field.category || 'general'
	        };
	        if ( field.enum )  fieldData.enum = field.enum;
	        paths.push(fieldData);

		// If field has enum, also add it as enum type
		if ( field.enum ) {
		    paths.push({ path: path, label: `${fullLabel} (enum)`, type: 'enum', category: field.category || 'general', enum: field.enum });
		}
            
                // For objects, recurse into their properties
                if ( field.type === 'object' && field.properties ) {
                    generatePaths(field, path, fullLabel);
                }
            
                // For arrays with object items, also add common item properties
                if ( field.type === 'array' && field.items && field.items.properties ) {
                    for (const [itemKey, itemField] of Object.entries(field.items.properties)) {
                        const itemPath = `${path}.${itemKey}`;
                        const itemLabel = itemField.label || Utils.generateFieldName(itemKey);
		        const itemFieldData = {
			    path: itemPath,
			    label: `${fullLabel} > ${itemLabel}`,
			    type: itemField.type,
			    category: field.category || 'array-item'
		        };
		        if ( itemField.enum )  itemFieldData.enum = itemField.enum;
		        paths.push(itemFieldData);
			// If nested field has enum, also add it as enum type
			if ( itemField.enum && itemField.type === 'string' ) {
			    paths.push({ path: itemPath, label: `${fullLabel} > ${itemLabel} (enum)`, type: 'enum', category: field.category || 'array-item', enum: itemField.enum });
			}
                    }
                }
            }
        };
        generatePaths(schema);
        return paths;
    }

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

}

// Create global instance and export for use in other files
const DataManager = new DataManagerClass();
if ( typeof window !== 'undefined' )  window.DataManager = DataManager;
