import Link from 'valuelink';

import featureRegistry from '../feature-registry';
import symbols from '../symbols';

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
    this.validate();
  }

  validate() {
    const error = this.m.validatePathSync({path: this.path, collect: true});
    if (error) {
      // TODO propagate to children if appropriate
      this.error = {
        help: error.message,
        state: `error`,
        error,
      };
    } else this.error = null;
  }
}

const implementation = {
  initClass(M) {
    Object.assign(M.prototype, {
      getLink(name, validate) {
        return this.deepLink(name, validate);
      },

      deepLink(path, validate) {
        // console.debug(`getting deep link for ${path} in`, this, `, current value is`, this.deepGet(path));
        const fullPath = this.basePath ? this.basePath + path : path;
        if (this[symbols.valueLinkCache].has(fullPath)) return this[symbols.valueLinkCache].get(fullPath);
        const link = new MarikoLink(this, path);
        this[symbols.valueLinkCache].set(fullPath, link);
        if (validate) link.validate();
        return link;
      },

      linkAll(paths, validate) {
        const links = {};
        for (const path of paths) links[path] = this.deepLink(path, validate);
        return links;
      }
    });
  },

  initInstance(m) {
    m[symbols.valueLinkCache] = new Map();
  },
};

if (!featureRegistry.has(`linking`)) featureRegistry.set(`linking`, new Map());
const feature = featureRegistry.get(`linking`);
feature.set(`valuelink`, implementation);
