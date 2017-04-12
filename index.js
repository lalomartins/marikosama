import './fills';
import Schema from 'mongoose/lib/schema';
export {Schema};

import {CompoundValidationError} from './errors';

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
    // TODO
    return this.data[path];
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
  // TODO deepGet
}
