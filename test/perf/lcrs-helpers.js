const Renderer = require("../effects/Renderer");
const { expect } = require("chai");

const insertAfter = (f, p, s) => {
  f.sib = s ? s.sib : p.next;
  if (s) s.sib = f;
  else p.next = f;
}
const removeAfter = (f, p, s) => {
  if (s) s.sib = f.sib;
  else p.next = f.sib;
}
class SinglyLinkedEffect extends Renderer {
  attachChildren(node, next){
    let child, sib, i;
    node.next = next[i = 0];
    while(child = next[i++], sib = next[i]) child.sib = sib;
  }
  node({name, key, data}){
    const node = { name, sib: null, next: null };
    if (key != null) node.key = key;
    if (data != null) node.data = data;
    return node;
  }
  willAdd(f, p, s){
    console.log("ADD", f.temp.key, p && p.temp.key, s && s.temp.key)
    this.counts.a++;
    const node = f._node = this.node(f.temp);
    if (!p) this.tree = node;
    p && insertAfter(node, p._node, s && s._node);
  }
  didAdd(f){
    console.log("DID ADD", f.temp.key)
  }
  willRemove(f, p, s){
    console.log("REMOVE", f.temp.key, p && p.temp.key, s && s.temp.key)
    this.counts.r++;
    const node = f._node;
    if (!p) this.tree = null;
    else if (p._node) removeAfter(node, p._node, s && s._node);
    f._node = f._node.sib = f._node.next = null;
  }
  willMove(f, p, ps, ns){
    console.log("MOVE", f.temp.key, p.temp.key, ps && ps.temp.key, ns && ns.temp.key)
    this.counts.s++;
    const node = f._node, parent = p._node;
    removeAfter(node, parent, ps && ps._node);
    insertAfter(node, parent, ns && ns._node);
  }
  willReceive(f, t){
    // console.log("RECEIVE", f.temp.key)
    this.counts.u++
    if (t.data != null) f._node.data = t.data;
  }
}

const print = (f, spaces="") => {
  let t = f.temp || f;
  console.log(`${spaces}${t.name} ${t.key}`);
  let cur = f.next;
  while(cur){
    print(cur, spaces + "  ")
    cur = cur.sib;
  }
}

const assertNull = nodes => {
  for (let f of nodes) 
    for (let k in f) expect(f[k]).to.be.null;
}
const assertList = (f, notFirst) => {
  if (!f || !f.temp) return f && assertNull([f]), 0;
  if (!notFirst) expect(f.prev).to.be.null;
  if (f.sib) expect(f.sib.prev).to.equal(f);
  expect(f.temp.p).to.not.exist;
  return 1 + assertList(f.sib, true) + assertList(f.next);
}

const assertTree = (renderer, temp) => {
  expect(renderer.tree).to.deep.equal(renderer.render(temp));
}

const isFrame = f => !!(f && f.temp)

const clearFrame = f => {f.next = f.temp = f.effs = f.prev = f.sib = null}

const toFrame = (temp, effs) => ({temp, effs, next: null, prev: null, sib: null})

const link = (f, p, s) => {
  let k = f.sib = s ? s.sib : p.next;
  if (k) k.prev = f;
  if (k = f.prev = s || null) k.sib = f;
  else p.next = f;
  return f;
}

const unlink = (f, p, s) => {
  let next = f.sib;
  if (s && next) (s.sib = next).prev = s;
  else if (s) s.sib = null;
  else if (next) (p.next = next).prev = null;
  else p.next = null;
  return next;
}

module.exports = { assertList, assertNull, print, SinglyLinkedEffect, assertTree, isFrame, clearFrame, toFrame, link, unlink };
