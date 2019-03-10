const { TemplateFactory, doWork } = require("./helpers");
const { diff, Frame } = require("../../");
const { fillCases, runTests, time, frames, RENDER_WORK } = require("./perf-helpers");
const { isArr } = require("../util")

// don't wanna doWork during initialization
let init = true;
class Subframe extends Frame {
  render(temp){
    if (RENDER_WORK) init || doWork(RENDER_WORK);
    return temp.next;
  }
}
// updates single root
class ManagedSubframe extends Frame {
  render({next}, node){
    if (RENDER_WORK) init || doWork(RENDER_WORK);
    if (!node.next) {
      if (isArr(next)) {
        let i = next.length;
        while(i--) diff(next[i], null, node)
      } else diff(next, null, node)
    } else diff(isArr(next) ? next[0] : next, node.next);
  }
}
// updates single root
class ContextSubframe extends Frame {
  render({next}, node){
    if (RENDER_WORK) init || doWork(RENDER_WORK);
    if (!node.next) {
      if (isArr(next)) {
        let i = next.length;
        while(i--) diff(next[i])
      } else diff(next)
    } else diff(isArr(next) ? next[0] : next, node.ctx);
  }
}
const factory = new TemplateFactory(Subframe);
const cases = fillCases((c, s, cache) => {
  [ContextSubframe, ManagedSubframe].forEach(F => {
    for (let i = 0; i < 3; i++) {
      const temp = factory[c](s-1);
      temp.name = F;
      cache.temps.push(temp)
    }
  })
})
// initialization is over, now we wanna doWork during diffs
init = false;

runTests(cases, (c, s, done) => {
  const { temps } = cases[c][s];
  let i = -1;
  const manTemp1 = temps.pop(), manTemp2 = temps.pop(), manTemp3 = temps.pop();
  const stdTemp1 = temps.pop(), stdTemp2 = temps.pop(), stdTemp3 = temps.pop();
  time("mount managed", () => frames[++i] = diff(manTemp1)), i = -1;
  time("update 1 managed child", () => diff(++i%2 ? manTemp2 : manTemp3, frames[0])), i = -1;
  time("unmount managed", () => diff(null, frames[++i])), i = -1;
  time("mount standalones", () => frames[++i] = diff(stdTemp1)), i = -1;
  time("update 1 standalone child", () => diff(++i%2 ? stdTemp2 : stdTemp3, frames[0])), i = -1;
  time("unmount standalones", () => diff(null, frames[++i])), i = -1;
  done();
})
