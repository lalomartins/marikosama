import jsonschema from 'json-schema-library';

import featureRegistry from '../feature-registry';
import CompoundValidationError from '../errors';

export const Schema = jsonschema.cores.Draft04;
export default Schema;

const uuidV4Regex = /^[A-F\d]{8}-[A-F\d]{4}-4[A-F\d]{3}-[89AB][A-F\d]{3}-[A-F\d]{12}$/i;
function uuidV4Error(data) {
  return {
    type: `error`,
    name: `FormatUUIDv4Error`,
    code: `format-uuid-v4-error`,
    message: `Value ${data.value} at ${data.pointer} is not a valid UUID v4`,
    data,
  };
}
export function extend(schema) {
  jsonschema.addValidator.format(schema, `uuidv4`, (core, schema, value, pointer) => {
    if (value && !uuidV4Regex.test(value)) {
      return uuidV4Error({value, pointer});
    }
  });
  return schema;
}

// XXX: the API is pretty tightly based on Mongoose. As the JSON Schema
// implementation is currently WIP, the API is likely to be in flux
class JSONSchemaImplementation {
  getPaths(schema) {
    const paths = [];
    this.eachPath(schema, (path, pathSchema) => {paths.push({path, pathSchema})});
    paths.shift();
    return paths;
  }

  eachPath(schema, fn) {
    if (schema.__rootSchema) schema = schema.__rootSchema;

    fn(``, schema);

    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        this.eachPath(schema.properties[key], (path, sub) => {
          if (!path) {
            fn(key, sub);
          } else if (path[0] === `[]`) {
            fn(key + path, sub);
          } else {
            fn(`${key}.${path}`, sub);
          }
        });
      }
    }
  }

  getPathSchema(path, schema, basePath) {
    const jsPath = (basePath || ``).split(`.`)
    .concat((path || ``).split(`.`))
    .join(`/`);
    return extend(new Schema(schema.getSchema(schema.__rootSchema, undefined, `#${jsPath}`)));
  }

  validatePathSync(m, options) {
    const path = options.path;
    const schema = options.schema || m.constructor.schema;
    const core = schema;
    let pathSchema = options.pathSchema ||
      m.constructor.schemaImplementation.getPathSchema(path, schema, m.basePath);
    if (!pathSchema) {
      const error = new Error(`path ${path} not found in schema`);
      error.path = path;
      if (options.throw) throw error;
      else return error;
    }
    if (pathSchema.__rootSchema) pathSchema = pathSchema.__rootSchema;
    const item = m.deepGetMaybe(path, options.object);
    let error;
    const errors = core.validate(pathSchema, item);
    if (errors.length === 1) {
      error = errors[0];
    } else if (errors.length > 1) {
      error = new CompoundValidationError(errors);
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
    const core = schema;
    if (subpath) {
      schema = this.getPathSchema(subpath, schema, basePath);
    } else if (basePath) {
      schema = this.getPathSchema(basePath, schema);
    }
    if (schema.schema instanceof jsonschema.cores.Interface) schema = schema.schema;

    if (schema.rootSchema.type === `array`)
      return core.getTemplate(schema.rootSchema.items);
    else
      return core.getTemplate(schema.rootSchema);
  }

  test(schema) {
    return schema instanceof jsonschema.cores.Interface;
  }
}


if (!featureRegistry.has(`schemas`)) featureRegistry.set(`schemas`, new Map());
const feature = featureRegistry.get(`schemas`);
feature.set(`jsonschema`, new JSONSchemaImplementation());
