/* Preface
     1. Abstract common operations to keep each function simple.
     2. N is strictly bounded, so we don't care about asymptotic behavior.
          * We may safely use recursion without worrying about our stack.
          * We may implement inefficient algorithms without worrying about performance. */

/* Subdiff problem: given an array of children, generate all subarrays in all possible orders.
   We want set, K, of all permutations of the elements in power set, P, of S
     1. (n m) = n!/((n-m)!*m!)
     2. let P be the power set of S, i.e. the set of all subsets.
        |P| = 2^|S|, each element p in P has |p|! permutations
     3. let K be the set of all permutations for all p in P
        |K| = SUM((|S| s)*s!, s = 0 to s = |S|) = SUM(|S|!/s!, s = 0 to s = |S|) */

/* generates a trie which stores all elements in K
   e.g. if S = {1,2,3}
   then the generated trie is something like
       START
      /  |  \
     1   2   3
    / \ / \ / \
    2 3 1 3 1 2
    | | | | | |
    3 2 3 1 2 1
  reduce is used to accumulate entries in the trie */
const genPermGraph = indexes => indexes.reduce((p, i) => {
  (p = p || {})[i] = genPermGraph(indexes.filter(j => j !== i));
  return p;
}, false)

/* finds every unique sequence stored in a trie
  e.g. if our trie looks something like:
    START
    /   \
   1     2
   |     |
   2     1
  and we get the set, K, of sequences:
    {[], [1], [2], [1,2], [2,1]}
  which is just a set of all elements in the trie */
const findAll = (trie, res=[], cur=[]) => {
  res.push(cur);
  if (trie) for (let i in trie) findAll(trie[i], res, [...cur, i]);
  return res;
}

/* Scheduling problem: given N positive frequencies, generate all combinations of all relationships between all frequencies.
   Example: given f1 and f2, we have 3 possible states:
     f1 == f2, f1 > f2, and f1 < f2.
     This is much less obvious as we increase N.

   Turns out, all of these relationships can be represented as points (regions, really) on a hypercube:
     For N = 2, we have the following 2-cube:
           f1
           |   A (f1 > f2)   
           |---.---.B (f1 == f2)
           |       |
           |       .C (f1 < f2)
           |_______|_______f2
     The three-dimensional case is also simple and follows by generalizing the above case. 
     There are N = 13 points in the 3-D case.
     Generalizing this visualization seems tougher for N = 4 and up
     unless we wanna get into complicated projections of points on hypercubes.

   There's another, simpler, way to represent this problem:
     For N = 2 and 3, respectively, we have the following triangles:
     -----.-----> f axis     -----.-----> f axis
     ---.---.---> f axis     ---.---.---> f axis
                             -.---.---.-> f axis
     
     Each point represents a bucket containing K frequencies.
     Frequencies inside the same bucket have the same value.
     The f-axis goes from left to right, therefore buckets to the right have greater values than those to the left.
       e.g. for N = 2 -----.----->
                      ---.-<-.---> the "greater than" sign is implied since f-axis goes from left to right.
     If there are only N frequency values, than there can be at most N buckets (each bucket requires at least 1 value)
     The number of buckets ranges from 1 to N, inclusive.
   
   Let's pick apart the N = 2 case:
     The top axis, -----.----->, contains 1 bucket. All two frequencies must lie in this bucket.
     They both contain the same value, and the order in which they appear in the bucket does not matter.
     Thus, f1 == f2 for the top axis.
     The bottom axis, ---.---.--->, contains two buckets, each of which have a single value. We permute bucket order:
        1. [[f1], [f2]], f1 is in the first bucket, f2 in the second, thus f1 < f2.
        2. [[f2], [f1]], f2 is in the first bucket, f1 in the second, thus f1 > f2.
     Similarly, we may compute the results for N = 3
     For N = 3, we arrive at the same 13 states we arrived at in the lattice representation.

   Algorithm to generate all microstates (lattice points) for a set of frequencies:
     1. Compute B, the set of all partitions of a set of frequencies (i.e. the Bell list).
     2. Expand each element, b, in B into the set of all permutations of b.
   The above algorithm will produce every point on our lattice for any N. */


/* This is a helper factory that enumerates every vector over a discrete set of component values
   Unlike genPermGraph, every such enumeration problem here contains instances of itself.
   Thus, we we may use memoization to trade off time complexity for memory usage. 
   Tbh, this shouldn't matter much since the downstream code is exponential anyway...
   
   Why do we need a factory here? 
     Initially, this was a single function for the special case of values = [0,1]
     which we used to generate masks used in obtaining elements of a power set.
     Turns out we need the same functionality for non-binary values!
     In any case, an example of the usage of this factory is presented below with enumerateBinaryVectors */
const VectorEnumerator = values => {
  const cache = {};
  return function trie(n){ 
    return !!n && values.reduce((node, k) => {
      return node[k] = cache[n-1] = cache[n-1] || trie(n-1), node;
    }, {})
  }
}

/* generates a trie which stores all of the masks used to generate a power set, P, of S.
  e.g. if n = 3
        START
       /     \
      0       1
     / \     / \
    0   1   0   1
   / \ / \ / \ / \
  0  1 0 1 0 1 0  1 = 2^3 = 8 leaves
  evidently, this is a problem of subproblems,
  so we use memoization to trade time complexity for memory usage */
const enumerateBinaryVectors = VectorEnumerator([0,1])


// like findAll, but only returns the longest stored sequences (i.e. ones containing leaves)
const findLeaves = (trie, res=[], cur=[]) => {
  if (trie) for (let i in trie) 
    findLeaves(trie[i], res, [...cur, i]);
  else if (cur.length) res.push(cur);
  return res;
}

// apply masks to a set, generates the power set of the set
// this implementation has the property that the subset at an index's reflected index
// about the midpoint of the power set is the complement of the original index's subset.
// We will use this property when generating the Bell list.
const scache = {};
const powerSet = arr => {
  const n = arr.length, pow = scache[n] = scache[n] || findLeaves(enumerateBinaryVectors(n));
  return pow.map(bin => arr.filter((el, i) => bin[i] === "1"))
}

// generate the set of all partitions of a set
const bellList = (arr, res=[], cur=[]) => {
  const set = powerSet(arr), max = set.length, mid = max/2
  if (max) for (let i = max; i-- > mid;)
    bellList(set[max-i-1], res, [set[i], ...cur]);
  else res.push(cur);
  return res;
}

// for each element in the bell list, generate all permutations of that element
const pcache = {};
const bellListPerms = ids => {
  // generate set of sets of permutations of each partition in the bell list
  let permutations = [], b, n, bell = bellList(ids);
  while(b = bell.pop()){
    const subperms = findLeaves(pcache[n = b.length] = pcache[n] || genPermGraph(b.map((e,i) => i)));
    permutations.push(...subperms.map(perm => perm.map(el => b[el])))
  }
  return permutations;
}

module.exports = { genPermGraph, findAll, findLeaves, bellListPerms, VectorEnumerator }