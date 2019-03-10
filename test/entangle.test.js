const { describe, it } = require("mocha")
const { expect } = require("chai")
const { Tracker } = require("./effects");
const { diff: rawDiff } = require("../");
const { rootCase, treeCase, p, a } = require("./cases/entangle");
const { has } = require("./util");

const diff = (t, f, eff) => rawDiff(t, f, eff);

// willAdd is the first render, willUpdate is every other render
// using arrays here due to legacy; we used to have more events. good riddance.
const updateHooks = ["willUpdate"];
const addHooks = ["willAdd"];
const allHooks = [...addHooks, ...updateHooks];

// note implicit ordering intuitive: 
//   1. first declared children come first.
//   2. first declared affects come first.
// this is true as long as there are no other paths involving the nodes,
// for example consider diff(t_c', C):
//   `A.sub(C), B.sub(C)` will result in A getting updated before B.
//   `A.sub(C), B.sub(C), A.sub(B)` will result in B getting updated before A
//      since we made the ordering between A and B explicit 

// TODO: refactor this, but maybe not too much
describe("entanglement", function(){
  describe("amongst root frames", function(){
    it("should throw before the next diff runs if there are cycles", function(){
      const events = [], t1 = new Tracker(events), t2 = new Tracker(events); 
      const r1 = diff(p(0), null, t1), r2 = diff(p(0), null, t2);
      r1.sub(r2), r2.sub(r1), events.length = 0;
      expect(() => diff(p(0), r1)).to.throw("cycle")
      expect(events).to.be.empty;
    })
    it("should clean up unmounted entangled affects by the end of the next cycle", function(){
      const r1 = diff(p(0)), r2 = diff(p(1));
      r2.sub(r1);
      expect(r1.affs).to.contain(r2);
      diff(null, r2);
      expect(r1.affs).to.contain(r2);
      diff(p(0), r1);
      expect(r1.affs).to.be.null
    })
    allHooks.forEach(hook => {
      it(`should throw before the next diff runs if cycles are introduced in ${hook}`, function(){
        const events = [], t1 = new Tracker(events), t2 = new Tracker(events);
        const r1 = diff(p(0), null, t1);
        const r2 = diff(p(1, {[hook]: f => r1.sub(f)}), null, t2);
        r2.sub(r1), events.length = 0;
        const update = () => diff(p(1), r2);
        if (has(addHooks, hook)){
          expect(update).to.throw("cycle")
        } else {
          expect(update).to.not.throw()
          events.length = 0;
          expect(update).to.throw("cycle")
        }        
        expect(events).to.be.empty;
      })
    })
    describe("diffs in correct order", function(){
      it("should update nodes if upstream updated", function(){
        const {nodes, events} = rootCase.get();
        diff(p(0), nodes[0])
        expect(events).to.deep.equal([ 
          {wU: 0}, {wU: 1}, {wU: 2}, {wU: 3}, {mWR: 0},
        ])
      })
      it("should update nodes if upstream removed", function(){
        const {nodes, events} = rootCase.get();
        diff(null, nodes[0])
        expect(events).to.deep.equal([ 
          {wU: 1}, {wU: 2}, {wU: 3}, 
          {mWP: 0},
        ])
      })
      it("should not update all nodes if downstream updated", function(){
        const {nodes, events} = rootCase.get();
        diff(p(3), nodes[3])
        expect(events).to.deep.equal([{wU: 3}, {mWR: 3}])
      })
      it("should not update all nodes if downstream removed", function(){
        const {nodes, events} = rootCase.get();
        diff(null, nodes[3])
        expect(events).to.deep.equal([{mWP: 3}])
      })
      it("should reflect post-diff changes in entanglement in the next diff", function(){
        const {nodes, events} = rootCase.get();
        diff(p(0), nodes[0]);
        events.length = 0;
        nodes[2].unsub(nodes[1]);
        nodes[1].sub(nodes[2]);
        diff(p(0), nodes[0])
        expect(events).to.deep.equal([ 
          {wU: 0}, {wU: 2}, {wU: 1}, {wU: 3}, {mWR: 0},
        ])
      })
    })
    describe("applied dynamically are realized in next diff", function(){
      updateHooks.forEach(hook => {
        it(`should update nodes in new order if edges are introduced in ${hook}`, function(){
          const { nodes, events } = rootCase.get({
            0: {[hook]: f => {
              nodes[2].unsub(nodes[1]);
              nodes[1].sub(nodes[2]);
            }}
          })
          const result = [
            {wU: 0}, {wU: 2}, {wU: 1}, {wU: 3}, {mWR: 0},
          ]
          const update = () => diff(p(0), nodes[0]);
          update()
          expect(events).to.not.deep.equal(result)
          events.length = 0, update();
          expect(events).to.deep.equal(result)
        })
      })
      it("should properly update newly added nodes", function(){
        updateHooks.forEach(hook => {
          let p4;
          const { nodes, events } = rootCase.get({
            0: {[hook]: f => {
              if (!p4) p4 = diff(p(4), null, new Tracker(events));
              p4.sub(nodes[3])
            }}
          })
          const update = () => diff(p(0), nodes[0]);
          update(), events.length = 0, update();
          expect(events).to.deep.equal([
            {wU: 0}, {wU: 1}, {wU: 2}, {wU: 3}, {wU: 4}, {mWR: 0},
          ])
        })
      })
    })
  })
  describe("amongst subframes", function(){
    it("should throw before the next diff runs if there are cycles", function(){
      const events = [], t = new Tracker(events);
      const r = diff(p(0, null, [p(1), p(2)]), null, t), c = r.next;
      c.sub(c.sib), c.sib.sub(c), events.length = 0;
      expect(() => diff(p(0, null, [p(1), p(2)]), r)).to.throw("cycle")
      expect(events).to.be.empty;
    })
    it("should clean up unmounted entangled affects by the end of the next cycle", function(){
      const r = diff(p(0, null, p(1))), c = r.next;
      c.sub(r);
      expect(r.affs).to.contain(c);
      diff(p(0), r);
      expect(r.affs).to.contain(c);
      diff(p(0), r);
      expect(r.affs).to.be.null
    })
    allHooks.forEach(hook => {
      it(`should throw before the next diff runs if cycles are introduced in ${hook}`, function(){
        const events = [], t = new Tracker(events);
        let parent;
        const hooks = {
          [hook]: f => {
            f.sub(parent.next)
          }
        }
        const r = diff(p(0, {willAdd: f => parent = f}, [p(1), p(2, hooks)]), null, t);
        r.next.sub(r.next.sib)
        events.length = 0;
        const update = () => diff(p(0, null, [p(1), p(2)]), r)
        if (has(addHooks, hook)){
          expect(update).to.throw("cycle")
        } else {
          expect(update).to.not.throw();
          events.length = 0;
          expect(update).to.throw("cycle")
        }
        expect(events).to.be.empty;
      })
    })
    describe("diffs in correct order", function(){
      it("should update nodes if upstream updated", function(){
        const {nodes, events} = treeCase.get();
        diff(treeCase.tag0(), nodes[0])
        expect(events).to.deep.equal([ 
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 2}, {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7}, 
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ])
      })
      it("should update nodes if upstream removed", function(){
        const {nodes, events} = treeCase.get();
        diff(null, nodes[0])
        expect(events).to.deep.equal([ 
          {wU: 4}, {wU: 5}, {wU: 6}, {wU: 8},
          {wU: 7}, {mWP: 0}, {mWP: 1}, {mWP: 3}, {mWP: 2},
          {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ])
      })
      it("should not update all nodes if downstream updated", function(){
        const {nodes, events} = treeCase.get();
        diff(treeCase.tag4(), nodes[4])
        expect(events).to.deep.equal([ 
          {wU: 4}, {wU: 5}, {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7}, 
          {mWR: 4}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ])
      })
      it("should not update all nodes if downstream removed", function(){
        const {nodes, events} = treeCase.get();
        diff(null, nodes[4])
        expect(events).to.deep.equal([ 
          {wU: 3},
          {mWP: 4}, {mWP: 8}, {mWP: 5},
          {mWP: 7}, {mWP: 6},
        ])
      })
      it("should reflect post-diff changes in entanglement in the next diff", function(){
        const {nodes, events} = treeCase.get();
        diff(treeCase.tag0(), nodes[0])
        events.length = 0;
        nodes[3].unsub(nodes[2]);
        nodes[2].sub(nodes[3]);
        diff(treeCase.tag0(), nodes[0])
        expect(events).to.deep.equal([ 
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 3}, {wU: 2}, {wU: 6}, {wU: 8}, {wU: 7},
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ])
      })
    })
    describe("applied dynamically are realized in next diff", function(){
      updateHooks.forEach(hook => {
        it(`should update nodes in new order if edges are introduced in ${hook}`, function(){
          const { nodes, events } = treeCase.get({
            2: {[hook]: f => {
              nodes[3].unsub(f);
              f.sub(nodes[3]);
            }}
          })
          const result = [ 
            {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 3}, {wU: 2}, {wU: 6}, {wU: 8}, {wU: 7},
            {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
          ]
          const update = () => diff(treeCase.tag0(), nodes[0]);
          update()
          expect(events).to.not.deep.equal(result);
          events.length = 0, update();
          expect(events).to.deep.equal(result)
        })
      })
      // this is a legacy test from back when we used the affCount to decide whether to defer new adds
      it("should add new unentangled children after the affected region is updated", function(){
        const { nodes, events } = treeCase.get({
          2: {
            willUpdate: f => {f.nextChildren = [p(9, null, p(10)), p(11)]},
            getNext(data, next){
              return this.nextChildren
            }
          }
        })
        const result = [ 
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 2}, {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7},
          {wA: 9}, {wA: 10}, {wA: 11}, 
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
          {mWA: 9}, {mWA: 10}, {mWA: 11},
        ]
        diff(treeCase.tag0(), nodes[0]);
        expect(events).to.deep.equal(result);
      })
      it("should properly update new unentangled children during the next diff", function(){
        const { nodes, events } = treeCase.get({
          2: {
            willUpdate: f => {f.nextChildren = [p(9, null, p(10)), p(11)]},
            getNext(data, next){
              return this.nextChildren
            }
          }
        })
        const result = [ 
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5},
          {wU: 2}, {wU: 9}, {wU: 10}, {wU: 11}, {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7},
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7}, {mWR: 9}, {mWR: 11}, {mWR: 10},
        ]
        const update = () => diff(treeCase.tag0(), nodes[0]);
        update(), events.length = 0, update();
        expect(events).to.deep.equal(result);
      })
      it("should add new entangled children after the affected region is updated", function(){
        const { nodes, events } = treeCase.get({
          2: {
            willUpdate: f => {
              f.nextChildren = [p(9, {ctor: f => f.sub(nodes[7])}, p(10)), p(11)]
            },
            getNext(data, next){
              return this.nextChildren
            }
          }
        })
        const result = [
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 2}, {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7}, 
          {wA: 9}, {wA: 10}, {wA: 11},
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
          {mWA: 9}, {mWA: 10}, {mWA: 11},
        ]
        diff(treeCase.tag0(), nodes[0]);
        expect(events).to.deep.equal(result);
      })
      it("should properly update newly entangled children in the next diff", function(){
        const { nodes, events } = treeCase.get({
          2: {
            willUpdate: f => {
              f.nextChildren = [p(9, {ctor: f => f.sub(nodes[7])}, p(10)), p(11)]
            },
            getNext(data, next){
              return this.nextChildren
            }
          }
        })
        const result = [
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 2}, {wU: 11},
          {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7}, {wU: 9}, {wU: 10},
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7}, {mWR: 9}, {mWR: 11}, {mWR: 10},
        ]
        const update = () => diff(treeCase.tag0(), nodes[0]);
        update(), events.length = 0, update();
        expect(events).to.deep.equal(result);
      })
      // this is a legacy test from back when we used the affCount to decide whether to defer new adds
      it("should add new affector children after the affected region is updated", function(){
        const { nodes, events } = treeCase.get({
          2: {
            willUpdate: f => {
              f.nextChildren = [p(9, {ctor: f => nodes[4].sub(f)}, p(10)), p(11)]
            },
            getNext(data, next){
              return this.nextChildren
            }
          }
        })
        const result = [ 
          {wU: 0}, {wU: 1}, {wU: 4}, {wU: 5}, {wU: 2}, {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7},
          {wA: 9}, {wA: 10}, {wA: 11},
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
          {mWA: 9}, {mWA: 10}, {mWA: 11},
        ]
        diff(treeCase.tag0(), nodes[0]);
        expect(events).to.deep.equal(result);
      })
      it("should properly account for recently added affector children during the next diff", function(){
        const { nodes, events } = treeCase.get({
          2: {
            willUpdate: f => {
              f.nextChildren = [p(9, {ctor: f => nodes[4].sub(f)}, p(10)), p(11)]
            },
            getNext(data, next){
              return this.nextChildren
            }
          }
        })
        const result = [ 
          {wU: 0}, {wU: 1}, {wU: 2}, {wU: 9}, {wU: 10}, {wU: 4}, {wU: 5}, {wU: 11},
          {wU: 3}, {wU: 6}, {wU: 8}, {wU: 7},
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 9}, {mWR: 11}, {mWR: 10}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ]
        const update = () => diff(treeCase.tag0(), nodes[0]);
        update(), events.length = 0, update();
        expect(events).to.deep.equal(result);
      })
      it("should immediately remove children regardless of entanglement", function(){
        const { nodes, events } = treeCase.get({
          0: {
            willUpdate: f => {
              f.kill = true;
            },
            getNext(data, next){
              return this.kill ? null : next;
            }
          }
        })
        const result = [
          {wU: 0}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 8}, {wU: 7},
          {mWP: 1}, {mWP: 3}, {mWP: 2},
          {mWR: 0}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ]
        diff(treeCase.tag0(), nodes[0]);
        expect(events).to.deep.equal(result);
      })
      // this is a legacy test from back when we used the affCount to decide whether to defer new adds
      // now we just defer everything until the path has been exhausted; this test should fail if we selectively defer
      it("should immediately remove a replaced child and defer adding the new one if it has no entanglement", function(){
        const { nodes, events } = treeCase.get({
          0: {
            willUpdate: f => {
              f.nextChildren = a(9);
            },
            getNext(data, next){
              return this.nextChildren || next;
            }
          }
        })
        const result = [
          {wU: 0}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 8}, {wU: 7}, {wA: 9},
          {mWP: 1}, {mWP: 3}, {mWP: 2},
          {mWR: 0}, {mWA: 9}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ]
        diff(treeCase.tag0(), nodes[0]);
        expect(events).to.deep.equal(result);
      })
      it("should immediately remove a replaced child and defer adding the new one if it is entangled", function(){
        const { nodes, events } = treeCase.get({
          0: {
            willUpdate: f => {
              f.nextChildren = a(9, {ctor: f => f.sub(nodes[4])});
            },
            getNext(data, next){
              return this.nextChildren || next;
            }
          }
        })
        const result = [
          {wU: 0}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 8}, {wU: 7}, {wA: 9},
          {mWP: 1}, {mWP: 3}, {mWP: 2},
          {mWR: 0}, {mWA: 9}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ]
        diff(treeCase.tag0(), nodes[0]);
        expect(events).to.deep.equal(result);
      })
      it("should account for the new entangled replacement child in the next diff", function(){
        const { nodes, events } = treeCase.get({
          0: {
            willUpdate: f => {
              f.nextChildren = a(9, {ctor: f => f.sub(nodes[4])});
            },
            getNext(data, next){
              return this.nextChildren || next;
            }
          }
        })
        const result = [
          {wU: 4}, {wU: 5}, {wU: 6},  {wU: 8}, {wU: 7}, {wU: 9},
          {mWR: 4}, {mWR: 5}, {mWR: 8}, {mWR: 6}, {mWR: 7},
        ]
        diff(treeCase.tag0(), nodes[0]);
        events.length = 0;
        diff(treeCase.tag4(), nodes[4]);
        expect(events).to.deep.equal(result);
      })
    })
  })
})
