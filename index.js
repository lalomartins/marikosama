// import './fills';
import Schema from 'mongoose/lib/schema';
export {Schema};

import {CompoundValidationError, makeDeepGetError} from './errors';

export const initialize = Symbol(`initialize`);


export class Model {
  static options = {
    createEmptySubDocs: false,
    initialize: true,
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
      console.debug(`checking for ${key}:`, SDClass, data[key]);
      if (data[key] !== undefined || Class.options.createEmptySubDocs) {
        this.data[key] = new SDClass(data[key]);
      }
    }
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

  deepGet(path) {
    if (typeof path !== `string`) return this.data[path];
    const re = /(?:\.?([a-zA-Z_$][\w$]*))|(?:\[([^\]]+)\])/gy;
    let partial = this.data;
    while (re.lastIndex < path.length) {
      const previousIndex = re.lastIndex; // for the error message
      const match = re.exec(path);
      if (!match) throw makeDeepGetError(path, path.substr(previousIndex));
      const [text, attr, index] = match;
      if (attr !== undefined) {
        partial = partial[attr];
      } else if (index !== undefined) {
        let parsedIndex;
        try {
          parsedIndex = JSON.parse(index);
        } catch (e) {
          throw makeDeepGetError(path, index);
        }
        partial = partial[parsedIndex];
      } else {
        // not sure how this would happen but…
        throw makeDeepGetError(path, text);
      }

      if (partial && partial.deepGet && re.lastIndex < path.length)
        try {
          return partial.deepGet(path.substr(re.lastIndex));
        } catch (e) {
          throw makeDeepGetError(path, e);
        }
    }
    return partial;
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
        if (options.collect) errors.push([index, error]);
        else if (options.throw) throw error;
        else return error;
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

  deepGet(path) {
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
    if (doc && doc.deepGet && re.lastIndex < path.length)
      try {
        return doc.deepGet(path.substr(re.lastIndex));
      } catch (e) {
        throw makeDeepGetError(path, e);
      }
    return doc;
  }
}
