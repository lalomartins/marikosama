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
      this[symbols.subObjectClasses] = {};
      const proxying = featureRegistry.get(`proxying`);
      if (proxying && proxying.createAccessors) {
        proxying.createAccessors(this);
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
    if (this.persistence && this.persistence.initClass) this.persistence.initClass(this);
    if (this.subjectClass.prototype.toJSON === undefined)
      this.subjectClass.prototype.toJSON = function toJSON() {
        const data = this.m.getData();
        if (data.toJSON && data.toJSON !== toJSON) return data.toJSON();
        else return data;
      };
  }

  rootM() {
    if (this.__proto__ instanceof this.constructor) return this.__proto__.rootM();
    else return this;
  }

  /////////////////////////////////////////////////////////////////////////////
  // data handling (get, set, etc)

  static load(data, options = {}) {
    const instance = new this.subjectClass();
    instance.m.update(this.schemaImplementation.create(this.schema), {noEmit: true});
    instance.m.update(data, {noEmit: true});
    if (instance.m.initialize && this.options.initialize)
      instance.m.initialize();
    if (this.options.validateOnCreation && !options.noValidation && data !== undefined)
      instance.validateSync({throw: true});
    return instance;
  }

  // get all the data, e.g. for serializing
  getData(options = {}) {
    // Maybe we need something more sophisticated? For now just trust user code
    // not to mutate it
    if (this.basePath) {
      let path = this.basePath;
      if (path[path.length - 1] === `.`) path = path.substr(0, path.length - 1);
      return this.rootM().deepGet(path);
    } else if (this.constructor.options.accessors) {
      return this[symbols.modelData];
    } else {
      return this.subject;
    }
  }

  update(data, options = {}) {
    const M = this.constructor;
    const updates = {path: [], value: [], current: []};
    M.schemaImplementation.eachPath(M.schema, (path, pathSchema) => {
      if (!path) return;
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

      if (partial && partial.m && partial.m._deepGetMinusOne && re.lastIndex < path.length)
        try {
          return partial.m._deepGetMinusOne(path.substr(re.lastIndex), partial);
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
      if (error.fullPath === `${this.basePath || ``}${path}`)
        return undefined;
      else throw error;
    }
  }

  deepSet(path, value, options = {}) {
    // TODO validate
    const [parent, current, lastIdentifier] = this._deepGetMinusOne(path);
    if (value != null) {
      if (value.m && value.m instanceof BaseM) value = value.m.getData();
    }
    if (current !== value) {
      if (current != null && current.update) current.update(value);
      else if (parent.deepSet) parent.deepSet(lastIdentifier, value);
      else if (typeof lastIdentifier === `string` || typeof lastIdentifier === `number`) parent[lastIdentifier] = value;
      else throw makeDeepGetError(path, lastIdentifier);
      if (options.noEmit) return {path, value, current};
      else this.emit(`update`, (this.basePath || ``) + path, value, current);
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

  /////////////////////////////////////////////////////////////////////////////
  // creating data

  createSubObject(path, wrap) {
    const M = this.constructor;
    if (wrap === undefined) wrap = M.options.accessors;
    const fullPath = (this.basePath || ``) + path;
    const object = M.schemaImplementation.create(path, M.schema, this.basePath);
    if (wrap) {
      if (!M[symbols.subObjectClasses][fullPath]) {
        const subSchema = M.schemaImplementation.getPathSchema(path, M.schema, this.basePath);
        const theClass = M[symbols.subObjectClasses][fullPath] = class SubObject {};
        model({
          schema: subSchema.schema ? subSchema.schema : subSchema,
          options: M.options,
        })(theClass);
        theClass.M.parentM = M;
      }
      return M[symbols.subObjectClasses][fullPath].M.load(object);
    } else return object;
  }

  static create() {
    return this.load({});
  }

  /////////////////////////////////////////////////////////////////////////////
  // validation

  // TODO this is the mongoose implementation, decouple
  validateSync(options = {}) {
    const {schemaImplementation} = this.constructor;
    const schema = options.schema || this.constructor.schema;
    if (schema) {
      const errors = [];
      // not eachPath() so that we can return partway
      for (const {path, pathSchema} of schemaImplementation.getPaths(schema)) {
        const error = schemaImplementation.validatePathSync(this, {...options, path, pathSchema});
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
    return this.constructor.schemaImplementation.validatePathSync(this, options);
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

  /////////////////////////////////////////////////////////////////////////////
  // changeLog

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

  /////////////////////////////////////////////////////////////////////////////
  // persistence
  static get(id, options) {return this.persistence.get(this, id, options)}
  static query(options) {return this.persistence.query(this, options)}
  static queryReactive(options) {return this.persistence.queryReactive(this, options)}
  reload(options) {return this.constructor.persistence.reload(this, options)}
  save(options) {return this.constructor.persistence.save(this, options)}
  saveIfChanged(options) {return this.constructor.persistence.saveIfChanged(this, options)}
  isChangedFromPersistence() {return this.constructor.persistence.isChanged(this)}
  remove(options) {return this.constructor.persistence.remove(this, options)}
}
