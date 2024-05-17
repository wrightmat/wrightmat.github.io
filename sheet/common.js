// https://code.nkslearning.com/blogs/convert-a-dom-element-to-json-and-from-json-to-a-dom-element_657b39220240466b93a0
function getJSONFromDOMElement(element) {
    if ( !element || typeof element !== 'object' ) {
        return null;
    }
    const json = {};
    let a = element.nodeType;
    json.nodeType = a;
    if ( a === 3 ) {
        let e = element.textContent;
        if ( e && e.trim().length > 0 ) json.text = e;
        else return null;
    } else if ( a === 1 ) {
        json.nodeName = element.nodeName;
        let b = element.attributes;
        if ( b && b.length > 0 ) {
            let attributes = {};
            for ( let i = 0; i < b.length; i++ ) {
                const attribute = b[i];
                attributes[attribute.name] = attribute.value;
            }
            json.attributes = attributes;
        }
        if ( json.nodeName === "svg" ) {
            json.innerHTML = element.innerHTML;
        } else {
            let c = element.childNodes;
            if ( c && c.length > 0 ) {
                let childNodes = [];
                c.forEach((child) => {
                    let r = getJSONFromDOMElement(child);
                    if (r) childNodes.push(r);
                });
                json.childNodes = childNodes;
            }
        }
    } else return null;
    return json;
}

function createElementFromJSON(json) {
    if ( !json || typeof json !== 'object' ) {
        return null;
    }
    if ( json.nodeType === 3 ) {
        return document.createTextNode(json.text || '');
    } else if ( json.nodeType === 1 ) {
        var newNode;
        if ( json.nodeName === 'svg' ) {
            newNode = document.createElementNS(json.attributes.xmlns || 'http://www.w3.org/2000/svg', json.nodeName);
            if ( json.attributes ) {
                for ( const attributeName in json.attributes ) {
                    if ( json.attributes.hasOwnProperty(attributeName) ) {
                        newNode.setAttribute(attributeName, json.attributes[attributeName]);
                    }
                }
            }
            newNode.innerHTML = json.innerHTML;
        } else {
            newNode = document.createElement(json.nodeName);
            if ( json.attributes ) {
                for ( const attributeName in json.attributes ) {
                    if ( json.attributes.hasOwnProperty(attributeName) ) {
                        newNode.setAttribute(attributeName, json.attributes[attributeName]);
                    }
                }
            }
            if ( json.childNodes && json.childNodes.length > 0 ) {
                json.childNodes.forEach((childJSON) => {
                    const childNode = createElementFromJSON(childJSON);
                    if (childNode) {
                        newNode.appendChild(childNode);
                    }
                });
            }
        }
        return newNode;
    } else {
        return null;
    }
}

function download(content, fileName, contentType) {
    var a = document.createElement("a");
    var file = new Blob([content], {type: contentType});
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
}