const { assertList, print, SinglyLinkedEffect, assertTree, assertNull } = require("./lcrs-helpers");
const { shuffle, sample, insert, int } = require("atlas-random");
const { diff } = require("./lcrs-mutations");
const { Cache } = require("../effects");

let id = 0;

// XXX This is legacy playground code; I am not removing it, perhaps it is useful to inspect.
//   It will probably not work anymore as APIs have changed.

const makeTemps = n => {
  let list = [];
  for (let i = 0; i < n; i++) list[i] = {name:"p", key: id++};
  return list;
}

const renderer = new SinglyLinkedEffect, cache = new Cache([]);
const children = makeTemps(5);
(sample(children).next = makeTemps(3))[1].next = makeTemps(3)

const nextChildren = sample(shuffle([...children]), 3)
nextChildren.splice(int(nextChildren.length), 0, {name: "div", key: "child"});
const temp = {name: "div", key: "parent", next: children};
const nextTemp = {name: "div", key: "parent", next: nextChildren};

const f = diff(temp, null, [renderer, cache]);
console.log(assertList(f))
assertTree(renderer, temp);
print(f)

const nodes = cache.nodes.map(n => n._node);

console.log(nextChildren.map(t => t.key).join(" "))
diff(nextTemp, f)
console.log(assertList(f))
assertTree(renderer, nextTemp);
print(f)

diff(null, f);
console.log(cache.nodes)
console.log(nodes)
console.log(assertList(f))
assertNull(cache.nodes)
assertTree(renderer, null);
print(f)