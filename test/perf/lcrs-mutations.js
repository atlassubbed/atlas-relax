const KeyIndex = require("../../src/KeyIndex");
const { emit } = require("../../src/Frame");
const { isFrame, clearFrame, toFrame, link, unlink } = require("./lcrs-helpers");

const stack = [], lags = [], htap = [], rems = [];

const add = (t, p, s) => t && lags.push(emit("willAdd", t = toFrame(t, p.effs), p, s)) && link(t, p, s);
const remove = (f, p, s=f.prev) => rems.push(emit("willRemove", f, p, s)) && unlink(f, p, s);
const move = (f, p, s, s2=f.prev) => (emit("willMove", f, p, s2, s), unlink(f, p, s2), link(f, p, s));
const receive = (f, t) => (emit("willReceive", f, t), f.temp = t, f.sib);

const render = (next, ix) => {
  if (!next) return [];
  let copy = [], n = next.length;
  while(n--) copy.push(next[n]), ix && ix.push(next[n]);
  return copy;
}

const subdiff = f => {
  htap.push(emit("willUpdate", f));
  let p = f.next, ix, next = render(f.temp.next, p && (ix = new KeyIndex)), n = next.length;
  if (!n && p) {
    while(p.sib) p = p.sib;
    do { remove(p, c)} while(p = p.prev);
    unmount();
  } else if (n) if (!p) while(p = add(next.pop(), f, p));
  else { // both non-trivial
    while(p = (n = ix.pop(p.temp)) ? receive(n.p = p, n) : unmount(remove(p, f))); // handle unmounts and matches
    for(let c = f.next; c && (n = next.pop());) (p = n.p) ? (c === p ? // handle mounts and moves
      (c = c.sib) : move(p, f, c.prev), n.p = null) : add(n, f, c.prev);
    while(p = add(next.pop(), f, p)); // handle remaining mounts, p conveniently points to end
  }
}
const mount = (f, p, next) => {
  while(f = lags.pop()) if (stack.push(f), (next = render(f.temp.next)).length)
    while(p = add(next.pop(), f, p));
  while(f = stack.pop()) emit("didAdd", f);
}

const unmount = (f, c, p) => {
  while(c = rems.pop()) if (stack.push(c) && (p = c.next)){
    while(p.sib) p = p.sib;
    do { remove(p, c)} while(p = p.prev);
  }
  while(c = stack.pop()) emit("didRemove", c), clearFrame(c);
  return f;
}
const sidediff = f => {
  if (f) subdiff(f);
  mount();
  while(f = htap.pop()) emit("didUpdate", f);
}
const diff = (t, f, p, prevS, nextS) => {
  if (t && f){
    receive(f, t);
    if (isFrame(p) && s !== s2) emit("willMove", f, p, prevS, nextS)
    sidediff(f);
  } else if (t){
    mount(lags.push(emit("willAdd", f = toFrame(t, p.effs), isFrame(p) && p, nextS)))
  } else if (f){
    unmount(rems.push(emit("willRemove", f, isFrame(p) && p, prevS)))
  }
  return f;
}


module.exports = { diff }

