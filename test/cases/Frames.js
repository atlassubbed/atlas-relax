const { toArr, copy, isFn, merge, asap } = require("../util");
const { Frame } = require("../../");

// Frame classification:
//   1. Reducibility (irreducible, reducible (stateful, stateless))
//   2. Rank (0, 1, 2+)
//   3. Composability (blackbox, functional)
// Template classification:
//   1. Void (in diff's kernel)
//   2. Literal (sterile)
//   3. Object

const IrreducibleFunctional = "div";

const StatelessBlackboxScalar = ({data}) => ({
  name: "div", data, next: [
    {name: "p", data},
    {name: "span", data}
  ]
})
class StatefulBlackboxScalar extends Frame {
  render({data}){
    return StatelessBlackboxScalar(data)
  }
}

const StatelessBlackboxVector = ({data}) => [
  {name: "div", data},
  {name: "p", data}
]
class StatefulBlackboxVector extends Frame {
  render({data}){
    return StatelessBlackboxVector(data)
  }
}

const StatelessFunctionalScalar = ({data, next}) => ({
  name: "div", data, next: [
    {name: "p", data},
    {name: "span", data},
    {name: "a", data, next}
  ]
})
class StatefulFunctionalScalar extends Frame {
  render({data, next}){
    return StatelessFunctionalScalar(data, next);
  }
}

const StatelessFunctionalVector = ({data, next}) => [
  {name: "div", data},
  {name: "p", data},
  ...toArr(next)
]
class StatefulFunctionalVector extends Frame {
  render({data, next}){
    return StatelessFunctionalVector(data, next);
  }
}

// StemCell frames are useful for testing
//   * they take lifecycle methods as template props
//   * thus they become "differentiated" upon construction
//   * they also implement a simple setState function that wraps inner-diff
//     * the engine doesn't care about how state is stored or changed
//     * it only cares about scheduling and performing updates.
//     * state could be as simple as a single primitive field 
//       or as complex as an object that defines how it is changed
class StemCell extends Frame {
  constructor(temp, effs){
    let data = temp.data, hooks = data && data.hooks;
    super(temp, effs);
    this._isFirst = true;
    this._isFirstPost = true;
    this.state = this.nextState = null;
    if (hooks){
      if (hooks.ctor) hooks.ctor.bind(this)(this);
      for (let h in hooks)
        this[h] = hooks[h].bind(this)
    }
  }
  // always sets state, returns false if didn't result in reschedule/rebase
  setState(partialState, tau){
    if (this.nextState) merge(this.nextState, partialState);
    else this.nextState = partialState || {};
    if (tau === 0) tau = asap; // integration test queueing functions 
    return this.diff(tau);
  }
  render(temp, f){
    const isFirst = f._isFirst;
    f._isFirst = false;
    const { data, next } = f._latestTemp = temp;
    if (f.nextState) f.state = merge(f.state || {}, f.nextState), f.nextState = null;
    if (f._evt) for (let eff of toArr(f._evt._evt)) if (eff && eff.log) eff.log(isFirst ? "wA" : "wU", f, temp);
    isFirst ? f.willAdd && f.willAdd(f) : f.willUpdate && f.willUpdate(f);
    if (f.getNext) return f.getNext(data, next, f, isFirst);
    return data && data.copy ? copy(next) : next;
  }
  rendered(f){
    const isFirst = f._isFirstPost;
    const temp = f._latestTemp;
    f._isFirstPost = false;
    if (this._evt) for (let eff of toArr(this._evt._evt)) {
      if (eff && eff.log) {
        // XXX we aren't emitting these events, because it'd break any test who isn't expecting 
        // them. We may decide to come back later and add these events in, but we'd have to 
        // add stuff like {dA: 0}, {dA: 1}, etc. into all of our expect event arrays for many tests.
        if (isFirst && f.didAdd) eff.log("dA", f, temp);
        else if (!isFirst && f.didUpdate) eff.log("dU", f, temp);
      }
    }
    isFirst ? f.didAdd && f.didAdd(f) : f.didUpdate && f.didUpdate(f);
  }
  static h(id, data, next){
    data = data || {}, data.id = id, data.copy = true;
    return {name: StemCell, data, next};
  }
  static m(id, data, next){
    data = data || {}, data.id = id;
    return {name: StemCell, data, next};
  }
}

class StemCell2 extends StemCell {
  static h(id, data, next){
    data = data || {}, data.id = id;
    return {name: StemCell2, data, next};
  }
}

class B extends Frame {}

module.exports = {
  IrreducibleFunctional,
  B,
  StemCell,
  StemCell2,
  Blackboxes: [
    StatelessBlackboxScalar, StatefulBlackboxScalar,
    StatelessBlackboxVector, StatefulBlackboxVector
  ],
  Functionals: [
    StatelessFunctionalScalar, StatefulFunctionalScalar,
    StatelessFunctionalVector, StatefulFunctionalVector
  ]
}