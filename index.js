import Schema from 'mongoose/lib/schema';
export {Schema};

import {CompoundValidationError, makeDeepGetError} from './errors';

export const symbols = {
  modelData: Symbol(`modelData`),
  nestedProxies: Symbol(`nestedProxies`),
  proxySelf: Symbol(`proxySelf`),
  proxyStructure: Symbol(`proxyStructure`),
  notAvailable: Symbol(`notAvailable`),
};

let BuiltinProxy;
try {
  BuiltinProxy = Proxy;
} catch (e) {
  BuiltinProxy = symbols.notAvailable;
}


export function model({schema, persistence, logic, options}) {
  return function(Class) {
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
    if (this.constructor.options.accessors) {
      this[symbols.modelData] = {};
    }
  }

  static initClass(options) {
    this.options = {
      initialize: false,
      validateOnCreation: true,
      accessors: true,
      allowSettingThrough: false,
      ...options,
    };
    if (this.options.accessors) {
      this.createAccessors();
    }
  }

  static createAccessors(subjectClass, schema) {
    const M = this;
    if (subjectClass === undefined) subjectClass = this.subjectClass;
    if (schema === undefined) schema = this.schema;

    const basicSetter = (path) => function set(value) {
      if (M.options.allowSettingThrough)
        this.m.deepSetWithParents(path, value);
      else
        this.m.deepSet(path, value);
    };

    const proxies = this[symbols.nestedProxies] = new Map();
    schema.eachPath((path, schemaPath) => {
      const parts = path.split(`.`);
      const head = parts.shift();
      if (!proxies.has(head) && subjectClass.prototype[head] !== undefined) return;
      if (parts.length) {
        const tail = parts.pop();
        if (!proxies.has(head)) {
          const proxy = {
            [symbols.proxyStructure]: new Map(),
          };
          proxies.set(head, proxy);
          Object.defineProperty(subjectClass.prototype, head, {
            get() {
              const proxyInstance = Object.create(proxy);
              proxyInstance[symbols.proxySelf] = this;
              if (this.m && this.m.deepGet(head))
                return proxyInstance;
            },
            set: basicSetter(head),
          });
        }
        let proxy = proxies.get(head);
        let partial = head;
        let structure = proxy[symbols.proxyStructure];
        for (const part of parts) {
          if (!structure.has(part)) {
            const newStructure = new Map();
            const newProxy = {};
            newStructure.proxy = newProxy;
            structure.set(part, newStructure);
            Object.defineProperty(proxy, part, {
              get() {
                const proxyInstance = Object.create(newProxy);
                proxyInstance[symbols.proxySelf] = this[symbols.proxySelf];
                if (this[symbols.proxySelf].m && this[symbols.proxySelf].m.deepGet(`${partial}.${part}`))
                  return proxyInstance;
              },
              set(value) {
                if (M.options.allowSettingThrough)
                  this[symbols.proxySelf].m.deepSetWithParents(`${partial}.${part}`, value);
                else
                  this[symbols.proxySelf].m.deepSet(`${partial}.${part}`, value);
              },
              configurable: false,
            });
            proxy = newProxy;
            structure = newStructure;
          } else {
            structure = structure.get(part);
            // this is the only thing the structure shebang is for
            proxy = structure.proxy;
          }
          partial = `${partial}.${part}`;
        }
        Object.defineProperty(proxy, tail, {
          get() {
            return this[symbols.proxySelf].m.deepGet(`${partial}.${tail}`);
          },
          set(value) {
            if (M.options.allowSettingThrough)
              this[symbols.proxySelf].m.deepSetWithParents(`${partial}.${tail}`, value);
            else
              this[symbols.proxySelf].m.deepSet(`${partial}.${tail}`, value);
          },
        });
      } else if (schemaPath.$isMongooseDocumentArray) {
        class NestedProxy extends NestedProxyBase {}
        this.createAccessors(NestedProxy, schemaPath.schema);
        class ArrayProxy extends ArrayProxyBase {
          static itemClass = NestedProxy
        }
        Object.defineProperty(subjectClass.prototype, path, {
          get() {
            let proxy = new ArrayProxy(this, path);
            if (BuiltinProxy !== symbols.notAvailable)
              proxy = proxyArrayProxy(proxy);
            Object.defineProperty(this, path, {
              get: () => proxy,
              set: basicSetter(path),
              __proto__: null,
            });
            if (this.m && this.m.deepGet(path))
              return proxy;
          },
          set: basicSetter(path),
        });
      } else if (schemaPath.$isSingleNested) {
        class NestedProxy extends NestedProxyBase {}
        this.createAccessors(NestedProxy, schemaPath.schema);
        Object.defineProperty(subjectClass.prototype, path, {
          get() {
            const proxy = new NestedProxy(this, path);
            Object.defineProperty(this, path, {
              get: () => proxy,
              set: basicSetter(path),
              __proto__: null,
            });
            if (this.m && this.m.deepGet(path))
              return proxy;
          },
          set: basicSetter(path),
        });
      } else {
        Object.defineProperty(subjectClass.prototype, path, {
          get() {
            return this.m.deepGet(path);
          },
          set: basicSetter(path),
        });
      }
    });
  }

  static load(data) {
    const instance = new this.subjectClass();
    instance.m.set(data);
    if (instance.m.initialize && this.options.initialize)
      instance.m.initialize();
    return instance;
  }

  set(data) {
    const M = this.constructor;
    M.schema.eachPath((path, schemaPath) => {
      const value = this.deepGetMaybe(path, data);
      if (value !== undefined) {
        this.deepSetWithParents(path, value);
      }
    });
    if (M.options.validateOnCreation && data !== undefined)
      this.validateSync({throw: true});
    return this;
  }

  validateSync(options = {}) {
    const schema = options.schema || this.constructor.schema;
    if (schema) {
      const errors = [];
      // not schema.eachPath() so that we can return partway
      for (const path of Object.getOwnPropertyNames(schema.paths)) {
        const schemaPath = schema.paths[path];
        const item = this.deepGetMaybe(path, options.object);
        let error;
        if (schemaPath.$isMongooseDocumentArray) {
          // TODO: the path itself may have validations, like maybe being required
          error = this._validateArraySync(item, schemaPath, options);
        } else if (schemaPath.$isSingleNested) {
          error = this.validateSync({...options, object: item, schema: schemaPath.schema});
        } else {
          error = schemaPath.doValidateSync(item);
        }
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

  _validateArraySync(array, schemaPath, options) {
    const errors = [];
    let error = schemaPath.constructor.prototype.__proto__.doValidateSync.call(schemaPath, array);
    if (error) {
      if (options.collect) errors.push([schemaPath.path, error]);
      else if (options.throw) throw error;
      else return error;
    }
    for (const [index, object] of array.entries()) {
      error = this.validateSync({...options, schema: schemaPath.schema, object});
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

  _deepGetMinusOne(path, parent) {
    if (parent === undefined) {
      if (this.constructor.options.accessors) {
        parent = this[symbols.modelData];
      } else {
        parent = this.subject;
      }
      if (this.basePath) path = this.basePath + path;
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
    // TODO validate
    const [parent, current, lastIdentifier] = this._deepGetMinusOne(path);
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
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
          this.rootM().deepSet(error.lastValid, {});
        }
        else throw error;
      }
    }
  }

  rootM() {
    if (this.__proto__ instanceof this.constructor) return this.__proto__.rootM();
    else return this;
  }
}


export class ArrayProxyBase {
  constructor(proxySelf, basePath) {
    this[symbols.proxySelf] = proxySelf;
    this.basePath = basePath;
  }

  makeItemProxy(index, item) {
    return new this.constructor.itemClass(this[symbols.proxySelf], `${this.basePath}[${index}]`);
  }

  get(index) {
    const item = this[symbols.proxySelf].m.deepGet(`${this.basePath}[${index}]`);
    if (item === undefined) return item;
    else return this.makeItemProxy(index, item);
  }

  set(index, value) {
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    if (this[symbols.proxySelf].m.constructor.options.allowSettingThrough)
      this[symbols.proxySelf].m.deepSetWithParents(`${this.basePath}[${index}]`, value);
    else
      this[symbols.proxySelf].m.deepSet(`${this.basePath}[${index}]`, value);
    return this.makeItemProxy(index, value);
  }

  get length() {
    return this[symbols.proxySelf].m.deepGet(this.basePath).length;
  }

  *[Symbol.iterator]() {
    for (const [index, value] of this[symbols.proxySelf].m.deepGet(this.basePath).entries())
      yield this.makeItemProxy(index, value);
  }

  *entries() {
    for (const [index, value] of this[symbols.proxySelf].m.deepGet(this.basePath).entries())
      yield [index, this.makeItemProxy(index, value)];
  }

  push(value) {
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    return this[symbols.proxySelf].m.deepGet(this.basePath).push(value);
  }

  unshift(value) {
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    return this[symbols.proxySelf].m.deepGet(this.basePath).unshift(value);
  }

  // TODO all Array methods pop, slice, etc
}

function proxyArrayProxy(proxy) {
  return new BuiltinProxy(proxy, {
    get(target, prop) {
      if ((typeof prop === `number`) || (typeof prop === `string` && !isNaN(prop)))
        return target.get(prop);
      return target[prop];
    },
    set(target, prop, value) {
      if ((typeof prop === `number`) || (typeof prop === `string` && !isNaN(prop)))
        return target.set(prop, value);
      return target[prop] = value;
    },
  });
}

export class NestedProxyBase {
  constructor(proxySelf, basePath) {
    this[symbols.proxySelf] = proxySelf;
    this.m = Object.create(proxySelf.m);
    this.m.basePath = `${proxySelf.m.basePath || ``}${basePath}.`;
  }
}
