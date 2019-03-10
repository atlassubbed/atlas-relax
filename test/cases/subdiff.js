const { copy } = require("../util");
const { B } = require("./Frames");
const { findAll, genPermGraph } = require("./combinatorics");

/* Properties of subdiffs (arrays -> arrays):
     1. should be stable for implicit keys
     2. should be stable for explicit keys
     3. should produce a correct edit path in linear time */

// maps our sequences to our (transformed) test cases
const mapToBasis = (seqs, S) => seqs.map(s => s.map(el => copy(S[el])));

// "generating" sets, factorial growth; infeasible for N > 5
// prev and next refer to subdiff's prev and next children, respectively
const bruteForceCases = [
  [ // implicit basis
    {name: "a", data: {id: 1}},
    {name: "a", data: {id: 2}},
    {name: B, data: {id: 3}},
    {name: B, data: {id: 4}}
  ],
  [ // explicit basis
    {name: "a", key: "k1", data: {id: 1}},
    {name: "a", key: "k1", data: {id: 2}},
    {name: B, key: "k1", data: {id: 3}},
    {name: B, key: "k2", data: {id: 4}}
  ],
  [ // mixed basis
    {name: "a", key: "k1", data: {id: 1}},
    {name: "a", data: {id: 2}},
    {name: B, key: "k2", data: {id: 3}},
    {name: B, data: {id: 4}}
  ]
].map(genSet => {
  const seqs = findAll(genPermGraph(genSet.map((e, i) => i)));
  return {
    prevCases: mapToBasis(seqs, genSet),
    nextCases: mapToBasis(seqs, genSet)
  }
})

// matching cases, makePrev returns a new prev array
// makeNext* uses that as a basis for creating the next array
const makeNextSame = makePrev => {
  const next = makePrev();
  // add some holes to lower the density
  next[0] = false, next[2] = null, next[next.length-1] = true, next[5] = undefined;
  return next;
}
const makeNextLess = makePrev => {
  const next = makeNextSame(makePrev);
  let rem = 3;
  while(rem--)next.pop();
  return next;
}
const makeNextMore = makePrev => {
  const next = makeNextSame(makePrev);
  let add = 5;
  while(add--)next.push({name: "c"});
  return next;
}

// for each of these conditions, nodes should get matched properly 
// to their implicit or explicit keyed nodes in prev
const matchingCases = [
  {condition: "|next| === |prev|", makeNext: makeNextSame},
  {condition: "|next| > |prev|", makeNext: makeNextMore},
  {condition: "|next| < |prev|", makeNext: makeNextLess}
]

module.exports = { bruteForceCases, matchingCases }
