import {EventEmitter} from 'events';
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

export class BaseM extends EventEmitter {
  constructor(subject) {
    super();
    const options = this.constructor.options;
    this.subject = subject;
    if (options.accessors) {
      this[symbols.modelData] = {};
    }
    if (options.linking) {
      let linking;
      if (featureRegistry.has(`linking`)) {
        if (typeof options.linking === `string`)
          linking = featureRegistry.get(`linking`).get(options.linking);
        else
          linking = featureRegistry.get(`linking`).values().next().value;
      }
      if (linking && linking.initInstance) {
        linking.initInstance(this);
      } else if (!linking && options.linking !== symbols.ifAvailable) {
        console.error(`Mariko-Sama: linking requested but no implementation was imported`);
      }
    }
    if (options.changeLog) {
      const changeLog = featureRegistry.get(`changeLog`);
      if (changeLog && changeLog.changeLogClass) {
        this.changeLog = new changeLog.changeLogClass();
        this.on(`update`, (path, value, current) => this.changeLog.add({path, value, current}));
      } else if (options.changeLog !== symbols.ifAvailable) {
        console.error(`Mariko-Sama: changeLog requested but the feature wasn't imported`);
      }
    }
  }

  static initClass(options) {
    this.options = {
      // general options
      initialize: false,

      // core (model) options
      validateOnCreation: true,
      allowSettingThrough: false,

      // features
      accessors: symbols.ifAvailable,
      linking: symbols.ifAvailable,
      changeLog: symbols.ifAvailable,

      // feature options
      proxyArrayProxy: true,

      ...options,
    };
    if (this.options.accessors) {
      const proxying = featureRegistry.get(`proxying`);
      if (proxying && proxying.createAccessors) {
        proxying.createAccessors(this, this.subjectClass, this.schema);
      } else if (this.options.accessors !== symbols.ifAvailable) {
        console.error(`Mariko-Sama: proxying requested but the feature wasn't imported`);
      }
    }
    if (this.options.linking) {
      let linking;
      if (featureRegistry.has(`linking`)) {
        if (typeof this.options.linking === `string`)
          linking = featureRegistry.get(`linking`).get(this.options.linking);
        else
          linking = featureRegistry.get(`linking`).values().next().value;
      }
      if (linking && linking.initClass) {
        linking.initClass(this);
      } else if (this.options.linking !== symbols.ifAvailable) {
        console.error(`Mariko-Sama: linking requested but no implementation was imported`);
      }
    }
  }

  static load(data) {
    const instance = new this.subjectClass();
    instance.m.set(data, {noEmit: true});
    if (instance.m.initialize && this.options.initialize)
      instance.m.initialize();
    if (this.options.validateOnCreation && data !== undefined)
      instance.validateSync({throw: true});
    return instance;
  }

  set(data, options = {}) {
    const M = this.constructor;
    const updates = {path: [], value: [], current: []};
    M.schema.eachPath((path, schemaPath) => {
      const value = this.deepGetMaybe(path, data);
      if (value !== undefined) {
        const update = this.deepSetWithParents(path, value, {noEmit: true});
        if (update) {
          updates.path.push(update.path);
          updates.value.push(update.value);
          updates.current.push(update.current);
        }
      }
    });
    if (updates.path.length && !options.noEmit)
      this.emit(`update`, updates.path, updates.value, updates.current);
    return this;
  }

  // TODO this is the mongoose implementation, decouple
  // We could just move it wholesale to mongoose.js but I feel there might be some
  // core functionality that could stay here, so maybe postpone decoupling until
  // we have another schema implementation to better know the requirements
  validateSync(options = {}) {
    const schema = options.schema || this.constructor.schema;
    if (schema) {
      const errors = [];
      // not schema.eachPath() so that we can return partway
      for (const path of Object.getOwnPropertyNames(schema.paths)) {
        const error = this.validatePathSync({...options, path, schemaPath: schema.paths[path]});
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

  validatePathSync(options) {
    const path = options.path;
    const schema = options.schema || this.constructor.schema;
    const schemaPath = options.schemaPath || this.getSchemaPath(path, schema);
    if (!schemaPath) {
      const error = new Error(`path ${path} not found in schema`);
      error.path = path;
      if (options.throw) throw error;
      else return error;
    }
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
      if (options.throw) throw error;
      else return error;
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

  getSchemaPath(path, schema) {
    if (schema.paths[path]) return schema.paths[path];
    let missing = [];
    const keyRe = /(.*)\[([^[]+)]$/;
    for (let part of path.split(`.`)) {
      const partsFound = [];
      for (;;) {
        const match = keyRe.exec(part);
        if (match) {
          part = match[1];
          if (isNaN(match[2])) partsFound.unshift(JSON.parse(match[2]));
          // discard array indexes because mongoose schemas don't work like that
        } else {
          partsFound.unshift(part);
          missing = missing.concat(partsFound);
        }
      }
    }
    let currentSchema = schema;
    outer: while (missing.length) {
      const checking = missing;
      missing = [];
      while (checking.length) {
        missing.unshift(checking.pop());
        // XXX not sure how mongoose `paths` works with spaces etc, check
        const candidatePath = checking.join(`.`);
        if (currentSchema.paths[candidatePath]) {
          currentSchema = currentSchema.paths[candidatePath];
          continue outer;
        }
      }
      // nothing found
      return undefined;
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

  deepSet(path, value, options = {}) {
    // TODO validate
    const [parent, current, lastIdentifier] = this._deepGetMinusOne(path);
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    if (current !== value) {
      if (current !== undefined && current.set) current.set(value);
      else if (parent.deepSet) parent.deepSet(lastIdentifier, value);
      else if (typeof lastIdentifier === `string` || typeof lastIdentifier === `number`) parent[lastIdentifier] = value;
      else throw makeDeepGetError(path, lastIdentifier);
      if (options.noEmit) return {path, value, current};
      else this.emit(`update`, path, value, current);
    }
  }

  deepSetWithParents(path, value, options) {
    for (;;) {
      try {
        return this.deepSet(path, value, options);
      } catch (error) {
        // XXX will blow up on arrays, I don't think it can happen with Mongoose schemas though
        if (error.fullPath && error.lastValid) {
          this.rootM().deepSet(error.lastValid, {}, {...options, noEmit: true});
        }
        else throw error;
      }
    }
  }

  rootM() {
    if (this.__proto__ instanceof this.constructor) return this.__proto__.rootM();
    else return this;
  }

  // Wrapper for the changeLog method, same but returns false if the path reverted
  // back to the old value.
  changedSince(since, path) {
    if (this.changeLog && this.changeLog.changedSince) {
      const changed = this.changeLog.changedSince(since, path);
      if (!(changed && changed.change)) return changed;
      else if (changed.from !== this.deepGet(path)) return changed;
      else return false;
    } else return symbols.notAvailable;
  }
}
