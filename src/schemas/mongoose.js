import featureRegistry from '../feature-registry';
import Schema from 'mongoose/lib/schema';

// we could potentially subclass it
export {Schema};
export default Schema;


function _validateArraySync(m, array, pathSchema, options) {
  const errors = [];
  let error = pathSchema.constructor.prototype.__proto__.doValidateSync.call(pathSchema, array);
  if (error) {
    if (options.collect) errors.push([pathSchema.path, error]);
    else if (options.throw) throw error;
    else return error;
  }
  for (const [index, object] of array.entries()) {
    error = m.validateSync({...options, schema: pathSchema.schema, object});
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


// LATER: the API is pretty tightly based on Mongoose. When we have another
// implementation, some redesign will probably be in order.
class MongooseSchemaImplementation {
  // XXX these names are totally inconsistent
  getPaths(schema) {
    const paths = Object.getOwnPropertyNames(schema.paths);
    return paths.map((path) => ({path, pathSchema: schema.paths[path]}));
  }

  eachPath = (schema, fn) => schema.eachPath(fn)

  getPathSchema(path, schema, basePath) {
    if (schema.paths[path]) return schema.paths[path];
    if (basePath) {
      path = basePath + path;
      if (schema.paths[path]) return schema.paths[path];
    }
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
          break;
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
          if (currentSchema.schema) currentSchema = currentSchema.schema;
          continue outer;
        }
      }
      // nothing found
      return undefined;
    }
  }

  validatePathSync(m, options) {
    const path = options.path;
    const schema = options.schema || m.constructor.schema;
    const pathSchema = options.pathSchema ||
      m.constructor.schemaImplementation.getPathSchema(path, schema, m.basePath);
    if (!pathSchema) {
      const error = new Error(`path ${path} not found in schema`);
      error.path = path;
      if (options.throw) throw error;
      else return error;
    }
    const item = m.deepGetMaybe(path, options.object);
    let error;
    if (pathSchema.$isMongooseDocumentArray) {
      // TODO: the path itself may have validations, like maybe being required
      error = _validateArraySync(m, item, pathSchema, options);
    } else if (pathSchema.$isSingleNested) {
      error = m.validateSync({...options, object: item, schema: pathSchema.schema});
    } else {
      error = pathSchema.doValidateSync(item);
    }
    if (error) {
      if (options.throw) throw error;
      else return error;
    }
  }

  create(subpath, schema, basePath) {
    if (schema === undefined) {
      schema = subpath;
      subpath = undefined;
      basePath = undefined;
    }
    if (subpath) {
      schema = this.getPathSchema(subpath, schema, basePath);
    } else if (basePath) {
      schema = this.getPathSchema(basePath, schema);
    }
    if (schema.schema) schema = schema.schema;

    const object = {};
    for (const {path, pathSchema} of this.getPaths(schema)) {
      const parts = path.split(`.`);
      const tail = parts.pop();
      let partial = object;
      for (const part of parts) {
        if (partial[part] === undefined) partial[part] = {};
        partial = partial[part];
      }

      // const defaultValue = pathSchema.getDefault();
      // if (!pathSchema.doValidateSync(defaultValue)) {
      //   partial[tail] = defaultValue;
      // } else {
      //   // here it gets complicated
      //   partial[tail] = `foo`;
      // }
      partial[tail] = pathSchema.getDefault();
    }

    return object;
  }

  test = (schema) => schema instanceof Schema
}


if (!featureRegistry.has(`schemas`)) featureRegistry.set(`schemas`, new Map());
const feature = featureRegistry.get(`schemas`);
feature.set(`mongoose`, new MongooseSchemaImplementation());
