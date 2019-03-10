const { TemplateFactory, doWork } = require("./helpers");
const { diff, Frame } = require("../../");
const { fillCases, runTests, time, frames, RENDER_WORK } = require("./perf-helpers");

// don't wanna doWork during initialization
let init = true;
class PostFlushSubframe extends Frame {
  render(temp){
    if (RENDER_WORK) init || doWork(RENDER_WORK);
    return temp.next;
  }
  rendered(){
  }
  cleanup(){
  }
}
const factory = new TemplateFactory(PostFlushSubframe);
const cases = fillCases((c, s, cache) => {
  for (let i = 0; i < 3; i++) cache.temps.push(factory[c](s));
})
// initialization is over, now we wanna doWork during diffs
init = false;

runTests(cases, (c, s, done) => {
  const { temps } = cases[c][s];
  let i = -1;
  const posTemp1 = temps.pop(), posTemp2 = temps.pop(), posTemp3 = temps.pop();
  time("mount w/ lifecycle", () => frames[++i] = diff(posTemp1)), i = -1;
  time("update w/ lifecycle", () => diff(++i%2 ? posTemp2 : posTemp3, frames[0])), i = -1;
  time("unmount w/ lifecycle", () => diff(null, frames[++i])), i = -1;
  done();
})
