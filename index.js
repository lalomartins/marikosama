import Schema from 'mongoose/lib/schema';
export {Schema};

import {CompoundValidationError, makeDeepGetError} from './errors';

export const modelData = Symbol(`modelData`);
export const initialize = Symbol(`initialize`);
export const nestedProxies = Symbol(`nestedProxies`);
export const proxySelf = Symbol(`proxySelf`);
export const proxyStructure = Symbol(`proxyStructure`);


export class Model {
  static options = {
    createEmptySubDocs: false,
    initialize: true,
    validateOnCreation: true,
    accessors: true,
  }

  constructor(data) {
    const Class = this.constructor;
    if (!Class.hasOwnProperty(`subDocClasses`))
      Class.createSubDocClasses();
    if (Class.options.accessors && !Class.hasOwnProperty(nestedProxies)) {
      const proxies = Class[nestedProxies] = new Map();
      Class.schema.eachPath((path, schemaPath) => {
        const parts = path.split(`.`);
        if (Class.prototype[parts[0]] !== undefined) return;
        if (parts.length > 1) {
          const head = parts.shift();
          // does the last one have to be different?
          // const tail = parts.pop();
          if (!proxies.has(head))
            proxies.set(head, {
              [proxyStructure]: new Map(),
            });
          let proxy = proxies.get(head);
          let partial = head;
          let structure = proxy[proxyStructure];
          for (const part of parts) {
            if (!structure.has(part)) {
              const newStructure = new Map();
              const newProxy = {};
              newStructure.parent = structure;
              newStructure.proxy = newProxy;
              structure.path = partial;
              structure.set(part, newStructure);
              Object.defineProperty(proxy, part, {
                get() {
                  debugger;
                  return newProxy;
                },
                set(value) {

                },
              });
              proxy = newProxy;
              structure = newStructure;
            }
            partial = `${partial}.${part}`;
            // proxy = ???
          }
        }
      });
    }
    if (Class.options.initialize)
      this[initialize](data);
  }

  [initialize](data) {
    const Class = this.constructor;
    this[modelData] = {...data};
    for (const [key, SDClass] of Class.subDocClasses) {
      if (data[key] !== undefined || Class.options.createEmptySubDocs) {
        this[modelData][key] = new SDClass(data[key]);
      }
    }
    if (Class.options.validateOnCreation && data !== undefined)
      this.validateSync({throw: true});
  }

  static createSubDocClasses() {
    this.subDocClasses = new Map();
    this.schema.eachPath((name, schemaPath) => {
      if (schemaPath.hasOwnProperty(`schema`)) {
        if (schemaPath.instance === `Array`) {
          class SubDocArray extends ArrayModel {
            static schema = schemaPath.schema
            static options = this.options
          }
          this.subDocClasses.set(name, SubDocArray);
          SubDocArray.docClass = class SubDoc extends Model {
            static schema = schemaPath.schema
            static options = this.options
          };
        } else {
          this.subDocClasses.set(name, class SubDoc extends Model {
            static schema = schemaPath.schema
            static options = this.options
          });
        }
      }
    });
  }

  validateSync(options = {}) {
    const {schema} = this.constructor;
    if (schema) {
      const errors = [];
      // not schema.eachPath() so that we can return partway
      for (const path of Object.getOwnPropertyNames(schema.paths)) {
        const schemaPath = schema.paths[path];
        let item;
        try {
          item = this.deepGet(path);
        } catch (error) {
          if (error.fullPath === path) item = undefined;
          else throw error;
        }
        let error;
        // TODO: the path itself may have validations, this is especially useful
        // (and used?) with arrays.
        if (item && item.validateSync)
          error = item.validateSync(options);
        else
          error = schemaPath.doValidateSync(item);
        if (error) {
          if (options.collect) errors.push([path, error]);
          else if (options.throw) throw error;
          else return error;
        }
      }
      if (errors.length) {
        const collected = new CompoundValidationError(errors);
        if (options.throw) throw collected;
        else return collected;
      }
    }
  }

  validate(options = {}, callback) {
    // We don't really support async validators yet; not a high priority for now.
    // We're providing this method just to have a compatible-ish API.
    if (typeof option === `function`) {
      callback = options;
      options = {};
    }
    if (callback) {
      this.validate(options).then(callback, callback);
      return;
    }
    return new Promise((resolve, reject) => {
      const error = this.validateSync({...options, throw: false});
      if (error) reject(error);
      else resolve();
    });
  }

  _deepGetMinusOne(path, parent) {
    if (typeof path !== `string`) return this[modelData][path];
    const re = /(?:\.?([a-zA-Z_$][\w$]*))|(?:\[([^\]]+)\])/gy;
    let partial = this[modelData];
    let previousIndex = 0;
    let lastId;
    while (re.lastIndex < path.length) {
      if (partial === undefined) {
        const error = new TypeError(`Cannot read path ${path.substr(re.lastIndex)} of undefined ${path.substr(0, re.lastIndex)}`);
        error.fullPath = path;
        error.lastValid = path.substr(0, re.lastIndex);
        throw error;
      }
      parent = partial;
      previousIndex = re.lastIndex; // for the error message
      const match = re.exec(path);
      if (!match) throw makeDeepGetError(path, path.substr(previousIndex));
      const [text, attr, index] = match;
      if (attr !== undefined) {
        lastId = attr;
        partial = partial[attr];
      } else if (index !== undefined) {
        try {
          lastId = JSON.parse(index);
        } catch (e) {
          throw makeDeepGetError(path, index);
        }
        partial = partial[lastId];
      } else {
        // not sure how this would happen but…
        throw makeDeepGetError(path, text);
      }

      if (partial && partial._deepGetMinusOne && re.lastIndex < path.length)
        try {
          return partial._deepGetMinusOne(path.substr(re.lastIndex));
        } catch (e) {
          throw makeDeepGetError(path, e);
        }
    }
    return [parent, partial, lastId];
  }

  deepGet(path) {
    return this._deepGetMinusOne(path)[1];
  }

  deepSet(path, value) {
    const [parent, current, lastIdentifier] = this._deepGetMinusOne(path);
    if (current !== undefined && current.set) current.set(value);
    else if (parent.deepSet) parent.deepSet(lastIdentifier, value);
    else if (typeof lastIdentifier === `string`) parent[lastIdentifier] = value;
    else throw makeDeepGetError(path, lastIdentifier);
  }
}

export class ArrayModel extends Model {
  [initialize](data = []) {
    this[modelData] = data.map((item) => new this.constructor.docClass(item));
  }

  validateSync(options = {}) {
    const {schema} = this.constructor;
    if (schema) {
      const errors = [];
      for (const [index, item] of this[modelData].entries()) {
        console.debug(`validating item ${index}:`, item);
        const error = item.validateSync(options);
        if (error) {
          if (options.collect) errors.push([index, error]);
          else if (options.throw) throw error;
          else return error;
        }
      }
      if (errors.length) {
        const collected = new CompoundValidationError(errors);
        if (options.throw) throw collected;
        else return collected;
      }
    }
  }

  get length() {return this[modelData].length}
  [Symbol.iterator]() {return this[modelData][Symbol.interator]()}

  // TODO Array methods push, pop, slice, etc

  _deepGetMinusOne(path) {
    if (typeof path === `number`) return this[modelData][path];
    if (typeof path !== `string`) return undefined; // or throw?
    const re = /^\[?(\d+)\]?/y;
    const match = re.exec(path);
    if (!match) throw makeDeepGetError(path);
    let index;
    try {
      index = JSON.parse(match[1]);
    } catch (e) {
      throw makeDeepGetError(path, match[1]);
    }
    const doc = this[modelData][index];
    if (doc && doc._deepGetMinusOne && re.lastIndex < path.length)
      try {
        return doc._deepGetMinusOne(path.substr(re.lastIndex));
      } catch (e) {
        throw makeDeepGetError(path, e);
      }
    return [this, doc, index];
  }
}
