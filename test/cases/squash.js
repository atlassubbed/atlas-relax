const { copy } = require("../util");
const { findAll, genPermGraph } = require("./combinatorics");

/* Properties of event squashing:
     1. Should not produce more than one recieve event per node
     2. Should not produce more than one move event per node
     3. Should not produce more receive events than size(i for prev not in final)
     3. Should not produce more move events than size(i for prev not in final)
     3. Should not produce more remove events than size(i for prev not in final)
     4. Should not produce more add events than size(i for final not in prev) 
     5. Should not produce receive events for nodes that are removed
     6. Should not produce receive events for nodes that are added
     7. Should not produce move events for nodes that are added 
     8. Should not produce move events for nodes that are removed 
   
   note that some of these tests will be redundant, but that's fine for now. */

// maps our sequences to our (transformed) test cases
const mapToBasis = (seqs, S) => seqs.map(s => s.map(el => copy(S[el])));

// "generating" set, factorial growth; infeasible for N > 4
// must have unique names for sake of test code (this is fine since we test subdiffing separately)
const genSet = [
  {name: "a", data: {id: 1}},
  {name: "b", data: {id: 2}},
  {name: "c", data: {id: 3}}
]
const seqs = findAll(genPermGraph(genSet.map((e, i) => i)));

// prev is the initial children
// next is the intermediate children
// final is the final children
module.exports = {
  prevCases: mapToBasis(seqs, genSet),
  nextCases: mapToBasis(seqs, genSet),
  finalCases: mapToBasis(seqs, genSet)
}
