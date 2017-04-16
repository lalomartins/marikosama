import featureRegistry from './feature-registry';

export class ChangeLog {
  constructor() {
    this.changes = [];
    this.nextId = 0;
  }

  static get [Symbol.species]() {return ChangeLog}

  *[Symbol.iterator]() {
    yield* this.changes[Symbol.iterator];
  }

  *since(id) {
    for (const change of this.changes) {
      if (change.id >= id) yield change;
    }
  }

  clear(before) {
    if (before === undefined) this.changes = [];
    else if (before < 0) {
      // clear(-X) means keep X
      this.changes = this.changes.slice(this.changes.length + before);
    } else {
      for (const [index, change] of this.changes.entries())
        if (change.id >= before) {
          this.changes = this.changes.slice(index);
          return;
        }
    }
  }

  latest(offset = 1) {
    return this.changes[this.changes.length - offset];
  }

  // Important: this returns whether or not there was at least one change, not
  // whether it *is* changed since then.
  changedSince(since, path) {
    for (const change of this.changes) {
      if (change.id > since) {
        const index = change.path.indexOf(path);
        if (index >= 0) return {change, from: change.current[index]};
      }
    }
  }

  add(change) {
    console.debug(`adding change:`, change);
    if (!Array.isArray(change.path))
      change = {path: [change.path], value: [change.value], current: [change.current]};
    this.changes.push({...change, id: this.nextId++});
  }
}

if (!featureRegistry.has(`changeLog`)) featureRegistry.set(`changeLog`, {});
const feature = featureRegistry.get(`changeLog`);
feature.changeLogClass = ChangeLog;
