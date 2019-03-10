const { TemplateFactory, doWork, asap, makeEntangled } = require("./helpers");
const { diff, Frame } = require("../../");
const { fillCases, runTests, time, frames, RENDER_WORK, SAMPLES } = require("./perf-helpers");

// don't wanna doWork during initialization
let init = true;
class Subframe extends Frame {
  render(temp){
    if (RENDER_WORK) init || doWork(RENDER_WORK);
    return this.state || temp.next;
  }
  setState(next, tau){
    this.state = next, this.diff(tau);
  }
}
const factory = new TemplateFactory(Subframe);
const cases = fillCases((c, s, cache) => {
  for (let i = 0; i < 8; i++) cache.temps.push(factory[c](s));
  cache.entRoot = makeEntangled(factory[c](s))
  cache.schedRoot = diff(factory[c](s))
})

// initialization is over, now we wanna doWork during diffs
init = false;

runTests(cases, (c, s, done) => {
  const { temps, entRoot, schedRoot } = cases[c][s];
  let i = -1;
  const temp1 = temps.pop(), temp2 = temps.pop(), temp3 = temps.pop();
  const entTemp1 = temps.pop(), entTemp2 = temps.pop();
  entTemp1.next = entTemp2.next = null;
  const memoTemp1 = Object.assign({}, temp1), memoTemp2 = Object.assign({}, temp1);
  const state3 = temps.pop().next;
  const state4 = temps.pop().next;
  const state5 = temps.pop().next;
  const opts = {remove(){}, add(){}, move(){}, temp(){}}
  time("mount effects", () => frames[++i] = diff(temp1, null, opts)), i = -1;
  time("update effects", () => diff(++i%2 ? temp2 : temp3, frames[0])), i = -1;
  time("unmount effects", () => diff(null, frames[++i])), i = -1;
  time("mount", () => frames[++i] = diff(temp1)), i = -1;
  time("update", () => diff(++i%2 ? temp2 : temp3, frames[0])), i = -1;
  time("update memoized", () => diff(++i%2 ? memoTemp1 : memoTemp2, frames[0])), i = -1;
  time("unmount", () => diff(null, frames[++i])), i = -1;
  time("update entangled", () => diff(++i%2 ? entTemp1 : entTemp2, entRoot)), i = -1;
  time("update sync", () => schedRoot.setState(++i%2 ? state4 : state5));
  time("schedule polycolor", () => schedRoot.setState(state3, --i));
  time("schedule monocolor", () => schedRoot.setState(state4, ++i === SAMPLES ? -1 : 1)), i = -1;
  time("schedule immediate", () => schedRoot.setState(state5, ++i === SAMPLES ? -1 : 0)), i = -1;
  time("update async", done => {
    schedRoot.setState(++i%2 ? state4 : state3, asap)
    asap(done)
  }, () => done())
})
