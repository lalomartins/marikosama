import {EventEmitter} from 'events';

import symbols from './symbols';
import featureRegistry from './feature-registry';

export class QueryM extends EventEmitter {
  constructor(queryResults) {
    super();
    this.queryResults = queryResults;
    if (queryResults.M.options.changeLog) {
      const changeLog = featureRegistry.get(`changeLog`);
      if (changeLog && changeLog.changeLogClass) {
        this.changeLog = new changeLog.changeLogClass();
        this.on(`update`, (id, object, old) => this.changeLog.add(id, object, old));
      } else if (queryResults.M.options.changeLog !== symbols.ifAvailable) {
        console.error(`Mariko-Sama: changeLog requested but the feature wasn't imported`);
      }
    }
  }
}


// EventEmitter in case you don't want to use ChangeLog
export class QueryResults {
  constructor(M) {
    this.M = M;
    this.m = new QueryM(this);
  }

  // alias to make user code more readable
  first = () => this[Symbol.iterator]().next().value

  get total_rows() {return this.length}
  get length() {return 0}
  get offset() {return 0}

  [Symbol.iterator]() {
    return [][Symbol.iterator]();
  }

  map(f) {
    const res = [];
    for (const item of this) res.push(f(item));
    return res;
  }
}
