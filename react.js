import {Component} from 'react';

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
    console.debug(`Watch got event`, arguments);
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
