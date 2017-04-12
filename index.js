import Schema from 'mongoose/lib/schema';
export {Schema};

import {CompoundValidationError, makeDeepGetError} from './errors';

export const modelData = Symbol(`modelData`);
export const initialize = Symbol(`initialize`);
export const nestedProxies = Symbol(`nestedProxies`);
export const proxySelf = Symbol(`proxySelf`);
export const proxyStructure = Symbol(`proxyStructure`);


export function model({schema, persistence, logic, options}) {
  return function(Class) {
    console.debug(Class);
    class M extends BaseM {
      static schema = schema;
      static persistence = persistence;
      static subjectClass = Class;
    }
    Object.assign(M.prototype, logic);
    M.initClass(options);
    Class.M = M;
    Object.defineProperty(Class.prototype, `m`, {
      get() {
        Object.defineProperty(this, `m`, {
          value: new this.constructor.M(this),
          __proto__: null,
        });
        return this.m;
      },
    });
  };
}

export class BaseM {
  constructor(subject) {
    this.subject = subject;
  }

  static initClass(options) {
    this.options = {
      createEmptySubDocs: false,
      initialize: true,
      validateOnCreation: true,
      accessors: true,
      ...options,
    };
    this.createSubDocClasses();
    // if (this.options.accessors) {
    //   const proxies = Class[nestedProxies] = new Map();
    //   Class.schema.eachPath((path, schemaPath) => {
    //     const parts = path.split(`.`);
    //     if (Class.prototype[parts[0]] !== undefined) return;
    //     if (parts.length > 1) {
    //       const head = parts.shift();
    //       // does the last one have to be different?
    //       // const tail = parts.pop();
    //       if (!proxies.has(head))
    //         proxies.set(head, {
    //           [proxyStructure]: new Map(),
    //         });
    //       let proxy = proxies.get(head);
    //       let partial = head;
    //       let structure = proxy[proxyStructure];
    //       for (const part of parts) {
    //         if (!structure.has(part)) {
    //           const newStructure = new Map();
    //           const newProxy = {};
    //           newStructure.parent = structure;
    //           newStructure.proxy = newProxy;
    //           structure.path = partial;
    //           structure.set(part, newStructure);
    //           Object.defineProperty(proxy, part, {
    //             get() {
    //               debugger;
    //               return newProxy;
    //             },
    //             set(value) {
    //
    //             },
    //           });
    //           proxy = newProxy;
    //           structure = newStructure;
    //         }
    //         partial = `${partial}.${part}`;
    //         // proxy = ???
    //       }
    //     }
    //   });
    // }
  }

  static load(data) {
    const instance = new this.subjectClass();
    instance.m.set(data);
    return instance;
  }

  set(data) {
    const M = this.constructor;
    M.schema.eachPath((path, schemaPath) => {
      const value = this.deepGetMaybe(path, data);
      const SDClass = M.subDocClasses.get(path);
      if (SDClass && (value !== undefined || M.options.createEmptySubDocs)) {
        this.deepSetWithParents(path, new SDClass(value));
      } else if (value !== undefined) {
        this.deepSetWithParents(path, value);
      }
    });
    if (M.options.validateOnCreation && data !== undefined)
      this.validateSync({throw: true});
    return this;
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
        const item = this.deepGetMaybe(path);
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
    if (parent === undefined) {
      if (this.constructor.options.acessors) {
        parent = this[modelData] = {};
      } else {
        parent = this.subject;
      }
    }
    if (typeof path !== `string`) return parent[path];
    const re = /(?:\.?([a-zA-Z_$][\w$]*))|(?:\[([^\]]+)\])/gy;
    let partial = parent;
    let previousIndex = 0;
    let lastId;
    while (re.lastIndex < path.length) {
      parent = partial;
      previousIndex = re.lastIndex; // for the error message
      const match = re.exec(path);
      if (!match) throw makeDeepGetError(path, path.substr(previousIndex));
      const [text, attr, index] = match;
      if (partial === undefined) {
        const error = new TypeError(`Cannot read path ${text} of undefined ${path.substr(0, previousIndex)}`);
        error.fullPath = path;
        error.lastValid = path.substr(0, previousIndex);
        error.firstInvalid = attr || index;
        error.currentPath = path.substr(0, re.lastIndex);
        throw error;
      }
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

  deepGet(path, parent) {
    return this._deepGetMinusOne(path, parent)[1];
  }

  deepGetMaybe(path, parent) {
    try {
      return this.deepGet(path, parent);
    } catch (error) {
      if (error.fullPath === path) return undefined;
      else throw error;
    }
  }

  deepSet(path, value) {
    let container;
    if (this.constructor.options.acessors) {
      container = this[modelData] = {};
    } else {
      container = this.subject;
    }
    const [parent, current, lastIdentifier] = this._deepGetMinusOne(path, container);
    if (current !== undefined && current.set) current.set(value);
    else if (parent.deepSet) parent.deepSet(lastIdentifier, value);
    else if (typeof lastIdentifier === `string`) parent[lastIdentifier] = value;
    else throw makeDeepGetError(path, lastIdentifier);
  }

  deepSetWithParents(path, parent) {
    for (;;) {
      try {
        return this.deepSet(path, parent);
      } catch (error) {
        // XXX will blow up on arrays, I don't think it can happen with Mongoose schemas though
        if (error.fullPath && error.lastValid) {
          this.deepSet(error.lastValid, {});
        }
        else throw error;
      }
    }
  }
}

class Model {} // placeholder so that createSubDocClasses doesn't break for now

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
