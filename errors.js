function subclassError(constructor, proto, parent = Error) {
  constructor.prototype = Object.create(parent.prototype);
  Object.assign(constructor.prototype, proto, {constructor});
  return constructor;
}

export const CompoundValidationError = subclassError(
  function CompoundValidationError(errors) {
    this.name = `CompoundValidationError`;
    // XXX maybe property?
    this.errors = errors;
    this.message = `There were ${this.flatten().length} validation errors`;
    this.stack = (new Error()).stack;
  }, {
    flatten() {
      const flattened = [];
      for (const [path, error] of this.errors) {
        let key;
        // the . is for correct reporting of nested non-subdoc errors
        if (typeof path === `string` && path.match(/^[a-zA-Z_$][\w$.]*/))
          key = `.${path}`;
        else
          key = `[${JSON.stringify(path)}]`;
        if (error.flatten) {
          for (const [subPath, subError] of error.flatten()) {
            flattened.push([key + subPath, subError]);
          }
        } else {
          flattened.push([key, error]);
        }
      }
      return flattened;
    },
  }
);

export function makeDeepGetError(basePath, path) {
  let message;
  if (path instanceof Error) {
    if (path.path)
      message = `invalid path at ${basePath}: ${path.path}`;
    else if (path.basePath)
      message = `invalid path at ${basePath}: ${path.basePath}`;
    else return path;
  } else if (path)
    message = `invalid path at ${basePath}: ${path}`;
  else
    message = `invalid path ${basePath}`;
  const error = SyntaxError(message);
  error.errorBasePath = basePath;
  error.errorPath = path;
  return error;
}
