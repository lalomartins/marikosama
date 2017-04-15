import {CompoundValidationError, makeDeepGetError} from './errors';
import featureRegistry from './feature-registry';
import symbols from './symbols';

export {symbols};

export function model({schema, persistence, logic, options}) {
  let schemaImplementation;
  if (schema) {
    for (const implementation of (featureRegistry.get(`schemas`) || []).values()) {
      if (implementation.test(schema)) {
        schemaImplementation = implementation;
        break;
      }
    }
    if (!schemaImplementation)
      console.error(`Mariko-Sama: schema was provided but no matching feature provider was imported`);
  }
  return function(Class) {
    class M extends BaseM {
      static schema = schema;
      static schemaImplementation = schemaImplementation;
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
      proxyArrayProxy: true,
      ...options,
    };
    if (this.options.accessors) {
      const proxying = featureRegistry.get(`proxying`);
      if (proxying && proxying.createAccessors) {
        proxying.createAccessors(this, this.subjectClass, this.schema);
      } else {
        console.error(`Mariko-Sama: proxying requested but the feature wasn't imported`);
      }
    }
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
    else if (typeof lastIdentifier === `string` || typeof lastIdentifier === `number`) parent[lastIdentifier] = value;
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
