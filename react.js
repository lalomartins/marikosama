import React, {Component} from 'react';
import symbols from './symbols';
import './changeLog';

export class Watch extends Component {
  componentWillMount() {
    this.setupListeners(this.props);
  }

  componentWillReceiveProps(nextProps) {
    this.removeListeners(this.props);
    this.setupListeners(nextProps);
  }

  componentWillUnmount() {
    this.removeListeners(this.props);
  }

  wrappedForceUpdate() {
    // This exists just to discard any arguments, to make sure we don't pass
    // anything odd do p?react in case they change the API in the future
    this.forceUpdate();
  }

  setupListeners(props) {
    const events = props.events || [`update`];
    for (const event of events) {
      let emitters = props[event] || [];
      if (!Array.isArray(emitters)) emitters = [emitters];
      for (const emitter of emitters)
        emitter.on(event, ::this.wrappedForceUpdate);
    }
  }

  removeListeners(props) {
    const events = props.events || [`update`];
    for (const event of events) {
      let emitters = props[event] || [];
      if (!Array.isArray(emitters)) emitters = [emitters];
      for (const emitter of emitters)
        emitter.removeListener(event, ::this.wrappedForceUpdate);
    }
  }

  render() {
    return this.props.children;
  }
}

export function modelConsumer(providers) {
  return function(component) {
    return class ModelManager extends ModelManagerBase {
      static providers = providers
      static wrappedComponent = component
    };
  };
}

class ModelManagerBase extends Component {
  constructor(props) {
    super(props);
    this.state = {};
    this.cache = new Map();
    for (const name of Object.getOwnPropertyNames(this.constructor.providers)) {
      const provider = this.constructor.providers[name];
      this.cache.set(name, {
        lastRevision: 0,
        object: this.state[name] = provider.initialValue,
        handler: (...update) => {this.handleUpdate(name, ...update)},
      });
    }
  }

  makeProxy(object, cache) {
    const m = Object.create(object.m);
    m.revision = cache.lastRevision;
    if (cache.proxy) {
      m.previousRevision = cache.proxy.m.revision;
      m.changed = function(path) {return this.changedSince(this.previousRevision, path)};
    } else
      m.changed = () => symbols.notAvailable;
    const proxy = Object.create(object);
    Object.defineProperty(proxy, `m`, {get: () => m, __proto__: null});
    cache.proxy = proxy;
    return proxy;
  }

  replace(name, object) {
    const oldCache = this.cache.get(name);
    if (oldCache && oldCache.object) {
      if (oldCache.object.m && oldCache.object.m.on) {
        oldCache.object.m.removeListener(`update`, oldCache.handler);
      } else if (oldCache.object.on) {
        oldCache.object.removeListener(`update`, oldCache.handler);
      }
      if (this.constructor.providers[name].dispose) {
        this.constructor.providers[name].dispose(oldCache.object);
      }
    }
    const lastRevision = object.m && object.m.changeLog && object.m.changeLog.latest();
    const newCache = {
      lastRevision: lastRevision ? lastRevision.id : 0,
      object,
      handler: oldCache.handler,
    };
    this.cache.set(name, newCache);
    if (object && object.m && object.m.on) {
      object.m.on(`update`, newCache.handler);
      this.setState({[name]: this.makeProxy(object, newCache)});
    } else {
      if (object.on)
        object.on(`update`, newCache.handler);
      this.setState({[name]: object});
    }
  }

  // We don't really care about the event details, the changeLog takes care of it for us
  handleUpdate(name) {
    const cache = this.cache.get(name);
    // Sanity check / debounce
    if (cache.object && cache.object.m && cache.object.m.changeLog) {
      if (cache.object.m.changeLog.latest().id > cache.lastRevision) {
        cache.lastRevision = cache.object.m.changeLog.latest().id;
        this.setState({[name]: this.makeProxy(cache.object, cache)});
      }
    } else {
      // this works in preact but probably not in react
      this.setState({[name]: cache.object});
    }
  }

  componentWillMount() {
    const stateUpdate = {};
    for (const name of Object.getOwnPropertyNames(this.constructor.providers)) {
      const provider = this.constructor.providers[name];
      const cache = this.cache.get(name);
      if (provider.initializeSync) {
        cache.object = provider.initializeSync(this.props);
        cache.lastRevision = cache.object.m.changeLog.latest().id;
      }
      if (cache.object && cache.object.m && cache.object.m.on)
        stateUpdate[name] = this.makeProxy(cache.object, cache);
      else
        stateUpdate[name] = cache.object;
    }
    this.setState(stateUpdate);
    for (const name of Object.getOwnPropertyNames(this.constructor.providers)) {
      const provider = this.constructor.providers[name];
      const cache = this.cache.get(name);
      if (cache.object && cache.object.m && cache.object.m.on)
        cache.object.m.on(`update`, cache.handler);
      else if (cache.object.on)
        cache.object.on(`update`, cache.handler);
      if (provider.initialize)
        provider.initialize(this.props).then((object) => this.replace(name, object));
    }
  }

  componentWillUnmount() {
    for (const [name, cache] of this.cache.entries()) {
      if (cache.object) {
        if (cache.object.m && cache.object.m.on)
          cache.object.m.removeListener(`update`, cache.handler);
        else if (cache.object.on)
          cache.object.removeListener(`update`, cache.handler);
        if (this.constructor.providers[name].dispose)
          this.constructor.providers[name].dispose(cache.object);
      }
    }
  }

  componentWillReceiveProps(nextProps) {
    const stateUpdate = {};
    const needHandlers = [];
    for (const name of Object.getOwnPropertyNames(this.constructor.providers)) {
      const provider = this.constructor.providers[name];
      const cache = this.cache.get(name);
      if (provider.updateSync) {
        const providerUpdate = provider.updateSync(this.props, nextProps);
        if (providerUpdate && providerUpdate.update) {
          if (cache.object && cache.object.m && cache.object.m.on)
            cache.object.m.removeListener(`update`, cache.handler);
          cache.object = providerUpdate.object;
          cache.lastRevision = cache.object.m.changeLog.latest().id;
          if (cache.object && cache.object.m && cache.object.m.on) {
            stateUpdate[name] = this.makeProxy(cache.object, cache);
            needHandlers.push([cache.object.m, cache.handler]);
          } else {
            if (cache.object.on)
              needHandlers.push([cache.object, cache.handler]);
            stateUpdate[name] = cache.object;
          }
        }
      }
    }
    this.setState(stateUpdate);
    for (const [emitter, handler] of needHandlers)
      emitter.on(`update`, handler);
    for (const name of Object.getOwnPropertyNames(this.constructor.providers)) {
      const provider = this.constructor.providers[name];
      if (provider.update)
        provider.update(this.props, nextProps).then((providerUpdate) => {
          if (providerUpdate && providerUpdate.update)
            this.replace(name, providerUpdate.object);
        });
    }
  }


  render() {
    const providerProps = {};
    for (const name of Object.getOwnPropertyNames(this.constructor.providers)) {
      const provider = this.constructor.providers[name];
      const proxy = this.state[name]; // also equal to cache.proxy
      if (provider.wrap) providerProps[name] = provider.wrap(proxy);
      else providerProps[name] = proxy;
    }
    return React.createElement(this.constructor.wrappedComponent, {...this.props, ...providerProps});
  }
}

export const notFound = symbols.notAvailable;
export const loading = symbols.loading;
