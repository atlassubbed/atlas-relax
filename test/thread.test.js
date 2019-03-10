const { describe, it } = require("mocha")
const { expect } = require("chai")
const { LCRSRenderer, Tracker } = require("./effects");
const { Frame, diff } = require("../");
const { copy } = require("./util")


/* Here's the situation we're simulating, as code below may be a bit ugly: 

   First diff: ManagedRoot mounts and mounts (rebases) 6 children under it.
       ManagedRoot (given a render prop)
       / | | | | \
      a  b d e f  g 

   Second diff: ManagedRoot updates and mounts (rebases) c and c1
       ManagedRoot
      / | | | | | \
     a  b | d e f  g
          c
           \
            c1

               After diffing c and c1, render prop is called which rebases various nodes.
               We need to test situations where we rebase shit around c which may result in 
               c getting mounted after c1 (illegal). This test file is to test that this 
               behavior does not occur (i.e. that c1's event is always emitted after c's). 
               Normally, we aren't concerned w/ inter-level event ordering in this iteration
               as long as all non-commutative events have a preserved order.
               However, we must at least guard against the possibility of a child mounting
               before its own parent has even mounted! */

const initialIds = [0,1,2,3,4,5,6]
const idsToTemp = [
  {name: "a", data: {id: 0}},
  {name: "b", data: {id: 1}},
  {name: "c", data: {id: 2}},
  {name: "d", data: {id: 3}},
  {name: "e", data: {id: 4}},
  {name: "f", data: {id: 5}},
  {name: "g", data: {id: 6}},
  {name: "h", data: {id: 7}},
  {name: "c1", data: {id: 8}}
]

class ManagedRoot extends Frame {
  render(temp, node){
    // if we're doing a static render, return the expected final state
    if (!node.render) return temp.data.expected.map(id => {
      let temp = copy(idsToTemp[id]);
      if (id === 2) temp.next = idsToTemp[8];
      return temp;
    })
    let cache;
    if (!this.cache){
      cache = this.cache = [...initialIds];
      for (let i = cache.length; i--;)
        if (i !== 2) cache[i] = diff(idsToTemp[i], null, node);
    } else {
      cache = this.cache;
      cache[2] = diff(idsToTemp[2], null, node, cache[1])
      cache[8] = diff(idsToTemp[8], null, cache[2])
      temp.data.render(node, cache)
    }
  }
}

const test = (expected, render) => {
  const events = [];
  const renderer = new LCRSRenderer, tracker = new Tracker(events);
  const temp = {name: ManagedRoot, data: {id: "root", expected, render}};
  const r = diff(temp, null, [renderer, tracker])
  events.length = 0;
  r.diff();
  expect(renderer.tree).to.eql(renderer.renderStatic(temp))
}

describe("event thread ordering when rebasing", function(){
  describe("properly executes child events after parent events", function(){
    it("should mount the initial children if rebase op is a noop", function(){
      test(initialIds, (rootNode, cache) => {})
    })
    it("should remove the parent's far away sibling", function(){
      test([0,1,2,3,4,6], (rootNode, cache) => {
        diff(null, cache[5])
      })
    })
    it("should update the parent's far away sibling", function(){
      test([0,1,2,3,4,5,6], (rootNode, cache) => {
        diff(copy(idsToTemp[5]), cache[5])
      })
    })
    it("should add a sibling far away from the parent", function(){
      test([0,1,2,3,4,7,5,6], (rootNode, cache) => {
        diff(idsToTemp[7], null, rootNode, cache[4])
      })
    })
    it("should move a sibling far away from the parent", function(){
      test([0,1,2,3,5,6,4], (rootNode, cache) => {
        diff(cache[4].temp, cache[4], cache[6])
      })
    })
    it("should remove a to-be-added parent", function(){
      test([0,1,3,4,5,6], (rootNode, cache) => {
        diff(null, cache[2])
      })
    })
    it("should move a to-be-added parent to a different position", function(){
      test([0,1,3,4,5,2,6], (rootNode, cache) => {
        diff(cache[2].temp, cache[2], cache[5])
      })
    })
    it("should move a to-be-added parent after another to-be-updated sibling", function(){
      test([0,1,3,4,5,2,6], (rootNode, cache) => {
        diff(copy(idsToTemp[5]), cache[5]);
        diff(cache[2].temp, cache[2], cache[5])
      })
    })
    it("should move a to-be-added parent before another to-be-updated sibling", function(){
      test([0,1,3,4,2,5,6], (rootNode, cache) => {
        diff(copy(idsToTemp[5]), cache[5]);
        diff(cache[2].temp, cache[2], cache[4])
      })
    })
    it("should move a to-be-added parent after another to-be-added sibling", function(){
      test([0,1,3,4,7,2,5,6], (rootNode, cache) => {
        cache[7] = diff(idsToTemp[7], null, rootNode, cache[4]);
        diff(cache[2].temp, cache[2], cache[7])
      })
    })
    it("should move a to-be-added parent before another to-be-added sibling", function(){
      test([0,1,3,4,2,7,5,6], (rootNode, cache) => {
        cache[7] = diff(idsToTemp[7], null, rootNode, cache[4]);
        diff(cache[2].temp, cache[2], cache[4])
      })
    })
    it("should update the sibling before a to-be-added parent", function(){
      test([0,1,2,3,4,5,6], (rootNode, cache) => {
        diff(copy(idsToTemp[1]), cache[1])
      })
    })
    it("should update the sibling after a to-be-added parent", function(){
      test([0,1,2,3,4,5,6], (rootNode, cache) => {
        diff(copy(idsToTemp[3]), cache[3])
      })
    })
    it("should add a sibling before a to-be-added parent", function(){
      test([0,1,7,2,3,4,5,6], (rootNode, cache, par) => {
        diff(idsToTemp[7], null, rootNode, cache[1])
      })
    })
    it("should add a sibling after a to-be-added parent", function(){
      test([0,1,2,7,3,4,5,6], (rootNode, cache) => {
        diff(idsToTemp[7], null, rootNode, cache[2])
      })
    })
    it("should move a sibling before a to-be-added parent", function(){
      test([0,1,5,2,3,4,6], (rootNode, cache) => {
        diff(cache[5].temp, cache[5], cache[1])
      })
    })
    it("should move a sibling after a to-be-added parent", function(){
      test([0,1,2,5,3,4,6], (rootNode, cache) => {
        diff(cache[5].temp, cache[5], cache[2])
      })
    })
    it("should remove a sibling after a to-be-added parent if the next sibling has an update", function(){
      test([0,1,2,4,5,6], (rootNode, cache) => {
        diff(copy(idsToTemp[4]), cache[4]);
        diff(null, cache[3])
      })
    })
    it("should remove a sibling before a to-be-added parent if the previous sibling has an update", function(){
      test([0,2,3,4,5,6], (rootNode, cache) => {
        diff(copy(idsToTemp[0]), cache[0]);
        diff(null, cache[1])
      })
    })
  })
})