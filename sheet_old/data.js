class DataManagerClass {
    constructor() {
        this.schemas = {};
        this.templates = {};
        this.characters = {};
        this.schemaMetadata = {};
        this.templateMetadata = {};
        this.characterMetadata = {};
        this.schemaIndexMap = {};
        this.templateIndexMap = {};
        this.characterIndexMap = {};
        this.loaded = false;
        this.serverUrl = window.location.origin;
        this.sessionToken = localStorage.getItem('session_token');
    }

    // Session management
    setSessionToken(token) {
        this.sessionToken = token;
        if (token) {
            localStorage.setItem('session_token', token);
        } else {
            localStorage.removeItem('session_token');
        }
    }

    getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.sessionToken) {
            headers['Authorization'] = `Bearer ${this.sessionToken}`;
        }
        return headers;
    }

    //============= Load Functions
    async loadAll() {
        if (this.loaded) return;
    
        try {
            await this.loadAllSchemas();
            await this.loadAllTemplates();
            await this.loadAllCharacters();
            this.loaded = true;
            console.log('All data loaded successfully');
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    async loadAllSchemas() {
        try {
            const response = await fetch('/list/schemas', {
                headers: this.getAuthHeaders()
            });
            if ( response.ok ) {
                const schemaData = await response.json();

		this.schemaMetadata = {};
		schemaData.forEach(meta => { this.schemaMetadata[meta.id] = meta; });

		const schemaPromises = schemaData.map(meta => this.loadSchema(meta.id));
		await Promise.all(schemaPromises);
		console.log(`Loaded ${schemaData.length} schemas from database`);
            } else {
                throw new Error('Failed to fetch schema list');
            }
        } catch ( error ) {
            console.warn('Could not load schema list:', error);
        }
    }

    async loadAllTemplates() {
        try {
            const response = await fetch('/list/templates', {
                headers: this.getAuthHeaders()
            });
            if ( response.ok ) {
                const templateData = await response.json();

                this.templateMetadata = {};
                templateData.forEach(meta => { this.templateMetadata[meta.id] = meta; });

                const templatePromises = templateData.map(meta => this.loadTemplate(meta.id));
                await Promise.all(templatePromises);
                console.log(`Loaded ${templateData.length} templates from database`);
            } else {
                throw new Error('Failed to fetch template list');
            }
        } catch ( error ) {
            console.warn('Could not load template list:', error);
        }
    }

    async loadAllCharacters() {
        try {
            const response = await fetch('/list/characters', {
                headers: this.getAuthHeaders()
            });
            if ( response.ok ) {
                const characterData = await response.json();

                this.characterMetadata = {};
                characterData.forEach(meta => { this.characterMetadata[meta.id] = meta; });
            
                const characterPromises = characterData.map(meta => this.loadCharacter(meta.id));
                await Promise.all(characterPromises);
                console.log(`Loaded ${characterData.length} characters from database`);
            } else {
                throw new Error('Failed to fetch character list');
            }
        } catch ( error ) {
            console.warn('Could not load character list:', error);
        }
    }

    async loadSchema( schemaId ) {
        try {
            const response = await fetch(`data/schemas/${schemaId}.json`, {
                headers: this.getAuthHeaders()
            });
            if ( !response.ok ) throw new Error(`Failed to load schema: ${schemaId}`);
            const schema = await response.json();
            this.schemas[schemaId] = schema;
            if ( schema.index ) this.schemaIndexMap[schema.index] = schemaId;
        } catch ( error ) {
            console.error(`Error loading schema ${schemaId}:`, error);
        }
    }

    async loadTemplate( templateId ) {
        try {
            const response = await fetch(`data/templates/${templateId}.json`, {
                headers: this.getAuthHeaders()
            });
            if ( !response.ok ) throw new Error(`Failed to load template: ${templateId}`);
            const template = await response.json();
            this.templates[templateId] = template;
            if ( template.index ) this.templateIndexMap[template.index] = templateId;
        } catch ( error ) {
            console.error(`Error loading template ${templateId}:`, error);
        }
    }

    async loadCharacter( characterId ) {
        try {
            const response = await fetch(`data/characters/${characterId}.json`, {
                headers: this.getAuthHeaders()
            });
            if ( !response.ok ) throw new Error(`Failed to load character: ${characterId}`);
            const character = await response.json();
            this.characters[characterId] = character;
            if ( character.index ) this.characterIndexMap[character.index] = characterId;
        } catch ( error ) {
            console.error(`Error loading character ${characterId}:`, error);
        }
    }

    //========== Get Functions
    getSchemas() { return this.schemas; }
    getTemplates() { return this.templates; }
    getCharacters() { return this.characters; }

    getSchema(ref) {
        if (this.schemas[ref]) return this.schemas[ref];
        return this.getSchemaByIndex(ref);
    }

    getTemplate(ref) {
        if (this.templates[ref]) return this.templates[ref];
        return this.getTemplateByIndex(ref);
    }

    getCharacter(ref) {
        if (this.characters[ref]) return this.characters[ref];
        return this.getCharacterByIndex(ref);
    }

    getSchemaByIndex(index) {
        const schemaId = this.schemaIndexMap[index];
        return schemaId ? this.schemas[schemaId] : undefined;
    }

    getTemplateByIndex(index) {
        const templateId = this.templateIndexMap[index];
        return templateId ? this.templates[templateId] : undefined;
    }

    getCharacterByIndex(index) {
        const characterId = this.characterIndexMap[index];
        return characterId ? this.characters[characterId] : undefined;
    }

    getTemplatesForSchema(schemaId) {
        return Object.entries(this.templates)
            .filter(([_, template]) => template.schema === schemaId)
            .reduce((obj, [id, template]) => { obj[id] = template; return obj; }, {});
    }

    getCharactersForTemplate(schemaId, templateId) {
        return Object.entries(this.characters)
            .filter(([_, char]) => char.system === schemaId && char.template === templateId)
            .reduce((obj, [id, char]) => { obj[id] = char; return obj; }, {});
    }

    getSchemaMetadata(schemaId) {
        return this.schemaMetadata[schemaId] || null;
    }

    getTemplateMetadata(templateId) {
        return this.templateMetadata[templateId] || null;
    }

    getCharacterMetadata(characterId) {
        return this.characterMetadata[characterId] || null;
    }

    getSchemasWithMetadata() {
        return Object.keys(this.schemas).map(id => ({
            ...this.schemas[id],
            metadata: this.schemaMetadata[id]
        }));
    }

    getTemplatesWithMetadata() {
        return Object.keys(this.templates).map(id => ({
            ...this.templates[id],
            metadata: this.templateMetadata[id]
        }));
    }

    getCharactersWithMetadata() {
        return Object.keys(this.characters).map(id => ({
            ...this.characters[id],
            metadata: this.characterMetadata[id]
        }));
    }


    //========== CRUD Functions
    async saveSchema(schemaData) {
        const dataWithMeta = schemaData.id ? Utils.updateMetadata(schemaData) : Utils.addMetadata(schemaData, 'schema');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=schemas', {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(dataWithMeta)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 503) {
                    throw new Error('File is busy, please try again in a moment');
                }
                throw new Error(`Failed to save schema: ${errorText}`);
            }
            
            this.schemas[dataWithMeta.id] = dataWithMeta;
            if (dataWithMeta.index) this.schemaIndexMap[dataWithMeta.index] = dataWithMeta.id;
            console.log(`Schema ${dataWithMeta.title} saved as ${filename}`);
            return dataWithMeta.id;
        } catch (error) {
            console.error('Error saving schema:', error);
            throw error;
        }
    }

    async saveTemplate(templateData) {
        const dataWithMeta = templateData.id ? Utils.updateMetadata(templateData) : Utils.addMetadata(templateData, 'template');
        const filename = `${dataWithMeta.id}.json`;
        
        try {
            const response = await fetch('/write?file=' + filename + '&dir=templates', {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(dataWithMeta)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 503) {
                    throw new Error('File is busy, please try again in a moment');
                }
                throw new Error(`Failed to save template: ${errorText}`);
            }
            
            this.templates[dataWithMeta.id] = dataWithMeta;
            if (dataWithMeta.index) this.templateIndexMap[dataWithMeta.index] = dataWithMeta.id;
           return dataWithMeta.id;
       } catch (error) {
           console.error('Error saving template:', error);
           throw error;
       }
   }

   async saveCharacter(characterData) {
       const dataWithMeta = characterData.id ? Utils.updateMetadata(characterData) : Utils.addMetadata(characterData, 'character');
       const filename = `${dataWithMeta.id}.json`;

       try {
           const response = await fetch('/write?file=' + filename + '&dir=characters', {
               method: 'POST',
               headers: this.getAuthHeaders(),
               body: JSON.stringify(dataWithMeta)
           });
           
           if ( !response.ok ) {
               const errorText = await response.text();
               if (response.status === 503) {
                   throw new Error('File is busy, please try again in a moment');
               }
               throw new Error(`Failed to save character: ${errorText}`);
           }
           
           this.characters[dataWithMeta.id] = dataWithMeta;
           if ( dataWithMeta.index ) this.characterIndexMap[dataWithMeta.index] = dataWithMeta.id;
           console.log(`Character ${dataWithMeta.data?.name || dataWithMeta.title} saved as ${filename}`);
           return dataWithMeta.id;
       } catch ( error ) {
           console.error('Error saving character:', error);
           throw error;
       }
   }

   async deleteSchema(schemaId) {
       try {
           const schema = this.schemas[schemaId];
           const response = await fetch(`/delete?file=${schemaId}.json&dir=schemas`, {
               method: 'POST',
               headers: this.getAuthHeaders()
           });
           
           if (!response.ok) {
               throw new Error(`Failed to delete schema: ${response.statusText}`);
           }
           
           delete this.schemas[schemaId];
           if (schema && schema.index) delete this.schemaIndexMap[schema.index];
           console.log(`Schema ${schemaId} deleted from server`);
           return true;
       } catch (error) {
           console.error(`Failed to delete schema ${schemaId}:`, error);
           delete this.schemas[schemaId];
           throw error;
       }
   }

   async deleteTemplate(templateId) {
       try {
           const template = this.templates[templateId];
           const response = await fetch(`/delete?file=${templateId}.json&dir=templates`, {
               method: 'POST',
               headers: this.getAuthHeaders()
           });
           
           if (!response.ok) {
               throw new Error(`Failed to delete template: ${response.statusText}`);
           }
           
           delete this.templates[templateId];
           if (template && template.index) delete this.templateIndexMap[template.index];
           console.log(`Template ${templateId} deleted from server`);
           return true;
       } catch (error) {
           console.error(`Failed to delete template ${templateId}:`, error);
           delete this.templates[templateId];
           throw error;
       }
   }

   async deleteCharacter(characterId) {
       try {
           const character = this.characters[characterId];
           const response = await fetch(`/delete?file=${characterId}.json&dir=characters`, {
               method: 'POST',
               headers: this.getAuthHeaders()
           });
           
           if (!response.ok) {
               throw new Error(`Failed to delete character: ${response.statusText}`);
           }
           
           delete this.characters[characterId];
           if (character && character.index) delete this.characterIndexMap[character.index];
           console.log(`Character ${characterId} deleted from server`);
           return true;
       } catch (error) {
           console.error(`Failed to delete character ${characterId}:`, error);
           delete this.characters[characterId];
           throw error;
       }
   }

   //=============== Import/Export (JSON) Functions
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

   //========== Helper Functions
   generateFieldPaths(schemaId) {
       const schema = this.getSchema(schemaId);
       if (!schema) return [];

       const paths = [];
       const generatePaths = (obj, currentPath = '', parentLabel = '') => {
           if (!obj || !obj.properties) return;
           for (const [key, field] of Object.entries(obj.properties)) {
               const path = currentPath ? `${currentPath}.${key}` : key;
               const label = field.label || Utils.generateFieldName(key);
               const fullLabel = parentLabel ? `${parentLabel} > ${label}` : label;
           
               const fieldData = {
                   path: path,
                   label: fullLabel,
                   type: field.type,
                   category: field.category || 'general'
               };
               if (field.enum) fieldData.enum = field.enum;
               paths.push(fieldData);
           
               if (field.type === 'object' && field.properties) {
                   generatePaths(field, path, fullLabel);
               }
           
               if (field.type === 'array' && field.items && field.items.properties) {
                   for (const [itemKey, itemField] of Object.entries(field.items.properties)) {
                       const itemPath = `${path}.${itemKey}`;
                       const itemLabel = itemField.label || Utils.generateFieldName(itemKey);
                       const itemFieldData = {
                           path: itemPath,
                           label: `${fullLabel} > ${itemLabel}`,
                           type: itemField.type,
                           category: field.category || 'array-item'
                       };
                       if (itemField.enum) itemFieldData.enum = itemField.enum;
                       paths.push(itemFieldData);
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
           headers: this.getAuthHeaders(),
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
if (typeof window !== 'undefined') window.DataManager = DataManager;