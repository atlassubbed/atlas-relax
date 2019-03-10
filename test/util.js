const { expect } = require("chai");

const assertDeleted = f => {
  expect(f._node).to.be.null;
  expect(f.temp).to.be.null;
  expect(f.next).to.be.null;
  expect(f._affs).to.be.null;
  expect(f.affs).to.be.null;
  expect(f.par).to.be.null;
  expect(f.sib).to.be.null;
  expect(f.prev).to.be.null;
  expect(f._top).to.be.null;
  expect(f._bot).to.be.null;
  expect(f._evt).to.be.null;
}

const isArr = Array.isArray;

const isObj = x => x && typeof x === "object";

const isFn = x => x && typeof x === "function";

const isVoid = x => x == null || typeof x === "boolean";

const toArr = a => isArr(a) ? a : [a];

const has = (str, substr) => str.indexOf(substr) > -1

const isScalar = str => {
  return !(has(str, "(array)") || has(str, "(tensor)"))
}

const inject = (parent, next) => (parent.next = next, parent);

const type = str => {
  const i = str.indexOf("(");
  if (i < 0) return str;
  return str.slice(0, i).trim();
}

const deepIgnore = (node, txfm) => {
  txfm(node);
  let c;
  if (c = node.next) do {
    deepIgnore(c, txfm);
  } while(c = c.sib)
  return node;
}

const merge = (a, b) => {
  if (b) for (let k in b) a[k] = b[k];
  return a;
}

const pretty = tree => JSON.stringify(tree, null, 2)

// pseudo-deep copy a multi-dimensional array
const copy = t => t && (isArr(t) ? t.map(copy) : Object.assign({}, t));

const asap = Promise.resolve().then.bind(Promise.resolve());

module.exports = {
  assertDeleted,
  isArr, isObj, isFn, isVoid, isScalar, asap,
  toArr, has, inject, type, pretty, copy, deepIgnore, merge
}
