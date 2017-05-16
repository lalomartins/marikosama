import featureRegistry from './feature-registry';
import symbols from './symbols';
import {BaseM} from './index';

if (!featureRegistry.has(`proxying`)) featureRegistry.set(`proxying`, {});
const feature = featureRegistry.get(`proxying`);

let BuiltinProxy;
try {
  BuiltinProxy = Proxy;
} catch (e) {
  BuiltinProxy = symbols.notAvailable;
}

export class ArrayProxyBase {
  constructor(proxySelf, basePath) {
    this[symbols.proxySelf] = proxySelf;
    this.basePath = basePath;
  }

  makeItemProxy(index, item) {
    if (this.constructor.itemClass)
      return new this.constructor.itemClass(this[symbols.proxySelf], `${this.basePath}[${index}]`);
    else return item;
  }

  get(index) {
    const item = this[symbols.proxySelf].m.deepGet(`${this.basePath}[${index}]`);
    if (item === undefined) return item;
    else return this.makeItemProxy(index, item);
  }

  set(index, value) {
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    if (this[symbols.proxySelf].m.constructor.options.allowSettingThrough)
      this[symbols.proxySelf].m.deepSetWithParents(`${this.basePath}[${index}]`, value);
    else
      this[symbols.proxySelf].m.deepSet(`${this.basePath}[${index}]`, value);
    return this.makeItemProxy(index, value);
  }

  get length() {
    return this[symbols.proxySelf].m.deepGet(this.basePath).length;
  }

  *[Symbol.iterator]() {
    for (const [index, value] of this[symbols.proxySelf].m.deepGet(this.basePath).entries())
      yield this.makeItemProxy(index, value);
  }

  *entries() {
    for (const [index, value] of this[symbols.proxySelf].m.deepGet(this.basePath).entries())
      yield [index, this.makeItemProxy(index, value)];
  }

  map(fn) {
    const results = [];
    for (const proxy of this) results.push(fn(proxy));
    return results;
  }

  filter(fn) {
    const results = [];
    for (const proxy of this)
      if (fn(proxy)) results.push(proxy);
    return results;
  }

  push(value, options={}) {
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    if (value.m && value.m instanceof BaseM) value = value.toJSON();
    const self = this[symbols.proxySelf].m.deepGet(this.basePath);
    const current = options.noEmit ? null : self.slice();
    const res = self.push(value);
    if (!options.noEmit)
      this[symbols.proxySelf].m.emit(`update`, (this.basePath), self, current);
    return res;
  }

  unshift(value, options={}) {
    while (value.hasOwnProperty(symbols.proxySelf)) value = value[symbols.proxySelf];
    if (value.m && value.m instanceof BaseM) value = value.toJSON();
    const self = this[symbols.proxySelf].m.deepGet(this.basePath);
    const current = options.noEmit ? null : self.slice();
    const res = self.unshift(value);
    if (!options.noEmit)
      this[symbols.proxySelf].m.emit(`update`, (this.basePath), self, current);
    return res;
  }

  // For passing to type-checking stuff (Array.isArray())
  toArray() {
    return new Array(...this);
  }

  slice(begin = 0, end) {
    if (end === undefined) end = this.length;
    else end = Math.min(end, this.length);
    const res = [];
    for (let i = begin; i < end; i++)
      res.push(this.get(i));
    return res;
  }

  // TODO all Array methods pop, slice, etc
}

function proxyArrayProxy(proxy) {
  return new BuiltinProxy(proxy, {
    get(target, prop) {
      if ((typeof prop === `number`) || (typeof prop === `string` && !isNaN(prop)))
        return target.get(Number(prop));
      return target[prop];
    },
    set(target, prop, value) {
      if ((typeof prop === `number`) || (typeof prop === `string` && !isNaN(prop)))
        return target.set(Number(prop), value);
      return target[prop] = value;
    },
  });
}

export class NestedProxyBase {
  constructor(proxySelf, basePath) {
    this[symbols.proxySelf] = proxySelf;
    this.m = Object.create(proxySelf.m);
    this.m.basePath = `${proxySelf.m.basePath || ``}${basePath}.`;
  }
}

// TODO decouple from Mongoose schema implementation (somehow)
export function createAccessors(M, subjectClass, schema) {
  if (subjectClass === undefined) subjectClass = M.subjectClass;
  if (schema === undefined) schema = M.schema;

  const basicSetter = (path) => function set(value) {
    if (M.options.allowSettingThrough)
      this.m.deepSetWithParents(path, value);
    else
      this.m.deepSet(path, value);
  };

  const proxies = M[symbols.nestedProxies] = new Map();
  schema.eachPath((path, schemaPath) => {
    const parts = path.split(`.`);
    const head = parts.shift();
    if (!proxies.has(head) && subjectClass.prototype[head] !== undefined) return;
    if (parts.length) {
      const tail = parts.pop();
      if (!proxies.has(head)) {
        const proxy = {
          [symbols.proxyStructure]: new Map(),
        };
        proxies.set(head, proxy);
        Object.defineProperty(subjectClass.prototype, head, {
          get() {
            const proxyInstance = Object.create(proxy);
            proxyInstance[symbols.proxySelf] = this;
            if (this.m && this.m.deepGet(head))
              return proxyInstance;
          },
          set: basicSetter(head),
        });
      }
      let proxy = proxies.get(head);
      let partial = head;
      let structure = proxy[symbols.proxyStructure];
      for (const part of parts) {
        if (!structure.has(part)) {
          const newStructure = new Map();
          const newProxy = {};
          newStructure.proxy = newProxy;
          structure.set(part, newStructure);
          Object.defineProperty(proxy, part, {
            get() {
              const proxyInstance = Object.create(newProxy);
              proxyInstance[symbols.proxySelf] = this[symbols.proxySelf];
              if (this[symbols.proxySelf].m && this[symbols.proxySelf].m.deepGet(`${partial}.${part}`))
                return proxyInstance;
            },
            set(value) {
              if (M.options.allowSettingThrough)
                this[symbols.proxySelf].m.deepSetWithParents(`${partial}.${part}`, value);
              else
                this[symbols.proxySelf].m.deepSet(`${partial}.${part}`, value);
            },
            configurable: false,
          });
          proxy = newProxy;
          structure = newStructure;
        } else {
          structure = structure.get(part);
          // this is the only thing the structure shebang is for
          proxy = structure.proxy;
        }
        partial = `${partial}.${part}`;
      }
      Object.defineProperty(proxy, tail, {
        get() {
          return this[symbols.proxySelf].m.deepGet(`${partial}.${tail}`);
        },
        set(value) {
          if (M.options.allowSettingThrough)
            this[symbols.proxySelf].m.deepSetWithParents(`${partial}.${tail}`, value);
          else
            this[symbols.proxySelf].m.deepSet(`${partial}.${tail}`, value);
        },
      });
    } else if (schemaPath.$isMongooseDocumentArray || schemaPath.instance === `Array`) {
      class ArrayProxy extends ArrayProxyBase {}
      if (schemaPath.$isMongooseDocumentArray) {
        class NestedProxy extends NestedProxyBase {}
        createAccessors(M, NestedProxy, schemaPath.schema);
        ArrayProxy.itemClass = NestedProxy;
      }
      Object.defineProperty(subjectClass.prototype, path, {
        get() {
          let proxy = new ArrayProxy(this, path);
          if (M.options.proxyArrayProxy && BuiltinProxy !== symbols.notAvailable)
            proxy = proxyArrayProxy(proxy);
          Object.defineProperty(this, path, {
            get: () => (this.m && this.m.deepGet(path)) ? proxy : undefined,
            set: basicSetter(path),
            __proto__: null,
          });
          if (this.m && this.m.deepGet(path))
            return proxy;
        },
        set: basicSetter(path),
      });
    } else if (schemaPath.$isSingleNested) {
      class NestedProxy extends NestedProxyBase {}
      createAccessors(M, NestedProxy, schemaPath.schema);
      Object.defineProperty(subjectClass.prototype, path, {
        get() {
          const proxy = new NestedProxy(this, path);
          Object.defineProperty(this, path, {
            get: () => (this.m && this.m.deepGet(path)) ? proxy : undefined,
            set: basicSetter(path),
            __proto__: null,
          });
          if (this.m && this.m.deepGet(path))
            return proxy;
        },
        set: basicSetter(path),
      });
    } else {
      Object.defineProperty(subjectClass.prototype, path, {
        get() {
          return this.m.deepGet(path);
        },
        set: basicSetter(path),
      });
    }
  });
  if (!subjectClass.prototype.toJSON) {
    subjectClass.prototype.toJSON = function() {return this.m.getData()};
  }
}

feature.createAccessors = createAccessors;
