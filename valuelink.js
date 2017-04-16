import featureRegistry from './feature-registry';
import Link from 'valuelink';
import symbols from './symbols';

symbols.valueLinkCache = Symbol(`valueLinkCache`);

class MarikoLink extends Link {
  constructor(m, path) {
    super(m.deepGetMaybe(path));
    this.m = m;
    this.path = path;
  }

  get value() {
    return this.m.deepGet(this.path);
  }

  set value(value) {
    // called only by the parent Link class, ignore
  }

  set(value) {
    this.m.deepSet(this.path, value);
  }
}

const implementation = {
  initClass(M) {
    Object.assign(M.prototype, {
      getLink(name) {
        // console.debug(`getting link for ${name} in`, this, `, current value is`, this.deepGet(name));
        if (this[symbols.valueLinkCache].has(name)) return this[symbols.valueLinkCache].get(name);
        const link = new MarikoLink(this, name);
        this[symbols.valueLinkCache].set(name, link);
        return link;
      },

      deepLink(path) {
        // console.debug(`getting deep link for ${path} in`, this, `, current value is`, this.deepGet(path));
        if (this[symbols.valueLinkCache].has(path)) return this[symbols.valueLinkCache].get(path);
        const link = new MarikoLink(this, path);
        this[symbols.valueLinkCache].set(path, link);
        return link;
      },
    });
  },

  initInstance(m) {
    m[symbols.valueLinkCache] = new Map();
  },
};

if (!featureRegistry.has(`linking`)) featureRegistry.set(`linking`, new Map());
const feature = featureRegistry.get(`linking`);
feature.set(`valuelink`, implementation);
