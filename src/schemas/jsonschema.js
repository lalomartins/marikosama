import featureRegistry from '../feature-registry';
import jsonschema from 'json-schema-library';

export const Schema = jsonschema.cores.Draft04;
export default Schema;


// XXX: the API is pretty tightly based on Mongoose. As the JSON Schema
// implementation is currently WIP, the API is likely to be in flux
class JSONSchemaImplementation {
  getPaths(schema) {
    const paths = [];
    this.eachPath(schema, ::paths.push);
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
    //
  }

  validatePathSync(m, options) {
    const error = new Error(`not implemented`);
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
    if (schema.schema instanceof jsonschema.cores.Interface) schema = schema.schema;

    return schema.getTemplate(schema.rootSchema);
  }

  test(schema) {
    return schema instanceof jsonschema.cores.Interface;
  }
}


if (!featureRegistry.has(`schemas`)) featureRegistry.set(`schemas`, new Map());
const feature = featureRegistry.get(`schemas`);
feature.set(`jsonschema`, new JSONSchemaImplementation());