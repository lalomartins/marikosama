// import './fills';
import Schema from 'mongoose/lib/schema';
export {Schema};

import {CompoundValidationError, makeDeepGetError} from './errors';

export const initialize = Symbol(`initialize`);


export class Model {
  static options = {
    createEmptySubDocs: false,
    initialize: true,
    validateOnCreation: true,
  }

  constructor(data) {
    const Class = this.constructor;
    if (!Class.hasOwnProperty(`subDocClasses`))
      Class.createSubDocClasses();
    if (Class.options.initialize)
      this[initialize](data);
  }

  [initialize](data) {
    const Class = this.constructor;
    this.data = {...data};
    for (const [key, SDClass] of Class.subDocClasses) {
      if (data[key] !== undefined || Class.options.createEmptySubDocs) {
        this.data[key] = new SDClass(data[key]);
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
      for (const name of Object.getOwnPropertyNames(schema.paths)) {
        const schemaPath = schema.paths[name];
        const item = this.deepGet(name);
        let error;
        // TODO: the path itself may have validations, this is especially useful
        // (and used?) with arrays.
        if (item && item.validateSync)
          error = item.validateSync(options);
        else
          error = schemaPath.doValidateSync(item);
        if (error) {
          if (options.collect) errors.push([name, error]);
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
    if (typeof path !== `string`) return this.data[path];
    const re = /(?:\.?([a-zA-Z_$][\w$]*))|(?:\[([^\]]+)\])/gy;
    let partial = this.data;
    let previousIndex = 0;
    let lastId;
    while (re.lastIndex < path.length) {
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
    this.data = data.map((item) => new this.constructor.docClass(item));
  }

  validateSync(options = {}) {
    const {schema} = this.constructor;
    if (schema) {
      const errors = [];
      for (const [index, item] of this.data.entries()) {
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

  get length() {return this.data.length}
  [Symbol.iterator]() {return this.data[Symbol.interator]()}

  // TODO Array methods push, pop, slice, etc

  _deepGetMinusOne(path) {
    if (typeof path === `number`) return this.data[path];
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
    const doc = this.data[index];
    if (doc && doc._deepGetMinusOne && re.lastIndex < path.length)
      try {
        return doc._deepGetMinusOne(path.substr(re.lastIndex));
      } catch (e) {
        throw makeDeepGetError(path, e);
      }
    return [this, doc, index];
  }
}
