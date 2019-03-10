const { diff } = require("../../");
const { Tracker, LCRSRenderer } = require("../effects");
const { isFn } = require("../util");

const renderer = new LCRSRenderer, events = [], effs = [new Tracker(events), renderer]

const makeChildrenTemps = (name, id, n) => {
  const children = [];
  for (let i = 0; i < n; i++){
    children.push({name, data: {id: id+""+i}});
  }
  return children;
}
const makeNode = (name, id="root", p, s) => {
  const node = diff({name, data: {id}, next: makeChildrenTemps(name, id, 3)}, null, p, s);
  node._id = id;
  if (p.cache) p.cache[id] = node;
  return node;
}
const print = (f, spaces="") => {
  let t = f.temp || f;
  console.log(`${spaces}${isFn(t.name) ? "ROOT" : t.name}: ${t.data.id}`);
  let cur = f.next;
  while(cur){
    print(cur, spaces + "  ")
    cur = cur.sib;
  }
}

const rootNode = makeNode((temp, p, isFirst) => {
  const c = p.cache = p.cache || {};
  if (isFirst){
    for (let c, id = 0; id < 4; id++) c = makeNode("DIV", id, p, c);
  } else {
    diff(c[1].temp, c[1], c[2]) // move 1 after 2    0213
    diff(c[2].temp, c[2], c[3]) // move 2 after 3    0132
    makeNode("DIV", 4, p, c[1]) //  add 4 after 1    01432
    makeNode("DIV", 5, p, c[3]) //  add 5 after 3    014352
    makeNode("DIV", 6, p, c[4]) //  add 6 after 4    0146352
    diff(c[3].temp, c[3], c[0]) // move 3 after 0    0314652
    diff(c[1].temp, c[1], c[3]) // move 1 after 3     "  "
    diff(null, c[2])            //       remove 2    031465
    diff(null, c[4])            //       remove 4    03165
  }
}, "root", {effs});

console.log("\nprinting tree")
renderer.tree && print(renderer.tree);

console.log("\ndiffing")
rootNode.diff();

console.log("\nprinting tree")
renderer.tree && print(renderer.tree)
console.log("\nprinting queued events")
console.log(events)

// OLD OUTPUT w/ ALL EVENTS
// ROOT: root
//   DIV: 0
//   DIV: 3
//   DIV: 1
//   DIV: 6
//   DIV: 5
// [ { mWA: 'root' },
//   { mWA: 3 },
//   { mWA: 2 },
//   { mWA: 1 },
//   { mWA: 0 },
//   { mWR: 'root' },
//   { mWM: 1 },
//   { mWM: null },
//   { mWA: 4 },
//   { mWA: 5 },
//   { mWA: 6 },
//   { mWM: 3 },
//   { mWP: 2 },
//   { mWP: 4 } ]