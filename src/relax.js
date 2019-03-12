/** MINIMUM CONCEPTS -- what do the terms mean?
    If you read the source, you'll see the word "temp", "diff", and "frame" a lot.
    A "temp" is just a static template that describes a tree:

                                        const temp = { name: App,
        const temp = <App>                  next: {
          <p>Hello World</p>    ===         name: "p",
        </App>                              next: "Hello World"
                                          }
                                        }
          (JSX temp)            ===       (literal temp)

    Alone, temps don't do much. They're just literals. As soon as you "diff" a temp,
    it creates a "frame" that is like a live version of your temp:
    
        const frame = diff(temp)

    Frames are nodes in a graph that are connected together to create your app.
    They hold your render functions, state, etc.

    You can update your app (`frame`) with new "arguments" by diffing an updated temp onto it:

        diff(newTemp, frame);

    This "diffs" the target tree described by the `newTemp` onto the existing frame described by
    the old temp. Remember, a temp is just a description of what a frame should look like.
    What if you didn't pass in the old frame?:

        diff(newTemp)

    Then, you'd have a new instance of your app described by the `newTemp`. When you call diff with
    both (temp, frame) arguments, you can think of it as "diffing a temp onto a frame"
    which updates the frame efficiently so that it is consistent with the new temp.

    By now, you've probably guessed how to "unmount" frames (apps):

        diff(null, frame)

    This makes sense, we're instructing the engine to convert our app (`frame`) into
    the zero-frame, the frame described by a void temp. This completely destroys the app.

    Those are the bare minimum concepts you need to get started playing with the framework.

    The "diffs" we've been talking about so far are actually "outer diffs". We are diffing
    temps onto frames (like slapping new props onto a node). There's another type of diff
    called the "inner diff" which is closer to a "setState" (async) or "forceUpdate" (sync).

    So far, we've been diffing in the global context, that is, not inside of a render function
    or a hook. Managed diffs are diffs that are executed during an existing diff cycle and they
    allow you to rebase work onto the current diff cycle. */

/** META -- about the file structure
    You might be wondering why all of this code is in a single file. I, too, wonder this.
    Webpack probably does something like:
      1. Figure out the files used in an app by walking import/export links from an entry point.
      2. Wrap each file's code in a closure and expose an interface so that
         * files' variables are in their own scope/namespace
           so they don't interfere with other files' variables
         * other files can access the files' contents via an interface
      3. Link together the closures and execute them in a correct order.
    The problem with this is that it introduces boilerplate code that scales with
    the internal interface of your project.
    I didn't know rollup existed (which uses a flatten & reconcile strategy), which
    makes this a non-issue. I ended up just putting everything into a single file to
    avoid webpack's overhead. In the future, I may refactor these into their own files. */

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
      1. We mustn't set state into a coerced 32 bit:
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

// util functions
// query bitmasks (is the frame...)
const isCtx = frame => frame._ph & IS_CTXL; // ...a contextual root?
const isCh = frame => frame._ph & IS_CHLD; // ...a child?
const inPath = frame => frame._ph & IN_PATH; // ...in the diff path?
const isUpd = frame => frame._ph & HAS_EVT; // ...carrying an update?

const isFn = frame => typeof frame === "function";
// normalize a temp (nully and booleans are void templates and are ignored)
const norm = temp => temp != null && temp !== true && temp !== false && 
  (typeof temp === "object" ? temp : {name: null, data: String(temp)});
const isFrame = frame => frame && isFn(frame.render);
// does the frame have an update and is it mounting for the first time?
const isAdd = frame => frame && isUpd(frame) && !frame._evt._temp;
// convert a frame to a black (real) child, or null if red (contextual root)
const sib = frame => frame && !isCtx(frame) ? frame : null;

// aux data structures
const laggards = [],
  orphans = [],
  removals = [],
  stack = [],
  path = [],
  afterFlush = [],
  field = new Map;

// flatten and sanitize a frame's next children
//   * optionally index the nodes' implicit/explicit keys
//   * pass index here as opposed to referring to global since we don't always index
//   * we also reuse `raw` here for brevity
//   * for (k of k) caches the ref to k, then reuses it as an iter var
const clean = (raw, index, next=[]) => {
  stack.push(raw);
  while(stack.length) if (raw = norm(stack.pop()))
    if (Array.isArray(raw)) for (raw of raw) stack.push(raw);
    else next.push(raw), index && pushIndex(raw)
  return next
}
// emit mutation event to plugins
const emit = (evt, type, frame, par, nextPrevSib, prevSib) => {
  if (Array.isArray(evt)) for (evt of evt)
    evt[type] && evt[type](frame, par, nextPrevSib, prevSib);
  else evt[type] && evt[type](frame, par, nextPrevSib, prevSib);   
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
  sub(affectorFrame){
    isFrame(affectorFrame) &&
    affectorFrame !== this &&
    (affectorFrame.affs = affectorFrame.affs || new Set).add(this);
  },
  unsub(affectorFrame){
    isFrame(affectorFrame) &&
    affectorFrame.affs &&
    affectorFrame.affs.delete(this) &&
    (affectorFrame.affs.size || (affectorFrame.affs = null));
  },
  // instance (inner) diff (schedule updates for frames)
  diff(tau=-1){
    return diffState < LOCK && !!this.temp &&
      !(!isFn(tau) && tau < 0 ?
        (diffState ? rebasePath : sidediff)(pushPath(this)) :
        excite(this, tau))
  }
}

let firstLeader, lastLeader, diffState = IDLE, context = null, keys = new Map;

/** KEY INDEXER
    * indexes explicit and implicit keys in LIFO order
    * `key` refers to a cache field, not necessarily a JSX (template) "key".
    * e.g. the name of your component (div, App) is essentially an implicit key. */
const pushIndex = (temp, cache, key) => {
  (cache = keys.get(key = temp.name)) || keys.set(key, cache = {});
  (key = temp.key) ?
    ((cache = cache.exp = cache.exp || {})[key] = temp) :
    (cache.imp = cache.imp || []).push(temp);
}
const popIndex = (temp, cache, key) =>
  (cache = keys.get(temp.name)) &&
    ((key = temp.key) ?
      ((cache = cache.exp) && (temp = cache[key])) && (cache[key] = null, temp) :
      (cache=cache.imp) && cache.pop())

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
const pushLeader = frame => {
  if (!firstLeader)
    firstLeader = lastLeader = frame;
  else {
    (lastLeader._evt._top = frame)._evt._bot = lastLeader;
    lastLeader = frame;
  }
}
// remove leader node from fiber
const popLeader = (
  oldLeader,
  newLeader,
  event=oldLeader._evt,
  prevLeader=event._bot,
  nextLeader=event._top
) => {
  if (newLeader ? (newLeader._evt._bot = prevLeader) : prevLeader)
    prevLeader._evt._top = newLeader || nextLeader, event._bot = null;
  else firstLeader = newLeader || nextLeader;
  if (newLeader ? (newLeader._evt._top = nextLeader) : nextLeader)
    nextLeader._evt._bot = newLeader || prevLeader, event._top = null;
  else lastLeader = newLeader || prevLeader;
}
const queue = (frame, prevSib, nextSib) => {
  if (!prevSib || !isUpd(prevSib)){
    if (!nextSib || !isUpd(nextSib)) pushLeader(frame);
    else popLeader(nextSib, frame);
  }
}
const dequeue = (frame, prevSib, nextSib=frame.sib) => {
  if (isUpd(frame)){
    if (!prevSib || !isUpd(prevSib))
      popLeader(frame, nextSib && isUpd(nextSib) && nextSib)
  } else if (prevSib && isUpd(prevSib) && nextSib && isUpd(nextSib))
      popLeader(nextSib);
}
// detach event f after sibling s
const unlinkEvent = (event, parEvent, prevSib=event._prev, nextSib) => {
  (nextSib = event._sib) && (nextSib._evt._prev = prevSib);
  prevSib ? (prevSib._evt._sib = nextSib) : (parEvent._next = nextSib);
}
// attach event f after sibling s
const linkEvent = (event, frame, parEvent, prevSib, nextSib) => {
  (nextSib = event._sib =
    (event._prev = prevSib) ?
      prevSib._evt._sib :
      parEvent._next
  ) && (nextSib._evt._prev = frame);
  prevSib ? (prevSib._evt._sib = frame) : (parEvent._next = frame)
}
// empties the fiber, emitting the queued events
const flushEvents = (c, frame, event, parent, owner) => {
  if (removals.length) {
    while(frame = removals[c++]){
      frame.cleanup && frame.cleanup(frame);
      if (event = frame._evt) emit(
        event._evt,
        "remove",
        frame, event._next, event._prev, event._temp, frame._evt = null
      );
    }
    removals.length = 0;
  }
  if (!(frame = firstLeader)) return;
  owner = frame.par;
  while(frame) {
    parent = frame.par;
    if (isUpd(frame)){
      frame._ph -= HAS_EVT, event = frame._evt;
      if (!event._temp){
        c = sib(frame);
        emit(event._evt, "add", frame, c && parent, c && frame.prev, frame.temp);
        if (c && parent) linkEvent(event, frame, parent._evt, sib(frame.prev));
        if (sib(frame.next)){
          frame = frame.next;
          continue;
        }
      } else {
        if (frame.temp !== event._temp)
          emit(event._evt, "temp", frame, frame.temp, event._temp);
        if ((c = sib(frame.prev)) !== event._prev){
          emit(event._evt, "move", frame, parent, event._prev, c);
          unlinkEvent(event, parent._evt);
          linkEvent(event, frame, parent._evt, c);
        }
        event._temp = null;
      }
    }
    if (parent !== owner) frame = frame.sib || parent;
    else if (!sib(frame) || !(frame = frame.sib) || !isUpd(frame)){
      popLeader(firstLeader);
      if (frame = firstLeader) owner = frame.par;
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
const relax = (frame, tau, prevFrame) => {
  if (prevFrame = frame._top){
    if (prevFrame._bot = frame._bot)
      frame._bot._top = prevFrame;
    else if (prevFrame.tau !== tau && prevFrame === field.get(prevFrame.tau)){
      (prevFrame.clear || clearTimeout)(prevFrame.timer);
      field.delete(prevFrame.tau);
    }
    frame._top = frame._bot = null;
  }
}
// add/move a node to an oscillator
const excite = (frame, tau, fieldHead) => {
  relax(frame, tau);
  if (fieldHead = field.get(tau)){
    if (fieldHead._bot)
      (frame._bot = fieldHead._bot)._top = frame;
  } else {
    field.set(tau, fieldHead = {tau});
    fieldHead.timer = (isFn(tau) ? tau : setTimeout)(() => {
      while(fieldHead = fieldHead._bot)
        pushPath(fieldHead);
      sidediff(field.delete(tau));
    }, tau, fieldHead);
  }
  (frame._top = fieldHead)._bot = frame;
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
const linkNodeAfter = (frame, prevSib, nextSib=prevSib.sib) =>
  (((frame.prev = prevSib).sib = frame).sib = nextSib) &&
  (nextSib.prev = frame);
const linkNodeBefore = (frame, nextSib, prevSib=nextSib.prev) =>
  (((frame.sib = nextSib).prev = frame).prev = prevSib) &&
  (prevSib.sib = frame);
// attach frame into seg-list after prevSib
const linkNode = (frame, parent, prevSib=null) => {
  if (!isCtx(frame) && prevSib)
    return linkNodeAfter(frame, prevSib);
  if (prevSib = parent.next)
    (isCtx(prevSib) ? linkNodeAfter : linkNodeBefore)(frame, prevSib);
  if (!isCtx(frame) || !prevSib || isCtx(prevSib))
    parent.next = frame;
}
// detach frame from seg-list after prevSib
const unlinkNode = (frame, parent, prevSib=null, nextSib=frame.sib) => {
  if (nextSib) nextSib.prev = prevSib;
  if (prevSib) prevSib.sib = nextSib;
  if (frame === parent.next)
    parent.next = nextSib || prevSib;
}

// MUTATIONS
const add = (temp, parent, prevSib, isRoot, isF, evt) => {
  if (temp){
    isF = isFrame(parent);
    evt = isF ? parent._evt && parent._evt._evt : parent, diffState = LOCK;
    if (!isFn(temp.name))
      temp = new Frame(temp, evt);
    else {
      const Sub = temp.name;
      if (isFrame(Sub.prototype))
        temp = new Sub(temp, evt);
      else {
        temp = new Frame(temp, evt)
        temp.render = Sub;
      }
    }
    // step counter
    temp._st = 0;
    // phase and in degree counter
    temp._ph = IN_PATH |
      (evt ? HAS_EVT : 0) |
      (isRoot ? (!isF && IS_CTXL) : IS_CHLD)
    parent = temp.par = isF ? parent : context, diffState = DIFF;
    if (temp._evt) sib(temp) ?
      isAdd(parent) || queue(temp, prevSib, prevSib ?
        prevSib.sib :
        sib(parent && parent.next)
      ) :
      pushLeader(temp);
    parent && linkNode(temp, parent, prevSib);
    isRoot ? laggards.push(temp) : stack.push(temp);
    return temp;
  }
}
const move = (frame, parent, nextPrevSib, prevSib=sib(frame.prev), event=frame._evt) => {
  if (event){
    isAdd(parent) || dequeue(frame, prevSib);
    if (!isUpd(frame))
      event._temp = frame.temp, frame._ph += HAS_EVT;
    isAdd(parent) || queue(frame, nextPrevSib, nextPrevSib ?
      nextPrevSib.sib :
      sib(parent && parent.next)
    );
  }
  unlinkNode(frame, parent, frame.prev);
  linkNode(frame, parent, nextPrevSib);
}
const receive = (frame, nextTemp, event=frame._evt) => {
  if (event && !isUpd(frame)){
    sib(frame) ?
      queue(frame, sib(frame.prev), frame.sib) :
      pushLeader(frame)
    event._temp = frame.temp;
    frame._ph += HAS_EVT;
  }
  frame.temp = nextTemp;
}
const remove = (frame, parent, prevSib, event=frame._evt) => {
  if (event) {
    if (!isUpd(frame) || event._temp){
      removals.push(frame)
      event._temp = event._temp || frame.temp;
      if (event._next = sib(frame) && parent)
        parent.temp && unlinkEvent(event, parent._evt);
    } else if (frame.cleanup) removals.push(frame)
    sib(frame) ?
      isAdd(parent) || dequeue(frame, sib(prevSib)) :
      isUpd(frame) && popLeader(frame);
    if (isUpd(frame)) frame._ph -= HAS_EVT
  } else if (frame.cleanup) removals.push(frame);
  parent && parent.temp && unlinkNode(frame, parent, prevSib);
  if (!inPath(frame)) frame._ph += IN_PATH
  relax(frame, frame.temp = frame.affs = frame._affs = null)
}

/** PATH - A stack of nodes to be diffed.
    Goal: Diff nodes in only a valid topological order.
    The path defines a potential "strike" path of a diff
      * nodes added to the path are candidates for a diff "strike"
      * they do not necessarily get diffed
      * whether or not a node gets diffed is impossible to know before executing the full diff
      * the leader is stored in the "path" stack, "stack" is used as an auxiliary stack
    for stack safety, we acquire overhead trying to simulate recursion's afterFlush ordering */
const rebasePath = (frame, i, ch) => {
  const walkAffs = affect => affect.temp ?
    ch.push(affect) :
    affect.unsub(frame);
  while(i = stack.length)
    if (inPath(frame = stack[i-1])) stack.pop();
    else if (frame._st){
      if (i = --frame._st) {
        if ((i = frame._affs[i-1])._st)
          throw new Error("cycle")
        pushPath(i);
      } else frame._ph += IN_PATH, path.push(stack.pop());
    } else {
      if (frame._st++, ((i = frame.next) && isCh(i)) || frame.affs){
        if (ch = frame._affs = [], i && isCh(i))
          do ch.push(i); while(i = i.sib);
        if (i = frame.affs) i.forEach(walkAffs)
        frame._st += ch.length;
      }
    }
}
const pushPath = frame => {
  inPath(frame) || stack.push(frame);
  frame._ph+=ORDER;
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
      comes to data flow. Any node can subscribe to any other node's changes.
      This amounts to creating edges in the graph that transcend the implicit tree structure.
      
      You can mount several orthogonal trees and establish dependencies between them
      via subscriptions. This is referred to as having "sideways" data dependencies. 
      Instead of bringing state "up", often the natural thing to do is to bring it "out"/"sideways".

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
        We want to minimize the number of lifecycle methods, because we want to minimize
        the number of places that user-defined code can run, without taking away power. 
        We need only three methods:
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
          D (afterFlush-flush):
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
const unmount = (frame=orphans.pop(), isRoot, child, parent, prevSib) => {
  while(frame){
    parent = frame.par, prevSib = frame.prev;
    if (frame.temp){ // entering "recursion"
      if (isRoot && (child = frame.affs))
        child.forEach(pushPath)
      remove(frame, parent, prevSib);
      if (child = frame.next)
        while(child.sib) child = child.sib;
      if (child) {
        frame = child;
        continue;
      }
    }
    child = !(parent && parent.temp) && (prevSib || parent);
    frame.sib = frame.par = frame.prev = frame.next = null;
    frame = child || orphans.pop();
  }
}
// mount under a node that has no children
const mount = (parent, nextChildren, child) => {
  while(child = add(nextChildren.pop(), parent, child));
  while(child = stack.pop())
    laggards.push(child);
}
// diff "downwards" from a node
const subdiff = (parent, child, nextChildren, curChild, nextTemp) => {
  if (nextChildren.length){
    do (nextTemp = popIndex(child.temp)) ?
      nextTemp === (nextTemp.p = child).temp ?
        ((child._ph-=ORDER) < ORDER) && (child._ph -= IN_PATH) :
        receive(child, nextTemp) :
      orphans.push(child);
    while(child = child.sib);
    unmount();
    for(curChild = parent.next; curChild && (nextTemp = nextChildren.pop());)
      (child = nextTemp.p) ?
        (nextTemp.p = null, curChild === child) ?
          (curChild = curChild.sib) :
          move(child, parent, sib(curChild.prev)) :
        add(nextTemp, parent, sib(curChild.prev));
    mount(parent, nextChildren, child);
    keys = new Map;
  } else {
    do orphans.push(child);
    while(child = child.sib);
    unmount();
  }
}
// diff "sideways" across the path
const sidediff = (c, raw=rebasePath(diffState=DIFF)) => {
  do {
    if (context = path.pop() || laggards.pop()){
      if (!inPath(context)) {
        if (c = context._affs) {
          for (c of c) ((c._ph-=ORDER) < ORDER) && (c._ph -= IN_PATH);
          context._affs = null;
        }
      } else if (c = context.temp) {
        relax(context);
        context._ph &= (ORDER-IN_PATH-1)
        context._affs = null;
        raw = context.render(c, context)
        if (context.temp){
          if (context.rendered && !(context._ph & IN_POST)){
            context._ph += IN_POST;
            afterFlush.push(context);
          }
          sib(c = context.next) ?
            isCh(c) && subdiff(context, c, clean(raw, 1)) :
            mount(context, clean(raw));
        }
      }
    } else {
      diffState = LOCK, flushEvents(0);
      if (!afterFlush.length)
        return diffState = IDLE, context = null;
      diffState = DIFF;
      while(context = afterFlush.pop()) if (context.temp){
        context.rendered && context.rendered(context), context._ph -= IN_POST
      }
    }
  } while(1);
}
/** Outer-diff (mount, unmount and update frames)
    Mounting:
      diff(temp)                     (mount temp)
      diff(temp, null, plugins)      (mount temp with plugins)
      diff(temp, null, parent)*      (mount temp under parent as a managed root)
      diff(temp, null, parent, sib)* (mount temp under parent after sib as managed root)
    Unmounting:
      diff(null, frame)              (unmount (managed) frame)
    Updating:
      diff(temp, frame)              (update (managed) frame with new temp)
      diff(temp, frame, sib)         (update managed frame with new temp and move after sib) 

    * managed roots inherit parents' plugins */
const diff = (temp, frame, parent=frame&&frame.prev, prevSib) => {
  let r = false, prevDiffState = diffState, prevContext = context;
  if (prevDiffState < LOCK) try {
    if (!Array.isArray(temp = norm(temp))){
      if (!isFrame(frame) || !frame.temp){
        if (temp && (!prevSib || prevSib.par === parent))
          r = add(temp, parent, sib(prevSib), 1);
      } else if (!isCh(frame)){
        if (temp && temp.name === frame.temp.name) {
          if (temp !== frame.temp)
            receive(r = frame, temp, pushPath(frame));
          if (sib(frame) && isFrame(prevSib = frame.par) &&
            (!parent || parent.par === prevSib)){
            (parent = sib(parent)) === (prevSib = sib(frame.prev)) ||
            move(r = frame, frame.par, parent, prevSib);
          }
        } else if (!temp) unmount(frame, r = true);
      }
      r && (prevDiffState ? rebasePath : sidediff)();
    }
  } finally {
    diffState = prevDiffState;
    context = prevContext
  }
  return r;
}

module.exports = { Frame, diff }
