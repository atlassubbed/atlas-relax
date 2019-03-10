// this file is manually unrolled
//   * webpack's closure bundling adds .3kb to the min.gz bundle size.
//   * in the future, I may refactor these into their own files if using rollup

/** BIT VECTOR
    The initial approach may be to use an enum for all possible states,
    but this forces you to do bookkeeping and is a pain to update if you need new states.
    If you have lots of flag states, it is more efficient to store state in a bit vector.

    We have 5 states, so our integer looks like: 

      XXXXXXXXXXXXXXXXXXXXXXXXXXXSSSSS N = 5 bits for state
    
    Each bit is an orthogonal component in the vector, so updating a flag is easy.
    The size of the state space is given by ORDER = 2^N = 2^5 = 32.

    In the example above, we have 27 "wasted" bits (denoted by X). 
    We use those for a counter to avoid making an extra counter integer. 
    Because of this, we must be careful when dealing with bit operations. 
      1. We mustn't set state into a coerced 32 bit, or we'd lose ~21 bits of entropy for counters.
          * we would lose ~21 bits of entropy for our counter bits
          * Setting bits via state |= BIT is not allowed
            * because i32s drop most sig bits
          * Unsetting bits via state &= ~BIT is also not allowed
          * Resetting counter via state &= ORDER-1 is allowed
            * because we're setting most sig bits to zero anyway
          * Querying state via state & BIT is allowed
      2. We mustn't increment counters by anything other than the ORDER of the state space
          * since ORDER = 0 (mod ORDER), we lose no state information. */
// node states
const IS_CHLD = 1;
const IS_CTXL = 2;
const HAS_EVT = 4;
const IN_PATH = 8;
const IN_POST = 16
const ORDER = 32;

// diff states
const IDLE = 0;
const DIFF = 1;
const LOCK = 2;

// query bitmasks
const isCtx = f => f._ph & IS_CTXL;
const isCh = f => f._ph & IS_CHLD;
const inPath = f => f._ph & IN_PATH;
const isUpd = f => f._ph & HAS_EVT;

// util functions
const isFn = f => typeof f === "function";
const norm = t => t != null && t !== true && t !== false && 
  (typeof t === "object" ? t : {name: null, data: String(t)});
const isFrame = f => f && isFn(f.render);
const isAdd = f => f && isUpd(f) && !f._evt._temp;
const sib = p => p && !isCtx(p) ? p : null;

// aux data structures
const lags = [], orph = [], rems = [], stx = [], path = [], post = [], field = new Map;

// flatten and sanitize a frame's next children
//   * if ix then index the nodes' implicit/explicit keys
const clean = (t, ix, next=[]) => {
  stx.push(t);
  while(stx.length) if (t = norm(stx.pop()))
    if (Array.isArray(t)) for (t of t) stx.push(t);
    else next.push(t), ix && pushIndex(t)
  return next
}
// emit mutation event to plugins
const emit = (evt, type, f, p, s, ps) => {
  if (Array.isArray(evt)) for (evt of evt)
    evt[type] && evt[type](f, p, s, ps);
  else evt[type] && evt[type](f, p, s, ps);   
}

// not to be instantiated by caller
const Frame = function(temp, _evt){
  this._evt = _evt ? {
    _evt,
    _temp: null,
    _next: null,
    _sib: null,
    _prev: null,
    _top: null,
    _bot: null
  } : null;
  this.affs = this._affs = this.par =
  this.next = this.sib = this.prev = this._top = this._bot = null;
  this.temp = temp;
}

/** ENTANGLEMENT -- nodes can sub and unsub from each other (prototype methods)
    Goal: keep edge information about the graph, so that we can compute path order.
    Instead of using an event-based pub-sub paradigm, we use a topological picture:
      * naive event-based solutions run into problems like double-counting and
        inconsistent state.
      * tracking edges is O(N) traversal, which is acceptable overhead
      * registering edges is amortized O(1) insert/remove
      * Relax aims to be a robust solution for DAG architectures not only rooted trees.
        * in practice, most apps are DAGs
      * libs like Preact remain slightly faster because they do not do these checks
      * unidirectional spooky action at a distance is the analogy here
        * if node A is entangled (subbed) to node B, A will automatically 
          collapse into its new state after B collapses into its new state.
        * entanglement is used to establish sideways dependencies between nodes 
      * to keep diff cycles simple, entanglement changes made during a diff cycle will
        be buffered and applied only on the next rebase/cycle */
Frame.prototype = {
  constructor: Frame,
  render(temp){
    return temp.next;
  },
  // rarely called, use sets for sublinearity
  sub(f){
    isFrame(f) && f !== this && (f.affs = f.affs || new Set).add(this)
  },
  unsub(f){
    isFrame(f) && f.affs && f.affs.delete(this) && (f.affs.size || (f.affs = null))
  },
  // instance (inner) diff (schedule updates for frames)
  diff(tau=-1){
    return on < LOCK && !!this.temp &&
      !(!isFn(tau) && tau < 0 ?
        (on ? rebasePath : sidediff)(pushPath(this)) :
        excite(this, tau, isFn(tau) && tau))
  }
}

// on = {0: not diffing, 1: diffing, 2: cannot rebase or schedule diff}
let head, tail, on = IDLE, ctx = null, keys = new Map;

// KEY INDEXER
// indexes explicit and implicit keys in LIFO order
const pushIndex = (t, ix, k) => {
  (ix = keys.get(k = t.name)) || keys.set(k, ix = {});
  (k = t.key) ?
    ((ix = ix.exp = ix.exp || {})[k] = t) :
    (ix.imp = ix.imp || []).push(t);
}
const popIndex = (t, ix, k) =>
  (ix = keys.get(t.name)) &&
    ((k = t.key) ?
      ((ix = ix.exp) && (t = ix[k])) && (ix[k] = null, t) :
      (ix=ix.imp) && ix.pop())

/** FIBER -- A 'fiber' is linked list of contiguous child chains.
    Motivation: 
      1. Rebasing diffs during a diff can lead to unbounded memory usage
      2. Plugins that add nodes before removing old ones don't get a chance to recycle nodes
      3. Mutations are non-commutative operations
      4. We don't need random access, but we need O(1) event modifications (add/rem).
    Goals:
      1. Efficiently merge redundant mutations, using O(N) memory, at most.
      2. Process all remove events before any other events for maximal recycling potential.

    Given a list of children, we can color the nodes red and black:

      r-r-r-r-b-b-b-b-r-r-r-r-b-b-b-b-r-r-r-r-b-b-r-b-r-b-b-b-r-b
      a1    w1        a2    w2        ...

    Note the structure above isn't a fiber. It's just a list of children nodes.
    Red nodes are nodes with updates. Contiguous groups of red nodes form chains in a fiber. 
    The first red node in a chain is called a 'leader' or alpha node (a1, a2 above). 
    The last one is called an omega node (w1, w2 above).
    A node may be an alpha and an omega node.

    Fibers are formed by linking together the alpha nodes. 
    A previous algorithm chained alphas and omegas.
    We just chain alphas for simplicity (while maintaining O(1) access).
    Nodes in a fiber need not share the same parent.
    Nodes in a chain must share the same parent.

    Fiber:

      (head)                  (tail)
        a1----a2----a3----a4----a5
        |      |     |     |     |
          ... sibling chains ....

    This allows us to handle events in the correct order:
    For all (e1,e2): 
      If e1(e2(node)) !== e2(e1(node)):
        The fiber will apply e1 and e2 in the order they were recieved.

    Properties:
      1. every node in the fiber must be an alpha node
      2. O(1) insert and remove
      3. O(U) traversal (U <= N)
      4. O(N) extra memory
      5. unmounts are processed immediately
      6. subtree mounts are processed before the next sibling */
// add leader node to fiber
const pushLeader = f => {
  if (!head) head = tail = f;
  else (tail._evt._top = f)._evt._bot = tail, tail = f;
}
// remove leader node from fiber
const popLeader = (ns, f, e=ns._evt, b=e._bot, t=e._top) => {
  if (f ? (f._evt._bot = b) : b) b._evt._top = f || t, e._bot = null;
  else head = f || t;
  if (f ? (f._evt._top = t) : t) t._evt._bot = f || b, e._top = null;
  else tail = f || b;
}
const queue = (f, s, ns) => {
  if (!s || !isUpd(s)){
    if (!ns || !isUpd(ns)) pushLeader(f);
    else popLeader(ns, f);
  }
}
const dequeue = (f, s, ns=f.sib) => {
  if (isUpd(f)){
    if (!s || !isUpd(s)) popLeader(f, ns && isUpd(ns) && ns)
  } else if (s && isUpd(s) && ns && isUpd(ns)) popLeader(ns);
}
// detach event f after sibling s
const unlinkEvent = (f, p, s=f._prev, next) => {
  (next = f._sib) && (next._evt._prev = s);
  s ? (s._evt._sib = next) : (p._next = next);
}
// attach event f after sibling s
const linkEvent = (e, f, p, s, next) => {
  (next = e._sib = (e._prev = s) ? s._evt._sib : p._next) && (next._evt._prev = f);
  s ? (s._evt._sib = f) : (p._next = f)
}
// empties the fiber, emitting the queued events
const flushEvents = (c, f, e, p, owner) => {
  if (rems.length) {
    while(f = rems[c++]){
      f.cleanup && f.cleanup(f);
      if (e = f._evt) emit(e._evt, "remove", f, e._next, e._prev, e._temp, f._evt = null);
    }
    rems.length = 0;
  }
  if (!(f = head)) return;
  owner = f.par;
  while(f) {
    p = f.par;
    if (isUpd(f)){
      f._ph -= HAS_EVT, e = f._evt;
      if (!e._temp){
        c = sib(f);
        emit(e._evt, "add", f, c && p, c && f.prev, f.temp);
        if (c && p) linkEvent(e, f, p._evt, sib(f.prev));
        if (sib(f.next)){
          f = f.next;
          continue;
        }
      } else {
        if (f.temp !== e._temp) emit(e._evt, "temp", f, f.temp, e._temp);
        if ((c = sib(f.prev)) !== e._prev){
          emit(e._evt, "move", f, p, e._prev, c);
          unlinkEvent(e, p._evt), linkEvent(e, f, p._evt, c);
        }
        e._temp = null;
      }
    }
    if (p !== owner) f = f.sib || p;
    else if (!sib(f) || !(f = f.sib) || !isUpd(f)){
      popLeader(head);
      if (f = head) owner = f.par;
    }
  }
}

/** FIELD -- Maps every pending tau value to a list of nodes.
    Goal: Efficiently queue nodes such that they coherently relax into their new state.
    Instead of queueing up another async function when a node decides to update,
    we add nodes to a batch and process the entire batch upon relaxation.
      * nodes with pending updates become "excited"
      * during a diff cycle, affected nodes "relax" 
      * nodes of the same frequency "oscillate coherently"
      * coherent nodes relax together unless perturbed beforehand by another update
        * stimulated emission is the analogy here
          * sync diff() is like measuring the node, forcing into its new state
            * when a parent is forced to relax, it "measures" all of its children
            * the children thus also relax, recursively
          * async diff() is like hitting a node with a photon
            * node aborbs the photon, gets excited
            * node emits it when it's time to relax into its new state
            * emission causes other nodes of the same frequency to collapse into their new state */

// remove a node from an oscillator
const relax = (f, tau, t) => {
  if (t = f._top){
    if (t._bot = f._bot) f._bot._top = t;
    else if (t.tau !== tau && t === field.get(t.tau))
      (t.clear || clearTimeout)(t.timer), field.delete(t.tau);
    f._top = f._bot = null;
  }
}
// add/move a node to an oscillator
const excite = (f, tau, cb, t) => {
  relax(f, tau);
  if (t = field.get(tau)){
    if (t._bot) (f._bot = t._bot)._top = f;
  } else {
    field.set(tau, t = {tau});
    t.timer = (cb || setTimeout)(() => {
      while(t = t._bot) pushPath(t);
      sidediff(field.delete(tau));
    }, tau, t);
  }
  (f._top = t)._bot = f;
}

/** SEG-LIST - List structure that stores children nodes under their parents.
    Goals: 
      1. Track standalone children nodes without using an extra pointer
      2. Be able to automatically destroy standalone resources
    Without seg-list:
      Parent -- r1 -- r2 -- r3   red children are standalone, contextual nodes.
        |                        black children are real children.
        b1 -- b2 -- b3           this scheme req a firstBlackChild and firstRedChild pointer.

    With seglist:          
                        Parent   we segregate the black children from the red children.
                          |      this way, we only require a single pointer.
                          |
        r3 -- r2 -- r1 -- b1 -- b2 -- b3   

    We don't implement a new class here, instead we write methods which act on children objects.
    These methods allow adding (linking) and removing (unlinking) colored child nodes from a parent.
    Every node is a parent who has segregated children nodes. */
const linkNodeAfter = (f, s, n=s.sib) =>
  (((f.prev = s).sib = f).sib = n) && (n.prev = f);
const linkNodeBefore = (f, s, n=s.prev) =>
  (((f.sib = s).prev = f).prev = n) && (n.sib = f);
// attach node f into seg-list p after sibling s
const linkNode = (f, p, s=null) => {
  if (!isCtx(f) && s) return linkNodeAfter(f, s);
  if (s = p.next) (isCtx(s) ? linkNodeAfter : linkNodeBefore)(f, s);
  if (!isCtx(f) || !s || isCtx(s)) p.next = f;
}
// detach node f from seg-list p after sibling s
const unlinkNode = (f, p, s=null, n=f.sib) => {
  if (n) n.prev = s;
  if (s) s.sib = n;
  if (f === p.next) p.next = n || s
}

// MUTATIONS
const add = (t, p, s, isRoot, isF, evt) => {
  if (t){
    isF = isFrame(p), evt = isF ? p._evt && p._evt._evt : p, on = LOCK;
    if (!isFn(t.name)) t = new Frame(t, evt);
    else {
      const Sub = t.name;
      if (isFrame(Sub.prototype)) t = new Sub(t, evt);
      else t = new Frame(t, evt), t.render = Sub;
    }
    // step counter
    t._st = 0;
    // phase and in degree counter
    t._ph = IN_PATH | (evt ? HAS_EVT : 0) | (isRoot ? (!isF && IS_CTXL) : IS_CHLD)
    p = t.par = isF ? p : ctx, on = DIFF;
    if (t._evt) sib(t) ? isAdd(p) || queue(t, s, s ? s.sib : sib(p && p.next)) : pushLeader(t);
    p && linkNode(t, p, s);
    isRoot ? lags.push(t) : stx.push(t);
    return t;
  }
}
const move = (f, p, s, ps=sib(f.prev), e=f._evt) => {
  if (e){
    isAdd(p) || dequeue(f, ps);
    if (!isUpd(f)) e._temp = f.temp, f._ph += HAS_EVT;
    isAdd(p) || queue(f, s, s ? s.sib : sib(p && p.next));
  }
  unlinkNode(f, p, f.prev), linkNode(f, p, s);
}
const receive = (f, t, e=f._evt) => {
  if (e && !isUpd(f)){
    sib(f) ? queue(f, sib(f.prev), f.sib) : pushLeader(f)
    e._temp = f.temp, f._ph += HAS_EVT;
  }
  f.temp = t;
}
const remove = (f, p, s, e=f._evt) => {
  if (e) {
    if (!isUpd(f) || e._temp){
      rems.push(f)
      e._temp = e._temp || f.temp;
      if (e._next = sib(f) && p)
        p.temp && unlinkEvent(e, p._evt);
    } else if (f.cleanup) rems.push(f)
    sib(f) ? isAdd(p) || dequeue(f, sib(s)) : isUpd(f) && popLeader(f);
    if (isUpd(f)) f._ph -= HAS_EVT
  } else if (f.cleanup) rems.push(f);
  p && p.temp && unlinkNode(f, p, s);
  if (!inPath(f)) f._ph += IN_PATH
  relax(f, f.temp = f.affs = f._affs = null)
}

/** PATH - A stack of nodes to be diffed.
    Goal: Diff nodes in only a valid topological order.
    The path defines a potential "strike" path of a diff
      * nodes added to the path are candidates for a diff "strike"
      * they do not necessarily get diffed
      * whether or not a node gets diffed is impossible to know before executing the full diff
      * the leader is stored in the "path" stack, "stx" is used as an auxiliary stack
    for stack safety, we acquire overhead trying to simulate recursion's post ordering */
const rebasePath = (f, i, ch) => {
  const walkAffs = i => i.temp ? ch.push(i) : i.unsub(f);
  while(i = stx.length)
    if (inPath(f = stx[i-1])) stx.pop();
    else if (f._st){
      if (i = --f._st) {
        if ((i = f._affs[i-1])._st)
          throw new Error("cycle")
        pushPath(i);
      } else f._ph += IN_PATH, path.push(stx.pop());
    } else {
      if (f._st++, ((i = f.next) && isCh(i)) || f.affs){
        if (ch = f._affs = [], i && isCh(i))
          do ch.push(i); while(i = i.sib);
        if (i = f.affs) i.forEach(walkAffs)
        f._st += ch.length;
      }
    }
}
const pushPath = f => {
  inPath(f) || stx.push(f), f._ph+=ORDER
}

/** DIFF CYCLE
    Preface: 
      Whether you're building a reactive database like Minimongo, something like Meteor's Tracker, 
      an observer framework like MobX, or a view engine like React, you will be dealing with 
      data flow accross dynamic graphs. Relax makes building those types of frameworks easier.

    Concepts: 
      Relax lets you build reactive DAGs of nodes. Nodes are functions (think render function) 
      that take input and return templates. Templates are a static description of what the children 
      of a node should look like (think JSX). Nodes can also be sources of data (think state).

    Updating the graph: 
      The engine gives you tools for scheduling synchronous and batched asynchronous updates (diffs)
      across your graph. Every update triggers a diff cycle. During a diff cycle, render() functions
      are called, and the graph is updated. Synchronous and asynchronous work can be added on-the-fly
      during a diff cycle, and the cycle will be extended (rebased) to reflect that work.

    Sideways out-of-the-box: 
      Higher order function composition (think context) is not the only way to make your components
      depend on data without passing props down a bunch of levels. A better approach might be 
      something like pub/sub, but if implemented naively, pub/sub can lead to lots of repeated work.
      
      This framework takes a different approach to things like createContext or ContextProviders.
      We don't want to have special types of nodes that can inject data into trees, and we don't want
      to fluff our trees up with provider components. Instead, nodes are first class citizens when it
      comes to data flow. Any node can subscribe to any other node's changes. This amounts to creating
      edges in the graph that transcend the implicit tree structure.
      
      You can mount several orthogonal trees and establish dependencies between them via subscriptions. 
      This is referred to as having "sideways" data dependencies. Instead of bringing state "up",
      often the natural thing to do is to bring state "out" or "sideways".

    Diff cycles in depth:
      10,000 foot: 
        A diff cycle is an update cycle where a sequence of render(...) functions are called,
        which produce mutations, which are flushed out to event listeners. 

        When the diff cycle is complete, the graph is in its updated state, and a new diff cycle
        may be executed to repeat this process. Diff cycles can be extended with additional
        synchronous work. The semantics for initializing and extending diff cycles are identical --
        via inner or outer diffs.

      Rebasing:
        Defining diffs during diffs is an essential aspect to this framework.
        The basic idea is that when you call diff inside of a render, we want to seamlessly,
        intuitively queue the work into a diff cycle. If you trigger diffs inside of render,
        they will be rebased synchronously onto the path, extending the current subcycle.
        If you trigger diffs inside of a rendered callback, they will be rebased synchronously,
        but for the next subcycle.

      Advantages of rebasing and scheduling:
        * opt-out of component tree structure
        * create side-effects and other reactive resources without polluting the main app tree
          * e.g. higher order components pollute the main application tree hierarchy
          * this solution naturally allows for "sideways" data storage, dependencies, etc.
        * encompass entire trees within other trees
        * perform imperative, managed diffs for cases where O(N) subdiffing is undesired
        * split state into separate oscillators
        * batch updates with managed diffs (splitting up work over diff cycles)
        * create "portals" so that the application tree can inject components in other places
        * schedule alternative work to override current work
        * schedule work asynchronously in a new diff cycle
        * rebase orthogonal work synchronously into the current diff cycle
        * rebase work synchronously into the current cycle after flushing mutations
      
      Disadvantages of rebasing:
        * it is dangerous if used improperly
        * temporal cycles are not caught by static cycle detection
          * i.e. render loops require exit conditions

      Events:
        Since you are creating a graph that updates over time, you will often want to listen to
        the changes that are happening on the graph. For example, your graph might represent a DOM
        application, and you might want to use the events to update the actual DOM.
        Since work can be redone on-the-fly with rebasing, we need a way of squashing events so we
        don't run into unbounded memory usage. The fiber data structure allows us to do this with
        only O(N) extra memory. At its heart, it's just a doubly linked list. We have to be careful
        that we're merging events properly, because events cannot always be re-ordered.

      Lifecycle methods:
        Often, applications will need to execute code during a render cycle. 
        We want to minimize the number of lifecycle methods, because we want to minimize the number of
        places that user-defined code can run, without taking away power. We need only three methods:
          1. render
          2. rendered (think componentDidMount, componentDidUpdate)
          3. cleanup (think componentDidUnmount)

        We could devise other schemes that let us eliminate rendered and cleanup. 
        For example, we could export a function that lets you queue up a rendered 
        callback that returns a cleanup callback:

          useEffect(() => {
            // do something after flush
            return () => {
              //cleanup this hook's garbage
            }
          })

        but this solution amounts to syntax sugar around the lifecycle methods,
        so it is not implemented at the engine level.

      Automatic cleanup:
        Since this framework gives you the power to execute diffs during diffs
        (e.g. you can mount reactive resources during render), it also conveniently destroys
        those resources up when a node unmounts. The seg-list data structure is a simple
        modification to a doubly linked list that lets us store two-lists-in-one without using an
        extra pointer.

      The Diff Cycle:
        Now that we have sufficient background, let's take a closer look at the diff cycle.
        Every diff cycle starts with a rebase operation (phase A). Rebasing at this point is
        trivial because the path is empty. This is the zero-rebase, the initial filling of the path.
        Subsequent rebases may occur when the path is non-empty (during phases B and/or D), and
        they will properly extend the path with further work.
                  
                go to B if work exists
                  .----<-----<----.
                  |               |
             >--A-->--B-->--C-->--D--> done if work !exists

        Phases:
          A (fill):
            the initial (zero) rebase to fill the path
          B (render):
            exhaust the path; run renders, queue resulting mutations, optionally calling
            rebase any number of times to extend the path (thus extending this phase)
          C (flush):
            emit squashed mutations (e.g. update the DOM)
          D (post-flush):
            call rendered/cleanup lifecycle fns, if any, optionally calling
            rebasing any number of times to extend the diff cycle with another subcycle
            (going back to phase B)

       Another Way of Looking at the Diff Cycle ("unrolled" version):
         Every diff cycle consists of a sequence of synchronous subcycles. 
         Each subcycle is cycle-safe only within itself. Temporal cycles are not caught.

                                time ->
         diff cycle:
           |-fill--subcycle1--subcycle2--subcycle3-...-subcycleN-|
              |
              populate initial path for first subcycle.

           N >= 1
            
         subcycle:
           |-render--flush-|
               |      |  
               |      synchronize effects after all computations finished
               |        * emit ALL removals before ANY adds
               |        * thus effects can recycle resources at a subcycle-level
               |          as opposed to only at the subdiff-level
               run all computations
                 * queue up mounts as laggards
                   thus every new mount is guaranteed to have latest state
                 * rebase work to extend this render phase. */
// unmount queued orphan nodes
const unmount = (f=orph.pop(), isRoot, c, p, s) => {
  while(f){
    p = f.par, s = f.prev;
    if (f.temp){ // entering "recursion"
      if (isRoot && (c = f.affs)) c.forEach(pushPath)
      remove(f, p, s);
      if (c = f.next) while(c.sib) c = c.sib;
      if (c) {
        f = c;
        continue;
      }
    }
    c = !(p && p.temp) && (s || p);
    f.sib = f.par = f.prev = f.next = null;
    f = c || orph.pop();
  }
}
// mount under a node that has no children
const mount = (f, next, c) => {
  while(c = add(next.pop(), f, c));
  while(c = stx.pop()) lags.push(c);
}
// diff "downwards" from a node
const subdiff = (p, c, next, i, n) => {
  if (next.length){
    do (n = popIndex(c.temp)) ?
      n === (n.p = c).temp ? ((c._ph-=ORDER) < ORDER) && (c._ph -= IN_PATH) : receive(c, n) :
      orph.push(c); while(c = c.sib); unmount();
    for(i = p.next; i && (n = next.pop());)
      (c = n.p) ?
        (n.p = null, i === c) ?
          (i = i.sib) :
          move(c, p, sib(i.prev)) :
        add(n, p, sib(i.prev));
    mount(p, next, c), keys = new Map;
  } else {
    do orph.push(c); while(c = c.sib); unmount();
  }
}
// diff "sideways" across the path
const sidediff = (c, raw=rebasePath(on=DIFF)) => {
  do {
    if (ctx = path.pop() || lags.pop()){
      if (!inPath(ctx)) {
        if (c = ctx._affs) {
          for (c of c) ((c._ph-=ORDER) < ORDER) && (c._ph -= IN_PATH);
          ctx._affs = null;
        }
      } else if (c = ctx.temp) {
        relax(ctx);
        ctx._ph &= (ORDER-IN_PATH-1)
        ctx._affs = null;
        raw = ctx.render(c, ctx)
        if (ctx.temp){
          if (ctx.rendered && !(ctx._ph & IN_POST)){
            ctx._ph += IN_POST;
            post.push(ctx);
          }
          sib(c = ctx.next) ?
            isCh(c) && subdiff(ctx, c, clean(raw, 1)) :
            mount(ctx, clean(raw));
        }
      }
    } else {
      on = LOCK, flushEvents(0);
      if (!post.length) return on = IDLE, ctx = null;
      on = DIFF; while(ctx = post.pop()) if (ctx.temp){
        ctx.rendered && ctx.rendered(ctx), ctx._ph -= IN_POST
      }
    }
  } while(1);
}
// public (outer) diff (mount, unmount and update frames)
const diff = (t, f, p=f&&f.prev, s) => {
  let r = false, inDiff = on, context = ctx;
  if (inDiff < 2) try {
    if (!Array.isArray(t = norm(t))){
      if (!isFrame(f) || !f.temp){
        if (t && (!s || s.par === p)) r = add(t, p, sib(s), 1)
      } else if (!isCh(f)){
        if (t && t.name === f.temp.name) {
          if (t !== f.temp) receive(r = f, t, pushPath(f));
          if (sib(f) && isFrame(s = f.par) && (!p || p.par === s)){
            (p = sib(p)) === (s = sib(f.prev)) || move(r = f, f.par, p, s);
          }
        } else if (!t) unmount(f, r = true);
      }
      r && (inDiff ? rebasePath : sidediff)();
    }
  } finally { on = inDiff, ctx = context }
  return r;
}

module.exports = { Frame, diff }
