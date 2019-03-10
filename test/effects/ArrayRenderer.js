const Renderer = require("./Renderer");

// Renderers should be as dumb as possible.
//   * each method should be O(1) and self-explanatory
//   * provides a manual render function to construct the expected render
// effects may listen to events and create their own queues
// e.g. queue all willPush, willSwap, willPop, willReceive
// when didUpdate is called on the last element in the cycle, flush all events:
//   e.g. first remove all orphans (perhaps recycle their resources)
//        then push all

// XXX This is no longer in use and won't work, but I'm leaving it here because it is useful to inspect.
// Before I modified the internal representation to be an LCRS tree, the engine supported array-based
// renderers. I felt they were gimmicky and pretty much inferior to LCRCs trees for this use-case.
// Effects should not be doing random access on children. They are supposed to be dumb.
module.exports = class ArrayRenderer extends Renderer {
  attachChildren(node, next){
    node.next = next;
  }
  willAdd(f, p){ // assign new or recycled resources to f
    this.counts.a++;
    const node = f._node = this.node(f.temp);
    if (!p) this.tree = node;
  }
  willRemove(f, p){ // destroy or recycle resources from f
    this.counts.r++;
    f._node = null;
    if (!p) return (this.tree = null);
  }
  willLink(f, p, s, i){ // update the location of f
    this.counts.s++;
    const node = p._node;
    (node.next = node.next || [])[i] = f._node;
  }
  willUnlink(p, s, i){ // clip the children of p at i
    s = p._node, p = s.next;
    if (i) p.length > i && (p.length = i);
    else delete s.next;
  }
  willReceive(f, t){ // give new data to f
    this.counts.u++
    f._node.data = t.data;
  }
}
