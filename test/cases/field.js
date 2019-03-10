const { bellListPerms, findLeaves, VectorEnumerator } = require("./combinatorics");

// interpolate n evenly spaced points in (0, max], with max being the highest value
const posInterp = (max, n) => Array(n).fill().map((p, i) => max*(i+1)/n);

/* Generates all degenerate frequency microstates for given degenerate frequencies.
   Supply a list of ids (e.g. ["f1", "f2"]) and the max value (e.g. 1000)
   The result will be:
     [
       {f1: 500, f2: 1000}, // f1 < f2
       {f1: 1000, f2: 500}, // f1 > f2
       {f1: 1000, f2: 1000} // f1 == f2
     ] */
const getDegenerateMicrostates = (ids, max) => {
  return bellListPerms(ids).map(partition => {
    const interpolatedFrequencies = posInterp(max, partition.length)
    return partition.reduce((p, c, i) => {
      c.forEach(f => p[f] = interpolatedFrequencies[i]);
      return p;
    }, {})
  })
}

/* Generates all non-degenerate frequency microstates.
   Supply a list of ids (e.g. ["f1", "f2"]) and all possible values (e.g. [-1, 0])
   The result will be:
     [
       {f1: -1, f2: 0},
       {f1: 0, f2: -1},
       {f1: 0, f2: 0},
       {f1: -1, f2: -1}
     ] */
const getMacrostates = (ids, possibleValues) => {
  const enumerateValues = VectorEnumerator(possibleValues);
  return findLeaves(enumerateValues(ids.length)).map(vector => {
    return ids.reduce((p, c, i) => {
      p[c] = Number(vector[i]);
      return p;
    }, {})
  })
}

// generate macrostates, then "expand" all of the degenerate states into each of their microstates 
// a degenerate state is one with at least two values which are greater than zero
// because those values interact according to their relative magnitude.
// note, it is expected that only one possibleValue is greater than zero, but this is internal code so...
const getMicrostates = (ids, possibleValues) => {
  const microstates = [], max = Math.max(...possibleValues);
  getMacrostates(ids, possibleValues).forEach(state => {
    const nonzeros = [];
    for (let k in state) if (state[k] > 0) nonzeros.push(k);
    if (nonzeros.length < 2) microstates.push(state); // already a microstate, don't expand
    else microstates.push(...getDegenerateMicrostates(nonzeros, max).map(micro => {
      return Object.assign({}, state, micro);
    }))
  })
  return microstates;
}

/* based on context, p and c refer, respectively, to either:
     1. the parent and child tau
     2. the parent and child

  Derive all possible fundamental states for two-node system: 
    1. both p and c live in {-1, 0, f}
    2. thus p x c lives in {(-1,-1), (-1,0), (-1,f), (0,-1), (0,0), (0,f), (f,-1), (f, 0), (f, f)}
    3. however (f, f) is a degenerate macrostate, containing: (f1, f2), (f2, f1) and (f1, f1), where f1 > f2
    4. thus a two-node system, p x c, has 9 + 2 = 11 total states
  For a three-node system, (f, f, f) has 13 degenerate states, for a four-node system, it has 75, and so on.
  For a N-node system, any state involving more than 2 positive frequencies is degenerate.
  These numbers (3, 11, 75, ...) are actually closely related to the Bell numbers (2, 5, 15, ...).
  We will use the Bell numbers to automatically generate degenerate microstates for a given macrostate

  visualizing the phase space for p and c, the interesting stuff happens in positive Q1

  Before splitting degenerate state A, there are 9 important regions:
          c (time)
          ^
          |
      C   H   A   
          |
  ----F---E---I----> p (time)
          |
      B   G   D
          |

  After splitting degenerate state A, there are 11 regions:
          c
          ^         (dotted line: p = c)
          | A2   ,'
      C   H   A1
          |,'   A3
  ----F---E---I----> p
          |
      B   G   D
          |

  0 A1: line of coherent relaxation
  1 A2: parent relaxes faster than child
  2 A3: parent relaxes slower than child
  3 B: region of no relaxation
  4 C: only child relaxes
  5 D: only parent relaxes 
  6 E: parent and child async immediate
  7 F: parent sync, child async immediate
  8 G: parent async immediate, child sync
  9 H: parent async immediate, child async
  10 I: parent async, child async immediate 

  ASIDE: There is a distinction between "async immediate" and "async" because there are two ways to schedule
    async work: microtask queue and macrotask queue. Before, inner diffs were limited to using timeouts
    and would automatically turn tau === 0 inner diffs into microtasks. This behavior is oddly specific.
    It makes more sense for the relaxation strategy to be functional, so that the application has the power
    to specify exactly how a batch is triggered:
      * node.diff(Number > 0) uses timeouts, as before.
      * node.diff(0) uses timeouts instead of resolved promises (asap).
      * node.diff() defaults to node.diff(-1) which is synchronous, as before.
      * now, to batch diffs into the a microtask, you would use node.diff(asap)
      * now, you can do stuff like node.diff(rAF)

  Our test system is comprised of 2 nodes and 1-2 photons (updates); the nodes alone comprise a two-node system. 
  When photons hit the nodes, the nodes move from one of the above 11 phases into any other one.
  This means there are 121 possible transitions. */


// XXX these states are not necessarily in the same order as the above diagram, fix later
// const states = [
//   {phase: "p = c > 0"},     // 0
//   {phase: "p < c"},         // 1
//   {phase: "p > c"},         // 2
//   {phase: "p < 0, c > 0"},  // 3
//   {phase: "p > 0, c < 0"},  // 4
//   {phase: "p = c < 0"},     // 5
//   {phase: "p = c = 0"},     // 6
//   {phase: "p < 0, c = 0"},  // 7
//   {phase: "p = 0, c < 0"},  // 8
//   {phase: "p > 0, c = 0"},  // 9
//   {phase: "p = 0, c > 0"}   // 10
// ]
// const trans = (p, c) => [
// //       <-- final state -->
// // 0  1  2  3  4  5  6  7  8  9  10
//   [0, 1, 1, p, c, 0, 0, 0, 0, c, p], // 0
//   [1, 0, 1, p, c, 0, 0, 0, 0, c, p], // 1
//   [1, 1, 0, p, c, 0, 0, 0, 0, c, p], // 2        ^
//   [p, p, p, 0, 0, c, 0, 0, 0, c, p], // 3        |
//   [c, c, c, 0, 0, p, 0, 0, p, c, 0], // 4        .
//   [0, 0, 0, c, p, 0, 0, 0, p, c, 0], // 5 initial state
//   [0, 0, 0, 0, 0, 0, 0, p, c, p, c], // 6        '
//   [0, 0, 0, c, 0, c, p, 0, 0, p, 0], // 7        |
//   [0, 0, 0, 0, p, p, c, 0, 0, 0, c], // 8        v
//   [c, c, c, 0, c, 0, p, p, 0, 0, 0], // 9
//   [p, p, p, p, 0, 0, c, 0, c, 0, 0]  // 10
// ]

// TODO: use a transition matrix instead of this hideous garbage.
const getExpectedResult = ({ tau_gp, tau_gc, tau_p, tau_c }, { isChild, isEntangled }) => {
  let desc = [], events = [];
  const finalState = {n: 1}, initialState = {n: 0}
  if (tau_gp != null && tau_gc != null){ // two photons
    if (tau_gp < 0 && tau_gc < 0){ // both sync
      let msg = "immediately update p"
      events.push({wU: 0, dt: tau_gp, state: finalState});
      if (isChild || isEntangled){
        msg += " and c"
        events.push({wU: 1, dt: tau_gp, state: tau_c < 0 ? null : initialState});
        isChild && events.push({wR: 1, dt: tau_gp, state: tau_c < 0 ? null : initialState});
      }
      desc.push(msg)
      desc.push("immediately update c");
      events.push({wU: 1, dt: tau_gc, state: finalState});
    } else if (tau_gp < 0){ // parent sync
      let msg = "immediately update p"
      events.push({wU: 0, dt: tau_gp, state: finalState});
      if (isChild || isEntangled){
        msg += " and c"
        events.push({wU: 1, dt: tau_gp, state: tau_c < 0 ? null : initialState});
        isChild && events.push({wR: 1, dt: tau_gp, state: tau_c < 0 ? null : initialState});
      }
      desc.push(msg)
      desc.push("wait tau_gc then update c");
      events.push({wU: 1, dt: tau_gc, state: finalState});
    } else if (tau_gc < 0){ // child sync
      desc.push("immediately update c");
      events.push({wU: 1, dt: tau_gc, state: finalState});
      let msg = "wait tau_gp then update p"
      events.push({wU: 0, dt: tau_gp, state: finalState});
      if (isChild || isEntangled){
        msg += " and c"
        events.push({wU: 1, dt: tau_gp, state: finalState});
        isChild && events.push({wR: 1, dt: tau_gp, state: finalState});
      }
      desc.push(msg)
    } else { // both async
      if (tau_gc === tau_gp){ // parent and child are coherent
        if (!isChild && !isEntangled){
          desc.push("wait tau_gc then update c and p");
          events.push({wU: 1, dt: tau_gc, state: finalState});
          events.push({wU: 0, dt: tau_gc, state: finalState});
        } else {
          let msg = `wait tau_gp then update p and c`;
          events.push({wU: 0, dt: tau_gp, state: finalState});
          events.push({wU: 1, dt: tau_gp, state: finalState});
          isChild && events.push({wR: 1, dt: tau_gp, state: finalState});
          desc.push(msg)
        }
      } else if (tau_gc < tau_gp){ // child relaxes faster
        desc.push("wait tau_gc then update c");
        events.push({wU: 1, dt: tau_gc, state: finalState});
        let msg = "wait the remainder of tau_gp-tau_gc then update p"
        events.push({wU: 0, dt: tau_gp, state: finalState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_gp, state: finalState});
          isChild && events.push({wR: 1, dt: tau_gp, state: finalState});
        }
        desc.push(msg)
      } else { // parent relaxes faster
        let msg = "wait tau_gp then update p"
        events.push({wU: 0, dt: tau_gp, state: finalState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_gp, state: finalState});
          isChild && events.push({wR: 1, dt: tau_gp, state: finalState});
        }
        desc.push(msg)
        if (!isChild && !isEntangled){
          desc.push("wait the remainder of tau_gc-tau_gp then update c");
          events.push({wU: 1, dt: tau_gc, state: finalState});
        }
      }
    }
  } else if (tau_gp != null){ // parent photon
    if (tau_gp < 0) { // sync
      let msg = "immediately update p"
      events.push({wU: 0, dt: tau_gp, state: finalState});
      if (isChild || isEntangled){
        msg += " and c"
        events.push({wU: 1, dt: tau_gp, state: tau_c < 0 ? null : initialState});
        isChild && events.push({wR: 1, dt: tau_gp, state: tau_c < 0 ? null : initialState});
      }
      desc.push(msg)
      if (tau_c >= 0 && !isChild && !isEntangled){ // child was oscillating and is not downstream
        desc.push("wait tau_c then update c");
        events.push({wU: 1, dt: tau_c, state: initialState});
      }
    } else { // async
      if (tau_c < 0){ // child wasn't oscillating
        let msg = "wait tau_gp then update p"
        events.push({wU: 0, dt: tau_gp, state: finalState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_gp, state: null});
          isChild && events.push({wR: 1, dt: tau_gp, state: null});
        }
        desc.push(msg)
      } else if (tau_c < tau_gp){ // child relaxes faster
        desc.push("wait tau_c then update c");
        events.push({wU: 1, dt: tau_c, state: initialState});
        let msg = "wait the remainder of tau_gp-tau_c then update p"
        events.push({wU: 0, dt: tau_gp, state: finalState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_gp, state: initialState});
          isChild && events.push({wR: 1, dt: tau_gp, state: initialState});
        }
        desc.push(msg)
      } else if (tau_c === tau_gp){ // parent and child are coherent
        desc.push("wait tau_c then update p and c");
        events.push({wU: 0, dt: tau_c, state: finalState});
        events.push({wU: 1, dt: tau_c, state: initialState});
        isChild && events.push({wR: 1, dt: tau_c, state: initialState});
      } else { // parent relaxes faster
        let msg = "wait tau_gp then update p"
        events.push({wU: 0, dt: tau_gp, state: finalState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_gp, state: initialState});
          isChild && events.push({wR: 1, dt: tau_gp, state: initialState});
        }
        desc.push(msg)
        if (!isChild && !isEntangled){
          desc.push("wait the remainder of tau_gp-tau_c then update c");
          events.push({wU: 1, dt: tau_c, state: initialState});
        }
      }
    }
  } else { // child photon
    if (tau_gc < 0) { // sync
      desc.push("immediately update c")
      events.push({wU: 1, dt: tau_gc, state: finalState});
      if (tau_p >= 0) { // parent was oscillating
        let msg = "wait tau_p then update p";
        events.push({wU: 0, dt: tau_p, state: initialState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_p, state: finalState});
          isChild && events.push({wR: 1, dt: tau_p, state: finalState});
        }
        desc.push(msg)
      }
    } else { // async
      if (tau_p < 0){ // paren't wasnt oscillating
        desc.push("wait tau_gc then update c");
        events.push({wU: 1, dt: tau_gc, state: finalState});
      } else if (tau_p < tau_gc){ // parent relaxes faster
        let msg = `wait tau_p then update p`;
        events.push({wU: 0, dt: tau_p, state: initialState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_p, state: finalState});
          isChild && events.push({wR: 1, dt: tau_p, state: finalState});
        }
        desc.push(msg)
        if (!isChild && !isEntangled){
          desc.push("wait the remainder of tau_gc-tau_p then update c");
          events.push({wU: 1, dt: tau_gc, state: finalState});
        }
      } else if (tau_p === tau_gc) { // parent and child are coherent
        if (!isChild && !isEntangled){
          desc.push("wait tau_p then update c and p");
          events.push({wU: 1, dt: tau_p, state: finalState});
          events.push({wU: 0, dt: tau_p, state: initialState});
        } else {
          let msg = `wait tau_p then update p and c`;
          events.push({wU: 0, dt: tau_p, state: initialState});
          events.push({wU: 1, dt: tau_p, state: finalState});
          isChild && events.push({wR: 1, dt: tau_p, state: finalState});
          desc.push(msg)
        }
      } else { // child relaxes faster
        desc.push("wait tau_gc then update c");
        events.push({wU: 1, dt: tau_gc, state: finalState});
        let msg = `wait the remainder of tau_p-tau_gc then update p`;
        events.push({wU: 0, dt: tau_p, state: initialState});
        if (isChild || isEntangled){
          msg += " and c"
          events.push({wU: 1, dt: tau_p, state: finalState});
          isChild && events.push({wR: 1, dt: tau_p, state: finalState});
        }
        desc.push(msg)
      }
    }
  }
  return {
    events,
    desc: desc.join(", then ")
  }
}

module.exports = { getMicrostates, getExpectedResult }