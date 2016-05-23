
import FactoryMaker from '../../core/FactoryMaker.js';

function DOMParser() {
    var _parser = null,
        _xmlDoc = null;
    
    let instance
    
    instance = {
        getAllSpecificNodes: function(mainNode, nodeName) {
            var i = 0,
                id,
                querySelectorResult,
                returnTab = [];

            if (mainNode) {
                querySelectorResult = mainNode.querySelectorAll(nodeName);
                if (querySelectorResult) {
                    for (i = 0; i < querySelectorResult.length; i++) {
                        id = this.getAttributeValue(querySelectorResult[i], 'xml:id');
                        if (id) {
                            returnTab[id] = querySelectorResult[i].attributes;
                        }
                    }
                }
            }

            return returnTab;
        },

        getAttributeName: function(node, attrValue) {
            var returnValue = [],
                domAttribute = null,
                i = 0,
                attribList = null;
            
            if (node && node.attributes) {
                attribList = node.attributes;
                if (attribList) {
                    for (i = 0; i < attribList.length; i++) {
                        domAttribute = attribList[i];
                        if (domAttribute.value === attrValue) {
                            returnValue.push(domAttribute.name);
                        }
                    }
                }
            }

            return returnValue;
        },

        getAttributeValue: function(node, attrName) {
            var returnValue = null,
                domElem = null,
                attribList = null;

            if (node && node.attributes) {
                attribList = node.attributes;
                if (attribList) {
                    domElem = attribList.getNamedItem(attrName);
                    if (domElem) {
                        returnValue = domElem.value;
                        return returnValue;
                    }
                }
            }

            return returnValue;
        },

        getChildNode: function(nodeParent, childName) {
            var i = 0,
                element;

            if (nodeParent && nodeParent.childNodes) {
                for (i = 0; i < nodeParent.childNodes.length; i++) {
                    element = nodeParent.childNodes[i];
                    if (element.nodeName === childName) {
                        return element;
                    }
                    element = undefined;
                }
            }

            return element;
        },

        getChildNodes: function(nodeParent, childName) {
            var i = 0,
                element = [];

            if (nodeParent && nodeParent.childNodes) {
                for (i = 0; i < nodeParent.childNodes.length; i++) {
                    if (nodeParent.childNodes[i].nodeName === childName) {
                        element.push(nodeParent.childNodes[i]);
                    }
                }
            }

            return element;
        },

        createXmlTree: function(xmlDocStr) {
            if (window.DOMParser) {
                try {
                    if (!_parser) {
                        _parser = new window.DOMParser();
                    }

                    _xmlDoc = _parser.parseFromString(xmlDocStr, "text/xml");
                    if (_xmlDoc.getElementsByTagName('parsererror').length > 0) {
                        throw new Error('Error parsing XML');
                    }
                } catch (e) {
                    _xmlDoc = null;
                }
            }
            return _xmlDoc;
        }
    };
    
    return instance;
}

DOMParser.__dashjs_factory_name = 'DOMParser';
let factory = FactoryMaker.getSingletonFactory(DOMParser);
export default factory

