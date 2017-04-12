function CompoundValidationError(errors) {
  this.name = `CompoundValidationError`;
  // XXX maybe property?
  this.errors = errors;
  this.message = `There were ${this.flatten().length} validation errors`;
  this.stack = (new Error()).stack;
}
CompoundValidationError.prototype = Object.create(Error.prototype);
Object.assign(CompoundValidationError.prototype, {
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
});
CompoundValidationError.prototype.constructor = CompoundValidationError;
export {CompoundValidationError};
