const { describe, it } = require("mocha")
const { expect } = require("chai")
const { LCRSRenderer, Tracker } = require("./effects");
const { diff, Frame } = require("../");
const { StemCell } = require("./cases/Frames");
const DeferredTests = require("./DeferredTests")
const { has, copy, inject } = require("./util")

const addHooks = ["willAdd", "didAdd"];
const updateHooks = ["willUpdate", "didUpdate"];
const allHooks = [...addHooks, ...updateHooks];

const p = StemCell.h
const h = (id, hooks, next) => p(id, {hooks}, next);
const hooks = (hook, job) => ({[hook]: function(){job(this)}})
const m = id => ({name:"div", data:{id}});
const k = (id, hooks, next) => { // keyed
  const node = p(id, {hooks}, next);
  node.key = id;
  return node;
}

/* merging consecutive synchronous diffs is done by "rebasing" the current path onto the latter diff.
    _----_----_
   |    | |    |  venn diagram of derived affected regions for first diff (A)
   |  A | | B  |  and the second diff (B). fill(O1) = A, fill(O2) = B where
    -____-____-   O1 is the originator set for A as O2 is for B.
                  O1 and O2 may be disjoint and |path| = |A U B|. */

// performing an outer-diff during mutation events is strictly not supported.

// XXX this code is dripping wet, need to wring it out so it becomes DRY
//   e.g. 'should not X during Y' tests can be abstracted out into a factory or fn
//   pretty easy refactor opportunity here, this file should be 100s of lines, not 1000s
describe("rebasing (merging a new diff into current diff)", function(){
  describe("mounting", function(){
    describe("virtual (managed) nodes", function(){
      it("should not mount nodes during a constructor", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("ctor", f => {
          const res = diff(m(1), null, f);
          expect(res).to.be.false;
          called++
        }))
        diff(temp, null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not mount nodes during cleanup", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("cleanup", f => {
          const res = diff(m(1), null, f);
          expect(res).to.be.false;
          called++
        }))
        const f = diff(temp, null, [renderer, tracker]);
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {mWP: 0}])
      })
      it("should not mount nodes during add mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        diff(h(0), null, [renderer, tracker, {add: f => {
          const res = diff(h(1), null, f);
          expect(res).to.be.false;
          called++
        }}])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not mount nodes during remove mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const f = diff(h(0, null, h(1)), null, [renderer, tracker, {remove: (f, p, s, t) => {
          if (t.data.id === 1){
            const res = diff(h(2), null, f);
            expect(res).to.be.false;
            called++
          }
        }}])
        diff(h(0), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {mWA: 0}, {mWA: 1}, {wU: 0}, {mWP: 1}, {mWR: 0}
        ])
      })
      it("should not mount nodes during temp mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const f = diff(h(0), null, [renderer, tracker, {temp: f => {
          const res = diff(h(1), null, f);
          expect(res).to.be.false;
          called++
        }}])
        diff(h(0), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wU: 0}, {mWR: 0},
        ])
      })
      it("should not mount nodes during move mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const f = diff(h(0, null, [k(1), k(2)]), null, [renderer, tracker, {move: f => {
          if (f.temp.data.id === 2){
            const res = diff(h(3), null, f);
            expect(res).to.be.false;
            called++
          }
        }}])
        diff(h(0, null, [k(2), k(1)]), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [k(2), k(1)])));
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wA: 2}, {mWA: 0}, {mWA: 1}, {mWA: 2},
          {wU: 0}, {wU: 1}, {wU: 2}, {mWR: 0}, {mWR: 2}, {mWM: 2}, {mWR: 1}
        ])
      })
      allHooks.forEach(hook => {
        it(`should immediately return the root's ref during ${hook}`, function(){
          const managedTemp = m(1)
          let called = 0;
          const temp = h(0, hooks(hook, f => {
            const managedNode = diff(managedTemp, null, f);
            expect(managedNode).to.be.an.instanceOf(Frame);
            expect(managedNode.temp).to.equal(managedTemp);
            called++;
          }))
          const f = diff(temp);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(called).to.equal(1);
        })
        it(`should properly mount the node during ${hook}`, function(){
          const managedTemp = m(1)
          const renderer = new LCRSRenderer
          const temp = h(0, hooks(hook, f => {
            diff(managedTemp, null, f)
          }));
          const f = diff(temp, null, renderer);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), managedTemp)));
        })
        it(`should mount multiple sibling nodes in reverse call order by default during ${hook}`, function(){
          const managedChildren = [m(1), m(2), m(3)], reverse = [...managedChildren].reverse();
          const renderer = new LCRSRenderer
          const temp = h(0, hooks(hook, f => {
            for (let m of managedChildren) diff(m, null, f);
          }));
          const f = diff(temp, null, renderer);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), reverse)));
        })
        it(`should otherwise mount multiple sibling nodes in a specified order during ${hook}`, function(){
          const managedChildren = [m(1), m(2), m(3)];
          const renderer = new LCRSRenderer
          const temp = h(0, hooks(hook, f => {
            const first = diff(managedChildren[0], null, f); // first is first child
            const second = diff(managedChildren[1], null, f, first); // second after first
            diff(managedChildren[2], null, f, second); // third after second
          }));
          const f = diff(temp, null, renderer);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), managedChildren)));
        })
      })
      const mount = f => {
        diff(h(3, hooks("willAdd", f => {})), null, f);
        diff(h(4, hooks("willAdd", f => {})), null, f);
      }
      it("should defer rendering new nodes in reverse order until all updates have run during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1),
          h(2, hooks("willUpdate", f => mount(f)))
        ])
        const f = diff(temp, null, tracker);
        events.length = 0; // we don't care about initial mount
        diff(copy(temp), f);
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {wA: 4}, {wA: 3}, 
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWA: 4}, {mWA: 3}
        ])
      })
      it("should defer rendering new nodes in reverse order until after flush during didUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1),
          h(2, hooks("didUpdate", f => mount(f)))
        ])
        const f = diff(temp, null, tracker);
        events.length = 0; // we don't care about initial mount
        diff(copy(temp), f);
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {mWR: 0}, {mWR: 1}, {mWR: 2}, {dU: 2},
          {wA: 4}, {wA: 3}, {mWA: 4}, {mWA: 3}
        ])
      })
      it("should immediately add new nodes in reverse order during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1, hooks("willAdd", f => mount(f))),
          h(2)
        ])
        const f = diff(temp, null, tracker);
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wA: 4}, {wA: 3}, {wA: 2}, 
          {mWA: 0}, {mWA: 1}, {mWA: 4}, {mWA: 3}, {mWA: 2}
        ])
      })
      it("should defer adding new nodes in reverse order after flush during didAdd", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1, hooks("didAdd", f => mount(f))),
          h(2)
        ])
        const f = diff(temp, null, tracker);
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wA: 2}, {mWA: 0}, {mWA: 1}, {mWA: 2}, {dA: 1},
          {wA: 4}, {wA: 3}, {mWA: 4}, {mWA: 3},
        ])
      })
    })
    describe("free (unmanaged) nodes", function(){
      it("should not mount nodes during a constructor", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("ctor", f => {
          const res = diff(m(1), null, [renderer, tracker]);
          expect(res).to.be.false;
          called++
        }))
        diff(temp);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(events).to.be.empty
      })
      it("should not mount nodes during cleanup", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("cleanup", f => {
          const res = diff(m(1), null, [renderer, tracker]);
          expect(res).to.be.false;
          called++
        }))
        const f = diff(temp);
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(events).to.be.empty
      })
      it("should not mount nodes during add mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        diff(h(0), null, {add: f => {
          const res = diff(h(1), null, [renderer, tracker]);
          expect(res).to.be.false;
          called++
        }})
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(events).to.be.empty;
      })
      it("should not mount nodes during remove mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const f = diff(h(0, null, h(1)), null, {remove: (f, p, s, t) => {
          if (t.data.id === 1){
            const res = diff(h(2), null, [renderer, tracker]);
            expect(res).to.be.false;
            called++
          }
        }})
        diff(h(0), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(events).to.be.empty
      })
      it("should not mount nodes during temp mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const f = diff(h(0), null, {temp: f => {
          const res = diff(h(1), null, [renderer, tracker]);
          expect(res).to.be.false;
          called++
        }})
        diff(h(0), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(events).to.be.empty;
      })
      it("should not mount nodes during move mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const f = diff(h(0, null, [k(1), k(2)]), null, {move: f => {
          if (f.temp.data.id === 2){
            const res = diff(h(3), null, [renderer, tracker]);
            expect(res).to.be.false;
            called++
          }
        }})
        diff(h(0, null, [k(2), k(1)]), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(events).to.be.empty;
      })
      allHooks.forEach(hook => {
        it(`should immediately return the root's ref during ${hook}`, function(){
          const managedTemp = m(1)
          let called = 0;
          const temp = h(0, hooks(hook, f => {
            const managedNode = diff(managedTemp);
            expect(managedNode).to.be.an.instanceOf(Frame);
            expect(managedNode.temp).to.equal(managedTemp);
            called++;
          }))
          const f = diff(temp);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(called).to.equal(1);
        })
        it(`should properly mount the node during ${hook}`, function(){
          const managedTemp = m(1)
          const renderer = new LCRSRenderer
          const temp = h(0, hooks(hook, f => {
            diff(managedTemp)
          }));
          const f = diff(temp, null, renderer);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(renderer.tree).to.eql(renderer.renderStatic(temp));
        })
        it(`should mount multiple nodes in reverse call order during ${hook}`, function(){
          const managedIds = [1, 2, 3];
          let order = [];
          const temp = h(0, hooks(hook, f => {
            for (let id of managedIds) diff(h(id, hooks("willAdd", f => {
              order.push(id);
            })));
          }));
          const f = diff(temp);
          if (has(updateHooks, hook)) diff(copy(temp), f);
          expect(order).to.eql([3,2,1])
        })
      })
      const mount = tracker => {
        diff(h(3, hooks("willAdd", f => {})), null, tracker);
        diff(h(4, hooks("willAdd", f => {})), null, tracker);
      }
      it("should defer rendering new nodes in reverse order until all updates have run during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1),
          h(2, hooks("willUpdate", f => mount(tracker)))
        ])
        const f = diff(temp, null, tracker);
        events.length = 0; // we don't care about initial mount
        diff(copy(temp), f);
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {wA: 4}, {wA: 3}, 
          {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWA: 3}, {mWA: 4}
        ])
      })
      it("should defer rendering new nodes in reverse order until after flush during didUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1),
          h(2, hooks("didUpdate", f => mount(tracker)))
        ])
        const f = diff(temp, null, tracker);
        events.length = 0; // we don't care about initial mount
        diff(copy(temp), f);
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {mWR: 0}, {mWR: 1}, {mWR: 2}, {dU: 2},
          {wA: 4}, {wA: 3}, {mWA: 3}, {mWA: 4}
        ])
      })
      it("should immediately render new nodes in reverse order during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1, hooks("willAdd", f => mount(tracker))),
          h(2)
        ])
        const f = diff(temp, null, tracker);
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wA: 4}, {wA: 3}, {wA: 2}, 
          {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}
        ])
      })
      it("should defer adding new nodes in reverse order after flush during didAdd", function(){
        const events = [], tracker = new Tracker(events);
        const temp = h(0, null, [
          h(1, hooks("didAdd", f => mount(tracker))),
          h(2)
        ])
        const f = diff(temp, null, tracker);
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wA: 2}, {mWA: 0}, {mWA: 1}, {mWA: 2}, {dA: 1},
          {wA: 4}, {wA: 3}, {mWA: 3}, {mWA: 4},
        ])
      })
    })
  })
  describe("unmounting", function(){
    describe("virtual (managed) nodes", function(){
      it("should not unmount nodes during a constructor", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedR = diff(h(1), null, r);
        diff(h(2, hooks("ctor", f => {
          const res = diff(null, managedR);
          expect(res).to.be.false;
          called++
        })))
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not unmount nodes during cleanup", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedR = diff(h(1), null, r);
        const f = diff(h(2, hooks("cleanup", f => {
          const res = diff(null, managedR);
          expect(res).to.be.false;
          called++
        })))
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not unmount nodes during add mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        diff(h(2), null, {add: f => {
          const res = diff(null, m);
          expect(res).to.be.false;
          called++
        }})
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not unmount nodes during remove mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        const f = diff(h(2), null, {remove: f => {
          const res = diff(null, m);
          expect(res).to.be.false;
          called++
        }})
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not unmount nodes during temp mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        const f = diff(h(2), null, {temp: f => {
          const res = diff(null, m);
          expect(res).to.be.false;
          called++
        }})
        diff(h(2), f)
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not unmount nodes during move mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        const f = diff(h(2, null, [k(3), k(4)]), null, {move: f => {
          if (f.temp.data.id === 4){
            const res = diff(null, m);
            expect(res).to.be.false;
            called++
          }
        }})
        diff(h(2, null, [k(4), k(3)]), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should unmount nodes created during willAdd in the next cycle", function(){
        const managedTemp = h(1);
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let called = 0;
        const hooks = {
          willAdd: f => {f.managed = diff(managedTemp, null, f)},
          willUpdate: f => {
            expect(f.managed).to.be.an.instanceOf(Frame);
            expect(f.managed.temp).to.equal(managedTemp);
            expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks, h(1))))
            const res = diff(null, f.managed)
            expect(res).to.be.true;
            called++;
          }
        }
        const r = diff(h(0, hooks), null, [renderer, tracker]);
        diff(h(0, hooks), r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks)))
        expect(events).to.eql([ 
          { wA: 0 }, { wA: 1 }, { mWA: 0 }, { mWA: 1 }, { wU: 0 }, { mWP: 1 }, { mWR: 0 }
        ])
      })
      it("should unmount nodes created during willAdd in didAdd", function(){
        const managedTemp = h(1);
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let called = 0;
        const hooks = {
          willAdd: f => {f.managed = diff(managedTemp, null, f)},
          didAdd: f => {
            expect(f.managed).to.be.an.instanceOf(Frame);
            expect(f.managed.temp).to.equal(managedTemp);
            expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks, h(1))))
            const res = diff(null, f.managed)
            expect(res).to.be.true;
            called++;
          }
        }
        diff(h(0, hooks), null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks)))
        expect(events).to.eql([ 
          { wA: 0 }, { wA: 1 }, { mWA: 0 }, { mWA: 1 }, {dA: 0}, { mWP: 1 }
        ])
      })
      it("should unmount an external node during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1), null, r1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))))
        let called = 0;
        const temp = h(2, hooks("willAdd", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, {wA: 1}, { mWA: 1 }, {wA: 2}, { mWP: 1 }, {mWA: 2}
        ])
      })
      it("should unmount an external node during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1), null, r1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))))
        let called = 0;
        const temp = h(2, hooks("didAdd", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {dA: 2}, { mWP: 1 }
        ])
      })
      it("should unmount an external node during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1), null, r1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))))
        let called = 0;
        const temp = h(2, hooks("willUpdate", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          {wU: 2}, { mWP: 1 }, {mWR: 2}
        ])
      })
      it("should unmount an external node during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1), null, r1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))))
        let called = 0;
        const temp = h(2, hooks("didUpdate", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          {wU: 2}, {mWR: 2}, {dU: 2}, {mWP: 1}
        ])
      })
      it("should unmount a node that has not yet been rendered during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const t = h(0, hooks("willAdd", f => {
          const r = diff(m(1), null, f);
          diff(null, r);
        }))
        diff(t, null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(events).to.eql([{ wA: 0 }, { mWA: 0 }])
      })
      it("should unmount a node that has not yet been rendered during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const t = h(0, hooks("didAdd", f => {
          const r = diff(m(1), null, f);
          diff(null, r);
        }))
        diff(t, null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(events).to.eql([{ wA: 0 }, { mWA: 0 }, {dA: 0}])
      })
      it("should unmount a node that has not yet been rendered during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const t = h(0, hooks("willUpdate", f => {
          const r = diff(m(1), null, f);
          diff(null, r);
        }))
        const r = diff(t, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(t), r);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(events).to.eql([{ wU: 0 }, { mWR: 0 }])
      })
      it("should unmount a node that has not yet been rendered during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const t = h(0, hooks("didUpdate", f => {
          const r = diff(m(1), null, f);
          diff(null, r);
        }))
        const r = diff(t, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(t), r);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(events).to.eql([{ wU: 0 }, { mWR: 0 }, {dU: 0}])
      })
      it("should properly unmount itself during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const temp = h(1, hooks("willAdd", f => diff(null, f)));
        diff(temp, null, r);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([ { wA: 0 }, { mWA: 0 }, { wA: 1 }])
      })
      it("should properly unmount itself during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const temp = h(1, hooks("didAdd", f => diff(null, f)));
        diff(temp, null, r);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([ { wA: 0 }, { mWA: 0 }, { wA: 1 }, {mWA: 1}, {dA: 1}, {mWP: 1}])
      })
      it("should properly unmount itself during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const temp = h(1, hooks("willUpdate", f => diff(null, f)));
        const r2 = diff(temp, null, r);
        events.length = 0;
        diff(copy(temp), r2)
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([ { wU: 1 }, { mWP: 1 }])
      })
      it("should properly unmount itself during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const temp = h(1, hooks("didUpdate", f => diff(null, f)));
        const r2 = diff(temp, null, r);
        events.length = 0;
        diff(copy(temp), r2)
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([ { wU: 1 }, {mWR: 1}, {dU: 1}, { mWP: 1 }])
      })
      it("should unmount multiple nodes in default order during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("willAdd", f => {
          expect(diff(null, managedRoot1)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot3)).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {wA: 3}, { mWA: 3},
          { wA: 4}, {mWP: 1}, {mWP: 2}, {mWP: 3}, {mWA: 4}
        ])
      })
      it("should unmount multiple nodes in default order during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("didAdd", f => {
          expect(diff(null, managedRoot1)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot3)).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {wA: 3}, { mWA: 3},
          { wA: 4}, {mWA: 4}, {dA: 4}, {mWP: 1}, {mWP: 2}, {mWP: 3}
        ])
      })
      it("should unmount multiple nodes in default order during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("willUpdate", f => {
          expect(diff(null, managedRoot1)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot3)).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          {wU: 4}, { mWP: 1 }, { mWP: 2 }, { mWP: 3 }, {mWR: 4}
        ])
      })
      it("should unmount multiple nodes in default order during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("didUpdate", f => {
          expect(diff(null, managedRoot1)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot3)).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          {wU: 4}, {mWR: 4}, {dU: 4}, { mWP: 1 }, { mWP: 2 }, { mWP: 3 }
        ])
      })
      it("should unmount multiple nodes in a specified order during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("willAdd", f => {
          expect(diff(null, managedRoot3)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot1)).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {wA: 3}, { mWA: 3},
          { wA: 4}, {mWP: 3}, {mWP: 2}, {mWP: 1}, {mWA: 4}
        ])
      })
      it("should unmount multiple nodes in a specified order during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("didAdd", f => {
          expect(diff(null, managedRoot3)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot1)).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {wA: 3}, { mWA: 3},
          { wA: 4}, {mWA: 4}, {dA: 4}, {mWP: 3}, {mWP: 2}, {mWP: 1}
        ])
      })
      it("should unmount multiple nodes in a specified order during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("willUpdate", f => {
          expect(diff(null, managedRoot3)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot1)).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          {wU: 4}, { mWP: 3 }, { mWP: 2 }, { mWP: 1 }, {mWR: 4}
        ])
      })
      it("should unmount multiple nodes in a specified order during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("didUpdate", f => {
          expect(diff(null, managedRoot3)).to.be.true;
          expect(diff(null, managedRoot2)).to.be.true;
          expect(diff(null, managedRoot1)).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(events).to.eql([
          {wU: 4}, {mWR: 4}, {dU: 4}, { mWP: 3 }, { mWP: 2 }, { mWP: 1 }
        ])
      })
      it("should rebase all entangled affects during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1, null, h(2)), null, r1);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(managedRoot), affectedRoot2.sub(managedRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, null, h(2)))))
        let called = 0;
        const temp = h(8, hooks("willAdd", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, {wA: 2}, {mWA: 1}, { mWA: 2 }, 
          {wA: 3}, {wA: 4}, {mWA: 3}, {mWA: 4},
          {wA: 5}, {wA: 6}, {wA: 7}, {mWA: 5}, {mWA:6}, {mWA: 7},
          {wA: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWA: 8}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
      it("should not rebase laggard entangled affects during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1, null, h(2)), null, r1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, null, h(2)))))
        let called = 0;
        const temp = h(8, hooks("willAdd", f => {
          const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
          const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
          affectedRoot1.sub(managedRoot), affectedRoot2.sub(managedRoot.next);
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, {wA: 2}, {mWA: 1}, { mWA: 2 },
          {wA: 8}, {wA: 5}, {wA: 6}, {wA: 7}, {wA: 3}, {wA: 4}, 
          {mWP: 1}, {mWP: 2}, {mWA: 8}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWA:6}, {mWA: 7}
        ])
      })
      it("should rebase all entangled affects during didAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1, null, h(2)), null, r1);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(managedRoot), affectedRoot2.sub(managedRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, null, h(2)))))
        let called = 0;
        const temp = h(8, hooks("didAdd", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, 
          {wA: 1}, {wA: 2}, {mWA: 1}, { mWA: 2 }, 
          {wA: 3}, {wA: 4}, {mWA: 3}, {mWA: 4},
          {wA: 5}, {wA: 6}, {wA: 7}, {mWA: 5}, {mWA:6}, {mWA: 7},
          {wA: 8}, {mWA: 8}, {dA: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
      it("should rebase all entangled affects during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1, null, h(2)), null, r1);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(managedRoot), affectedRoot2.sub(managedRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, null, h(2)))))
        let called = 0;
        const temp = h(8, hooks("willUpdate", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wU: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWR: 8}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
      it("should not rebase laggard entangled affects during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1, null, h(2)), null, r1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, null, h(2)))))
        let called = 0;
        const temp = h(8, hooks("willUpdate", f => {
          const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
          const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
          affectedRoot1.sub(managedRoot), affectedRoot2.sub(managedRoot.next);
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wU: 8}, {wA: 5}, {wA: 6}, {wA: 7}, {wA: 3}, {wA: 4},
          {mWP: 1}, {mWP: 2}, {mWR: 8}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWA: 6}, {mWA: 7}
        ])
      })
      it("should rebase all entangled affects during didUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot = diff(h(1, null, h(2)), null, r1);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(managedRoot), affectedRoot2.sub(managedRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, null, h(2)))))
        let called = 0;
        const temp = h(8, hooks("didUpdate", f => {
          const res = diff(null, managedRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wU: 8}, {mWR: 8}, {dU: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
    })
    describe("free (unmanaged) nodes", function(){
      it("should not unmount nodes during a constructor", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        diff(h(1, hooks("ctor", f => {
          const res = diff(null, r);
          expect(res).to.be.false;
          called++
        })))
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not unmount nodes during cleanup", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1, hooks("cleanup", f => {
          const res = diff(null, r);
          expect(res).to.be.false;
          called++
        })))
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not unmount nodes during add mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        diff(h(1), null, {add: f => {
          const res = diff(null, r);
          expect(res).to.be.false;
          called++
        }})
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not unmount nodes during remove mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1), null, {remove: f => {
          const res = diff(null, r);
          expect(res).to.be.false;
          called++
        }})
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not unmount nodes during temp mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1), null, {temp: f => {
          const res = diff(null, r);
          expect(res).to.be.false;
          called++
        }})
        diff(h(1), f)
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not unmount nodes during move mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1, null, [k(2), k(3)]), null, {move: f => {
          if (f.temp.data.id === 3){
            const res = diff(null, r);
            expect(res).to.be.false;
            called++
          }
        }})
        diff(h(1, null, [k(3), k(2)]), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should unmount nodes created during willAdd in the next cycle", function(){
        const temp = h(1);
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        let called = 0, mounted;
        const hooks = {
          willAdd: f => {mounted = diff(temp, null, [renderer2, tracker])},
          willUpdate: f => {
            expect(mounted).to.be.an.instanceOf(Frame);
            expect(mounted.temp).to.equal(temp);
            expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks)));
            expect(renderer2.tree).to.eql(renderer2.renderStatic(h(1)));
            const res = diff(null, mounted)
            expect(res).to.be.true;
            called++;
          }
        }
        const r = diff(h(0, hooks), null, [renderer, tracker]);
        diff(h(0, hooks), r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks)))
        expect(renderer2.tree).to.be.null
        expect(events).to.eql([ 
          { wA: 0 }, { wA: 1 }, { mWA: 0 }, { mWA: 1 }, { wU: 0 }, { mWP: 1 }, { mWR: 0 }
        ])
      })
      it("should unmount nodes created during willAdd in didAdd", function(){
        const temp = h(1);
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        let called = 0, mounted;
        const hooks = {
          willAdd: f => {mounted = diff(temp, null, [renderer2, tracker])},
          didAdd: f => {
            expect(mounted).to.be.an.instanceOf(Frame);
            expect(mounted.temp).to.equal(temp);
            expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks)));
            expect(renderer2.tree).to.eql(renderer2.renderStatic(h(1)));
            const res = diff(null, mounted)
            expect(res).to.be.true;
            called++;
          }
        }
        diff(h(0, hooks), null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, hooks)))
        expect(renderer2.tree).to.be.null
        expect(events).to.eql([ 
          { wA: 0 }, { wA: 1 }, { mWA: 0 }, { mWA: 1 }, {dA: 0}, { mWP: 1 }
        ])
      })
      it("should unmount an external node during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)))
        let called = 0;
        const temp = h(1, hooks("willAdd", f => {
          const res = diff(null, r1);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, [renderer2, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(temp)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, {wA: 1}, { mWP: 0 }, {mWA: 1}
        ])
      })
      it("should unmount an external node during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)))
        let called = 0;
        const temp = h(1, hooks("didAdd", f => {
          const res = diff(null, r1);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, [renderer2, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(temp)))
        expect(events).to.eql([
          { wA: 0 }, { mWA: 0 }, {wA: 1}, {mWA: 1}, {dA: 1}, { mWP: 0 }
        ])
      })
      it("should unmount an external node during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)))
        let called = 0;
        const temp = h(1, hooks("willUpdate", f => {
          const res = diff(null, r1);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, [renderer2, tracker]);
        events.length = 0;
        diff(copy(temp), r2)
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(temp)))
        expect(events).to.eql([
          { wU: 1 },  { mWP: 0 }, { mWR: 1 }
        ])
      })
      it("should unmount an external node during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)))
        let called = 0;
        const temp = h(1, hooks("didUpdate", f => {
          const res = diff(null, r1);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, [renderer2, tracker]);
        events.length = 0;
        diff(copy(temp), r2)
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(temp)))
        expect(events).to.eql([
          { wU: 1 },  {mWR: 1}, {dU: 1}, { mWP: 0 }
        ])
      })
      it("should unmount a node that has not yet been rendered during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const t = h(0, hooks("willAdd", f => {
          const r = diff(m(1), null, [renderer2, tracker]);
          diff(null, r);
        }))
        diff(t, null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(renderer2.tree).to.be.null;
        expect(events).to.eql([{ wA: 0 }, { mWA: 0 }])
      })
      it("should unmount a node that has not yet been rendered during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const t = h(0, hooks("didAdd", f => {
          const r = diff(m(1), null, [renderer2, tracker]);
          diff(null, r);
        }))
        diff(t, null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(renderer2.tree).to.be.null;
        expect(events).to.eql([{ wA: 0 }, { mWA: 0 }, {dA: 0}])
      })
      it("should unmount a node that has not yet been rendered during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const t = h(0, hooks("willUpdate", f => {
          const r = diff(m(1), null, [renderer2, tracker]);
          diff(null, r);
        }))
        const r = diff(t, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(t), r);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(renderer2.tree).to.be.null
        expect(events).to.eql([{ wU: 0 }, { mWR: 0 }])
      })
      it("should unmount a node that has not yet been rendered during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const t = h(0, hooks("didUpdate", f => {
          const r = diff(m(1), null, [renderer2, tracker]);
          diff(null, r);
        }))
        const r = diff(t, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(t), r);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(t)));
        expect(renderer2.tree).to.be.null
        expect(events).to.eql([{ wU: 0 }, { mWR: 0 }, {dU:0}])
      })
      it("should properly unmount itself during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, hooks("willAdd", f => diff(null, f))), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([ { wA: 0 } ])
      })
      it("should properly unmount itself during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, hooks("didAdd", f => diff(null, f))), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([ { wA: 0 }, {mWA: 0}, {dA: 0}, {mWP: 0} ])
      })
      it("should properly unmount itself during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("willUpdate", f => diff(null, f)))
        const r = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r)
        expect(renderer.tree).to.be.null
        expect(events).to.eql([ { wU: 0 }, {mWP: 0} ])
      })
      it("should properly unmount itself during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("didUpdate", f => diff(null, f)))
        const r = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r)
        expect(renderer.tree).to.be.null
        expect(events).to.eql([ { wU: 0 }, {mWR: 0}, {dU: 0}, {mWP: 0} ])
      })
      it("should properly unmount an upstream parent during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r;
        diff(h(0, hooks("willAdd", f => r = f), [h(1, hooks("willAdd", f => {
          diff(null, r);
        }))]), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wA: 0 }, { wA: 1 }
        ])
      })
      it("should properly unmount an upstream parent during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r;
        diff(h(0, hooks("willAdd", f => r = f), [h(1, hooks("didAdd", f => {
          diff(null, r);
        }))]), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wA: 0 }, { wA: 1 }, {mWA: 0}, {mWA: 1}, {dA: 1}, {mWP: 0}, {mWP: 1}
        ])
      })
      it("should unmount an upstream parent during willAdd without rendering unvisited children", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r;
        diff(h(0, hooks("willAdd", f => r = f), [h(1, hooks("willAdd", f => {
          diff(null, r);
        }), h(2))]), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wA: 0 }, { wA: 1 }
        ])
      })
      it("should unmount an upstream parent during didAdd after rendering unvisited children", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r;
        diff(h(0, hooks("willAdd", f => r = f), [h(1, hooks("didAdd", f => {
          diff(null, r);
        }), h(2))]), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wA: 0 }, { wA: 1 }, {wA: 2}, {mWA: 0}, {mWA: 1}, {mWA: 2}, 
          {dA: 1}, {mWP: 0}, {mWP: 1}, {mWP: 2}
        ])
      })
      it("should properly unmount an upstream parent during willAdd without rendering unvisited grandchildren", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r;
        diff(h(0, hooks("willAdd", f => r = f), [h(1, hooks("willAdd", f => {
          diff(null, r);
        })), h(2, null, h(4))]), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wA: 0 }, { wA: 1 }
        ])
      })
      it("should properly unmount an upstream parent during didAdd after rendering unvisited grandchildren", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r;
        diff(h(0, hooks("willAdd", f => r = f), [h(1, hooks("didAdd", f => {
          diff(null, r);
        })), h(2, null, h(4))]), null, [renderer, tracker]);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wA: 0 }, { wA: 1 }, {wA: 2}, {wA: 4}, {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 4}, 
          {dA: 1}, {mWP: 0}, {mWP: 2}, {mWP: 4}, {mWP: 1}
        ])
      })
      it("should properly unmount an upstream parent during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r, temp; // don't code like this, i'm lazy af
        diff(temp = h(0, hooks("willAdd", f => r = f), [h(1, hooks("willUpdate", f => {
          diff(null, r);
        }))]), null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r)
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wU: 0 }, { wU: 1 }, {mWP: 0}, {mWP: 1}
        ])
      })
      it("should properly unmount an upstream parent during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r, temp; // don't code like this, i'm lazy af
        diff(temp = h(0, hooks("willAdd", f => r = f), [h(1, hooks("didUpdate", f => {
          diff(null, r);
        }))]), null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r)
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wU: 0 }, { wU: 1 }, {mWR: 0}, {mWR: 1}, {dU: 1}, {mWP: 0}, {mWP: 1}
        ])
      })
      it("should unmount an upstream parent during willUpdate without updating unvisited children", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r, temp;
        diff(temp = h(0, hooks("willAdd", f => r = f), [h(1, hooks("willUpdate", f => {
          diff(null, r);
        }), h(2))]), null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wU: 0 }, { wU: 1 },
          { mWP: 0 }, {mWP: 1}, {mWP: 2}
        ])
      })
      it("should unmount an upstream parent during didUpdate without updating unvisited children", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r, temp;
        diff(temp = h(0, hooks("willAdd", f => r = f), [h(1, hooks("didUpdate", f => {
          diff(null, r);
        }), h(2))]), null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wU: 0 }, { wU: 1 }, {wU: 2}, {mWR: 0}, {mWR: 1}, {mWR: 2}, {dU: 1},
          { mWP: 0 }, {mWP: 1}, {mWP: 2}
        ])
      })
      it("should properly unmount an upstream parent during willUpdate without rendering unvisited grandchildren", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r, temp;
        diff(temp = h(0, hooks("willAdd", f => r = f), [h(1, hooks("willUpdate", f => {
          diff(null, r);
        })), h(2, null, h(4))]), null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wU: 0 }, { wU: 1 },
          { mWP: 0 }, {mWP: 2}, {mWP: 4}, {mWP: 1}
        ])
      })
      it("should properly unmount an upstream parent during didUpdate without rendering unvisited grandchildren", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        let r, temp;
        diff(temp = h(0, hooks("willAdd", f => r = f), [h(1, hooks("didUpdate", f => {
          diff(null, r);
        })), h(2, null, h(4))]), null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), r);
        expect(renderer.tree).to.be.null;
        expect(events).to.eql([
          { wU: 0 }, { wU: 1 }, {wU: 2}, {wU: 4}, {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 4}, {dU: 1},
          { mWP: 0 }, {mWP: 2}, {mWP: 4}, {mWP: 1}
        ])
      })
      it("should unmount multiple nodes in call order during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer1 = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot1 = diff(h(1), null, [renderer1, tracker]);
        const extRoot2 = diff(h(2), null, [renderer2, tracker]);
        const extRoot3 = diff(h(3), null, [renderer3, tracker]);
        expect(renderer1.tree).to.eql(renderer1.renderStatic(h(1)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(2)))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(3)))
        let called = 0;
        const temp = h(4, hooks("willAdd", f => {
          expect(diff(null, extRoot1)).to.be.true;
          expect(diff(null, extRoot2)).to.be.true;
          expect(diff(null, extRoot3)).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer1.tree).to.be.null
        expect(renderer2.tree).to.be.null
        expect(renderer3.tree).to.be.null
        expect(events).to.eql([
          {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {wA: 3}, { mWA: 3},
          { wA: 4}, {mWP: 1}, {mWP: 2}, {mWP: 3}, {mWA: 4}
        ])
      })
      it("should unmount multiple nodes in call order during didAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer1 = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot1 = diff(h(1), null, [renderer1, tracker]);
        const extRoot2 = diff(h(2), null, [renderer2, tracker]);
        const extRoot3 = diff(h(3), null, [renderer3, tracker]);
        expect(renderer1.tree).to.eql(renderer1.renderStatic(h(1)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(2)))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(3)))
        let called = 0;
        const temp = h(4, hooks("didAdd", f => {
          expect(diff(null, extRoot1)).to.be.true;
          expect(diff(null, extRoot2)).to.be.true;
          expect(diff(null, extRoot3)).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer1.tree).to.be.null
        expect(renderer2.tree).to.be.null
        expect(renderer3.tree).to.be.null
        expect(events).to.eql([
          {wA: 1}, { mWA: 1 }, {wA: 2}, {mWA: 2}, {wA: 3}, { mWA: 3},
          { wA: 4}, {mWA: 4}, {dA: 4}, {mWP: 1}, {mWP: 2}, {mWP: 3}
        ])
      })
      it("should unmount multiple nodes in call order during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer1 = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot1 = diff(h(1), null, [renderer1, tracker]);
        const extRoot2 = diff(h(2), null, [renderer2, tracker]);
        const extRoot3 = diff(h(3), null, [renderer3, tracker]);
        expect(renderer1.tree).to.eql(renderer1.renderStatic(h(1)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(2)))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(3)))
        let called = 0;
        const temp = h(4, hooks("willUpdate", f => {
          expect(diff(null, extRoot1)).to.be.true;
          expect(diff(null, extRoot2)).to.be.true;
          expect(diff(null, extRoot3)).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer1.tree).to.be.null
        expect(renderer2.tree).to.be.null
        expect(renderer3.tree).to.be.null
        expect(events).to.eql([
          {wU: 4}, { mWP: 1 }, { mWP: 2 }, { mWP: 3 }, {mWR: 4}
        ])
      })
      it("should unmount multiple nodes in call order during didUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer1 = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot1 = diff(h(1), null, [renderer1, tracker]);
        const extRoot2 = diff(h(2), null, [renderer2, tracker]);
        const extRoot3 = diff(h(3), null, [renderer3, tracker]);
        expect(renderer1.tree).to.eql(renderer1.renderStatic(h(1)))
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(2)))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(3)))
        let called = 0;
        const temp = h(4, hooks("didUpdate", f => {
          expect(diff(null, extRoot1)).to.be.true;
          expect(diff(null, extRoot2)).to.be.true;
          expect(diff(null, extRoot3)).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer1.tree).to.be.null
        expect(renderer2.tree).to.be.null
        expect(renderer3.tree).to.be.null
        expect(events).to.eql([
          {wU: 4}, {mWR: 4}, {dU: 4}, { mWP: 1 }, { mWP: 2 }, { mWP: 3 }
        ])
      })
      it("should rebase all entangled affects during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot = diff(h(1, null, h(2)), null, [renderer, tracker]);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(extRoot), affectedRoot2.sub(extRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(1, null, h(2))))
        let called = 0;
        const temp = h(8, hooks("willAdd", f => {
          const res = diff(null, extRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wA: 1}, {wA: 2}, {mWA: 1}, { mWA: 2 }, 
          {wA: 3}, {wA: 4}, {mWA: 3}, {mWA: 4},
          {wA: 5}, {wA: 6}, {wA: 7}, {mWA: 5}, {mWA:6}, {mWA: 7},
          {wA: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWA: 8}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
      it("should not rebase laggard entangled affects during willAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot = diff(h(1, null, h(2)), null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(1, null, h(2))))
        let called = 0;
        const temp = h(8, hooks("willAdd", f => {
          const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
          const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
          affectedRoot1.sub(extRoot), affectedRoot2.sub(extRoot.next);
          const res = diff(null, extRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wA: 1}, {wA: 2}, {mWA: 1}, { mWA: 2 },
          {wA: 8}, {wA: 5}, {wA: 6}, {wA: 7}, {wA: 3}, {wA: 4}, 
          {mWP: 1}, {mWP: 2}, {mWA: 8}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWA:6}, {mWA: 7}
        ])
      })
      it("should rebase all entangled affects during didAdd", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot = diff(h(1, null, h(2)), null, [renderer, tracker]);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(extRoot), affectedRoot2.sub(extRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(1, null, h(2))))
        let called = 0;
        const temp = h(8, hooks("didAdd", f => {
          const res = diff(null, extRoot);
          expect(res).to.be.true;
          called++;
        }));
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wA: 1}, {wA: 2}, {mWA: 1}, { mWA: 2 }, 
          {wA: 3}, {wA: 4}, {mWA: 3}, {mWA: 4},
          {wA: 5}, {wA: 6}, {wA: 7}, {mWA: 5}, {mWA:6}, {mWA: 7},
          {wA: 8}, {mWA: 8}, {dA: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
      it("should rebase all entangled affects during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot = diff(h(1, null, h(2)), null, [renderer, tracker]);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(extRoot), affectedRoot2.sub(extRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(1, null, h(2))))
        let called = 0;
        const temp = h(8, hooks("willUpdate", f => {
          const res = diff(null, extRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wU: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWR: 8}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
      it("should not rebase laggard entangled affects during willUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot = diff(h(1, null, h(2)), null, [renderer, tracker]);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(1, null, h(2))))
        let called = 0;
        const temp = h(8, hooks("willUpdate", f => {
          const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
          const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
          affectedRoot1.sub(extRoot), affectedRoot2.sub(extRoot.next);
          const res = diff(null, extRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wU: 8}, {wA: 5}, {wA: 6}, {wA: 7}, {wA: 3}, {wA: 4},
          {mWP: 1}, {mWP: 2}, {mWR: 8}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWA: 6}, {mWA: 7}
        ])
      })
      it("should rebase all entangled affects during didUpdate", function(){
        const events = [], tracker = new Tracker(events);
        const renderer = new LCRSRenderer, renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const extRoot = diff(h(1, null, h(2)), null, [renderer, tracker]);
        const affectedRoot1 = diff(h(3, null, h(4)), null, [renderer2, tracker]);
        const affectedRoot2 = diff(h(5, null, [h(6), h(7)]), null, [renderer3, tracker]);
        affectedRoot1.sub(extRoot), affectedRoot2.sub(extRoot.next);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(1, null, h(2))))
        let called = 0;
        const temp = h(8, hooks("didUpdate", f => {
          const res = diff(null, extRoot);
          expect(res).to.be.true;
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.be.null;
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(3, null, h(4))))
        expect(renderer3.tree).to.eql(renderer3.renderStatic(h(5, null, [h(6), h(7)])))
        expect(events).to.eql([
          {wU: 8}, {mWR: 8}, {dU: 8}, {wU: 3}, {wU: 4}, {wU: 5}, {wU: 6}, {wU: 7},
          {mWP: 1}, {mWP: 2}, {mWR: 4}, {mWR: 6}, {mWR: 7}
        ])
      })
    })
  })
  describe("updating (outer-diffs)", function(){
    describe("virtual (managed) nodes", function(){
      it("should not update nodes during a constructor", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedR = diff(h(1), null, r);
        diff(h(1, hooks("ctor", f => {
          const res = diff(h(1, {some:"data"}), managedR);
          expect(res).to.be.false;
          called++
        })))
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not update nodes during cleanup", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedR = diff(h(1), null, r);
        const f = diff(h(1, hooks("cleanup", f => {
          const res = diff(h(1, {some:"data"}), managedR);
          expect(res).to.be.false;
          called++
        })))
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not update nodes during add mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        diff(h(2), null, {add: f => {
          const res = diff(h(1, {some: "data"}), m);
          expect(res).to.be.false;
          called++
        }})
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not update nodes during remove mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        const f = diff(h(2), null, {remove: f => {
          const res = diff(h(1, {some: "data"}), m);
          expect(res).to.be.false;
          called++
        }})
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not update nodes during temp mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        const f = diff(h(2), null, {temp: f => {
          const res = diff(h(1, {some: "data"}), m);
          expect(res).to.be.false;
          called++
        }})
        diff(h(2), f)
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not update nodes during move mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const m = diff(h(1), null, r);
        const f = diff(h(2, null, [k(3), k(4)]), null, {move: f => {
          if (f.temp.data.id === 4){
            const res = diff(h(1, {some: "data"}), m);
            expect(res).to.be.false;
            called++
          }
        }})
        diff(h(2, null, [k(4), k(3)]), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should rebase itself onto the path when updating itself during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedTemp = h(1, hooks("willAdd", f => {
          const temp = h(1, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        diff(managedTemp, null, r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {wU: 1}, {mWA: 1}])
      })
      it("should rebase itself onto the path when updating itself during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedTemp = h(1, hooks("didAdd", f => {
          const temp = h(1, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        diff(managedTemp, null, r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}, {dA: 1}, {wU: 1}, {mWR: 1}])
      })
      it("should call didAdd once and not call didUpdate if rebasing itself during willAdd", function(){
        let calledAdd = 0, calledUpd = 0, calledDidUpd = 0, calledDidAdd = 0;
        const events = [], tracker = new Tracker(events);
        const hooks = {
          didUpdate: f => {
            calledDidUpd++;
          },
          willAdd: f => {
            calledAdd++;
            diff(copy(f.temp), f);
          },
          didAdd: f => {
            calledDidAdd++
          },
          willUpdate: f => {
            calledUpd++;
          }
        }
        const f = diff(h(0, hooks), null, tracker);
        expect(calledUpd).to.equal(1);
        expect(calledAdd).to.equal(1);
        expect(calledDidUpd).to.equal(0);
        expect(calledDidAdd).to.equal(1);
        expect(events).to.eql([{wA: 0}, {wU: 0}, {mWA: 0}, {dA: 0}])
      })
      it("should rebase its parent and itself onto the path when updating the parent during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        let parent;
        const managedTemp = h(1, hooks("ctor", f => parent = f), h(2, hooks("willAdd", f => {
          const temp = h(1, {some: "data"}, h(2));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })))
        diff(managedTemp, null, r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}, h(2)))));
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1}, {wA: 2},
          {wU: 1}, {wU: 2}, {mWA: 1}, {mWA: 2}
        ])
      })
      it("should rebase its parent and itself but not laggard siblings when updating the parent during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        let parent;
        const managedTemp = h(1, hooks("ctor", f => parent = f), [h(2, hooks("willAdd", f => {
          const temp = h(1, {some: "data"}, [h(2),h(3)]);
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })), h(3)])
        diff(managedTemp, null, r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}, [h(2), h(3)]))));
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1}, {wA: 2},
          {wU: 1}, {wU: 2}, {wA: 3}, {mWA: 1}, {mWA: 2}, {mWA: 3}
        ])
      })
      it("should rebase its parent and itself onto the path when updating the parent during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        let parent;
        const managedTemp = h(1, hooks("ctor", f => parent = f), h(2, hooks("didAdd", f => {
          const temp = h(1, {some: "data"}, h(2));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })))
        diff(managedTemp, null, r);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}, h(2)))));
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1}, {wA: 2}, {mWA: 1}, {mWA: 2}, {dA: 2},
          {wU: 1}, {wU: 2}, {mWR: 1}, {mWR: 2}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r = diff(h(0, null), null, [renderer, tracker]);
        const a = diff(h(1), null, r); // affector
        const affectTemp = h(2, hooks("willAdd", f => {
          f.sub(a);
          const temp = h(1, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        diff(affectTemp, null, [renderer2, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}, 
          {wA: 2}, {wU: 1}, {wU: 2}, {mWA: 2}, {mWR: 1}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r = diff(h(0, null), null, [renderer, tracker]);
        const a = diff(h(1), null, r); // affector
        const affectTemp = h(2, hooks("didAdd", f => {
          f.sub(a);
          const temp = h(1, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        diff(affectTemp, null, [renderer2, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}, 
          {wA: 2}, {mWA: 2}, {dA: 2}, {wU: 1}, {wU: 2}, {mWR: 1}
        ])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const data = {some: 'data'}
        const temp = h(0, hooks("willAdd", f => {
          const managed = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, f);
          expect(managed).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), managed);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        diff(temp, null, [renderer, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), h(1, data))));
        expect(events).to.eql([{wA: 0}, {wA: 1}, {mWA: 0}, {mWA: 1}])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const data = {some: 'data'}
        const temp = h(0, hooks("didAdd", f => {
          const managed = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, f);
          expect(managed).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), managed);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        diff(temp, null, [renderer, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), h(1, data))));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {dA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should rebase nodes that are not in the path when updating them during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1), null, r1);
        const newTemp = h(1, {some:"data"});
        const temp = h(2, hooks("willAdd", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        events.length = 0;
        diff(temp, null, [renderer2, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, newTemp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wA: 2}, {wU: 1}, {mWA: 2}, {mWR: 1}])
      })
      it("should rebase nodes that are not in the path when updating them during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1), null, r1);
        const newTemp = h(1, {some:"data"});
        const temp = h(2, hooks("didAdd", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        events.length = 0;
        diff(temp, null, [renderer2, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, newTemp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wA: 2}, {mWA: 2}, {dA: 2}, {wU: 1}, {mWR: 1}])
      })
      it("should rebase itself onto the path when updating itself during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedTemp = h(1, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(managedTemp, null, r);
        events.length = 0;
        diff(copy(managedTemp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(events).to.eql([{wU: 1}, {wU: 1}, {mWR: 1}])
      })
      it("should rebase itself onto the path when updating itself during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        const managedTemp = h(1, hooks("didUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(managedTemp, null, r);
        events.length = 0;
        diff(copy(managedTemp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(events).to.eql([{wU: 1}, {mWR: 1}, {dU: 1}, {wU: 1}, {mWR: 1}, {dU: 1}])
      })
      it("should call didUpdate once and not call didAdd during the update if rebasing itself during willUpdated", function(){
        let calledAdd = 0, calledUpd = 0, calledDidUpd = 0, calledDidAdd = 0;
        const events = [], tracker = new Tracker(events);
        const hooks = {
          didUpdate: f => {
            calledDidUpd++;
          },
          willAdd: f => {
            calledAdd++;
          },
          didAdd: f => {
            calledDidAdd++
          },
          willUpdate: f => {
            if (!calledUpd++)
              diff(copy(f.temp), f);
          }
        }
        const f = diff(h(0, hooks), null, tracker);
        events.length = 0;
        diff(copy(f.temp), f);
        expect(calledUpd).to.equal(2);
        expect(calledAdd).to.equal(1);
        expect(calledDidUpd).to.equal(1);
        expect(calledDidAdd).to.equal(1);
        expect(events).to.eql([{wU: 0}, {wU: 0}, {mWR: 0}, {dU: 0}])
      })
      it("should rebase its parent and itself onto the path when updating the parent during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        let parent;
        const managedTemp = h(1, hooks("ctor", f => parent = f), h(2, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"}, h(2));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })))
        const f = diff(managedTemp, null, r);
        events.length = 0;
        diff(copy(managedTemp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}, h(2)))));
        expect(events).to.eql([
          {wU: 1}, {wU: 2}, {wU: 1}, {wU: 2},
          {mWR: 1}, {mWR: 2}
        ])
      })
      it("should rebase its parent and itself but not laggard siblings when updating the parent during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        let parent;
        const managedTemp = h(1, hooks("ctor", f => parent = f), [h(2, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"}, [h(2), h(3)]);
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        }))])
        const f = diff(managedTemp, null, r);
        events.length = 0;
        const temp = copy(managedTemp);
        temp.next.push(h(3));
        diff(temp, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}, [h(2), h(3)]))));
        expect(events).to.eql([
          {wU: 1}, {wU: 2}, {wU: 1}, {wU: 2}, {wA: 3},
          {mWR: 1}, {mWR: 2}, {mWA: 3}
        ])
      })
      it("should rebase its parent and itself onto the path when updating the parent during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, null), null, [renderer, tracker]);
        let parent;
        const managedTemp = h(1, hooks("ctor", f => parent = f), h(2, hooks("didUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"}, h(2));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })))
        const f = diff(managedTemp, null, r);
        events.length = 0;
        diff(copy(managedTemp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}, h(2)))));
        expect(events).to.eql([
          {wU: 1}, {wU: 2}, {mWR: 1}, {mWR: 2}, {dU: 2},
          {wU: 1}, {wU: 2}, {mWR: 1}, {mWR: 2}, {dU: 2}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r = diff(h(0, null), null, [renderer, tracker]);
        const a = diff(h(1), null, r); // affector
        const affectTemp = h(2, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(affectTemp, null, [renderer2, tracker]);
        f.sub(a);
        events.length = 0;
        diff(h(1), a);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wU: 1}, {wU: 2}, {wU: 1}, {wU: 2}, {mWR: 1}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r = diff(h(0, null), null, [renderer, tracker]);
        const a = diff(h(1), null, r); // affector
        const affectTemp = h(2, hooks("didUpdate", f => {
          if (called) return;
          const temp = h(1, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(affectTemp, null, [renderer2, tracker]);
        f.sub(a);
        events.length = 0;
        diff(h(1), a);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, h(1, {some: "data"}))));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wU: 1}, {wU: 2}, {mWR: 1}, {dU: 2},
          {wU: 1}, {wU: 2}, {mWR: 1}, {dU: 2}
        ])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const data = {some: 'data'}
        const temp = h(0, hooks("willUpdate", f => {
          const managed = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, f);
          expect(managed).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), managed);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), h(1, data))));
        expect(events).to.eql([{wU: 0}, {wA: 1}, {mWR: 0}, {mWA: 1}])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const data = {some: 'data'}
        const temp = h(0, hooks("didUpdate", f => {
          const managed = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, f);
          expect(managed).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), managed);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), h(1, data))));
        expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not rebase nodes that are in the path, but should update their input temp when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp1 = h(1, {some: "data"});
        const temp2 = h(1, {other: "new data"});
        const hooks = {
          willAdd: f => {
            f.managed = diff(h(1), null, f);
          },
          willUpdate: f => {
            const res1 = diff(temp1, f.managed);
            expect(res1).to.equal(f.managed);
            expect(res1.temp).to.equal(temp1);
            const res2 = diff(temp2, f.managed);
            expect(res2).to.equal(f.managed);
            expect(res2.temp).to.equal(temp2);
            called++;
          }
        }
        const temp = h(0, hooks);
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), temp2)));
        expect(events).to.eql([{wU: 0}, {wU: 1}, {mWR: 0}, {mWR: 1}])
      })
      it("should not rebase nodes that are in the path, but should update their input temp when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp1 = h(1, {some: "data"});
        const temp2 = h(1, {other: "new data"});
        const hooks = {
          didUpdate: f => {
            f.managed = diff(h(1), null, f);
            const res1 = diff(temp1, f.managed);
            expect(res1).to.equal(f.managed);
            expect(res1.temp).to.equal(temp1);
            const res2 = diff(temp2, f.managed);
            expect(res2).to.equal(f.managed);
            expect(res2.temp).to.equal(temp2);
            called++;
          }
        }
        const temp = h(0, hooks);
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(inject(copy(temp), temp2)));
        expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should rebase nodes that are not in the path when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1), null, r1);
        const newTemp = h(1, {some:"data"});
        const temp = h(2, hooks("willUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const r3 = diff(temp, null, [renderer2, tracker])
        events.length = 0;
        diff(copy(temp), r3);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, newTemp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wU: 2}, {wU: 1}, {mWR: 2}, {mWR: 1}])
      })
      it("should rebase nodes that are not in the path when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1), null, r1);
        const newTemp = h(1, {some:"data"});
        const temp = h(2, hooks("didUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const r3 = diff(temp, null, [renderer2, tracker])
        events.length = 0;
        diff(copy(temp), r3);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, newTemp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wU: 2}, {mWR: 2}, {dU: 2}, {wU: 1}, {mWR: 1}])
      })
      it("should properly rebase nodes that used to be in the path when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const newTemp = h(1, {some: "data"});
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1), null, r1);
        const temp = h(2, hooks("willUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const r3 = diff(temp, null, r1)
        r2.sub(r1), r3.sub(r1); //order matters here
        events.length = 0;
        diff(h(0, null), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [copy(temp), newTemp])));
        expect(events).to.eql([{wU: 0}, {wU: 1}, {wU: 2}, {wU: 1}, {mWR: 0}, {mWR: 1}])
      })
      it("should properly rebase nodes that used to be in the path when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const newTemp = h(1, {some: "data"});
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1), null, r1);
        const temp = h(2, hooks("didUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const r3 = diff(temp, null, r1)
        r2.sub(r1), r3.sub(r1); //order matters here
        events.length = 0;
        diff(h(0, null), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [copy(temp), newTemp])));
        expect(events).to.eql([{wU: 0}, {wU: 1}, {wU: 2}, {mWR: 0}, {dU: 2}, {wU: 1}, {mWR: 1}])
      })
      it("should properly rebase portions of a subtree that are not in the path when updating the subtree during willUpdate", function(){
        let called = 0
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const newTemp = h(1, {some: "data"}, h(3, {other: "new data"}));
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1, null, h(3, hooks("willUpdate", f => {
          expect(f.temp.data).to.equal(newTemp.next.data)
          called++
        }))), null, r1);
        const temp = h(2, hooks("willUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          called++
        }))
        const r3 = diff(temp, null, r1)
        r2.sub(r1), r3.sub(r1);
        r2.next.sub(r3);
        events.length = 0;
        diff(h(0, null), r1);
        expect(called).to.equal(2)
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [copy(temp), newTemp])));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {wU: 1}, {wU: 3}, 
          {mWR: 0}, {mWR: 3}, {mWR: 1}
        ])
      })
      it("should properly rebase portions of a subtree that are not in the path when updating the subtree during didUpdate", function(){
        let called = 0, calledDidUpd = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const newTemp = h(1, {some: "data"}, h(3, {other: "new data"}));
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const r2 = diff(h(1, null, h(3, hooks("willUpdate", f => {
          if (called++) expect(f.temp.data).to.equal(newTemp.next.data);
        }))), null, r1);
        const temp = h(2, hooks("didUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          calledDidUpd++
        }))
        const r3 = diff(temp, null, r1)
        r2.sub(r1), r3.sub(r1);
        r2.next.sub(r3);
        events.length = 0;
        diff(h(0, null), r1);
        expect(called).to.equal(2)
        expect(calledDidUpd).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [copy(temp), newTemp])));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {wU: 3},
          {mWR: 0}, {mWR: 3}, {dU: 2}, {wU: 1}, {wU: 3}, {mWR: 1}, {mWR: 3}
        ])
      })
      it("should move multiple nodes during willAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("willAdd", f => {
          expect(diff(managedRoot1.temp, managedRoot1, managedRoot3)).to.equal(managedRoot1);
          expect(diff(managedRoot2.temp, managedRoot2, managedRoot3)).to.equal(managedRoot2);
          expect(diff(managedRoot3.temp, managedRoot3, managedRoot1)).to.equal(managedRoot3);
          called++;
        }));
        events.length = 0;
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(2), h(1), h(3)])))
        expect(events).to.eql([
          { wA: 4}, {mWA: 4}, {mWM: 2}
        ])
      })
      it("should move multiple nodes during didAdd", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("didAdd", f => {
          expect(diff(managedRoot1.temp, managedRoot1, managedRoot3)).to.equal(managedRoot1);
          expect(diff(managedRoot2.temp, managedRoot2, managedRoot3)).to.equal(managedRoot2);
          expect(diff(managedRoot3.temp, managedRoot3, managedRoot1)).to.equal(managedRoot3);
          called++;
        }));
        events.length = 0;
        diff(temp, null, tracker);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(2), h(1), h(3)])))
        expect(events).to.eql([
          { wA: 4}, {mWA: 4}, {dA: 4}, {mWM: 2}
        ])
      })
      it("should move multiple nodes during willUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("willUpdate", f => {
          expect(diff(managedRoot1.temp, managedRoot1, managedRoot3)).to.equal(managedRoot1);
          expect(diff(managedRoot2.temp, managedRoot2, managedRoot3)).to.equal(managedRoot2);
          expect(diff(managedRoot3.temp, managedRoot3, managedRoot1)).to.equal(managedRoot3);
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(2), h(1), h(3)])))
        expect(events).to.eql([
          { wU: 4}, {mWR: 4}, {mWM: 2}
        ])
      })
      it("should move multiple nodes during didUpdate", function(){
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r1 = diff(h(0, null), null, [renderer, tracker]);
        const managedRoot1 = diff(h(1), null, r1);
        const managedRoot2 = diff(h(2), null, r1, managedRoot1);
        const managedRoot3 = diff(h(3), null, r1, managedRoot2);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(1), h(2), h(3)])))
        let called = 0;
        const temp = h(4, hooks("didUpdate", f => {
          expect(diff(managedRoot1.temp, managedRoot1, managedRoot3)).to.equal(managedRoot1);
          expect(diff(managedRoot2.temp, managedRoot2, managedRoot3)).to.equal(managedRoot2);
          expect(diff(managedRoot3.temp, managedRoot3, managedRoot1)).to.equal(managedRoot3);
          called++;
        }));
        const r2 = diff(temp, null, tracker);
        events.length = 0;
        diff(copy(temp), r2);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, null, [h(2), h(1), h(3)])))
        expect(events).to.eql([
          { wU: 4}, {mWR: 4}, {dU: 4}, {mWM: 2}
        ])
      })
    })
    describe("free (unmanaged) nodes", function(){
      it("should not update nodes during a constructor", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        diff(h(1, hooks("ctor", f => {
          const res = diff(h(0, {some: "data"}), r);
          expect(res).to.be.false;
          called++
        })))
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not update nodes during cleanup", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1, hooks("ctor", f => {
          const res = diff(h(0, {some: "data"}), r);
          expect(res).to.be.false;
          called++
        })))
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not update nodes during add mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        diff(h(1), null, {add: f => {
          const res = diff(h(0, {some: "data"}), r);
          expect(res).to.be.false;
          called++
        }})
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not update nodes during remove mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1), null, {remove: f => {
          const res = diff(h(0, {some: "data"}), r);
          expect(res).to.be.false;
          called++
        }})
        diff(null, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not update nodes during temp mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1), null, {temp: f => {
          const res = diff(h(0, {some: "data"}), r);
          expect(res).to.be.false;
          called++
        }})
        diff(h(1), f)
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should not update nodes during move mutation event", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0), null, [renderer, tracker]);
        const f = diff(h(1, null, [k(2), k(3)]), null, {move: f => {
          if (f.temp.data.id === 3){
            const res = diff(h(0, {some: "data"}), r);
            expect(res).to.be.false;
            called++
          }
        }})
        diff(h(1, null, [k(3), k(2)]), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(events).to.eql([{wA: 0}, {mWA: 0}])
      })
      it("should rebase itself onto the path when updating itself during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const managedTemp = h(0, hooks("willAdd", f => {
          const temp = h(0, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        diff(managedTemp, null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(events).to.eql([{wA: 0}, {wU: 0}, {mWA: 0}])
      })
      it("should rebase itself onto the path when updating itself during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const managedTemp = h(0, hooks("didAdd", f => {
          const temp = h(0, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        diff(managedTemp, null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {dA: 0}, {wU: 0}, {mWR: 0}])
      })
      it("should rebase its parent and itself onto the path when updating the parent during willAdd", function(){
        let called = 0, parent;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, hooks("ctor", f => parent = f), h(1, hooks("willAdd", f => {
          const temp = h(0, {some: "data"}, h(1));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        }))), null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"}, h(1))));
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wU: 0}, {wU: 1},
          {mWA: 0}, {mWA: 1}
        ])
      })
      it("should rebase its parent and itself but not laggard siblings when updating the parent during willAdd", function(){
        let called = 0, parent;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, hooks("ctor", f => parent = f), [h(1, hooks("willAdd", f => {
          const temp = h(0, {some: "data"}, [h(1), h(2)]);
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })), h(2)]), null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"}, [h(1), h(2)])));
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {wU: 0}, {wU: 1}, {wA: 2},
          {mWA: 0}, {mWA: 1}, {mWA: 2}
        ])
      })
      it("should rebase its parent and itself onto the path when updating the parent during didAdd", function(){
        let called = 0, parent;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const r = diff(h(0, hooks("ctor", f => parent = f), h(1, hooks("didAdd", f => {
          const temp = h(0, {some: "data"}, h(1));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        }))), null, [renderer, tracker]);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"}, h(1))));
        expect(events).to.eql([
          {wA: 0}, {wA: 1}, {mWA: 0}, {mWA: 1}, {dA: 1},
          {wU: 0}, {wU: 1}, {mWR: 0}, {mWR: 1}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const a = diff(h(0), null, [renderer, tracker]);
        const affectTemp = h(1, hooks("willAdd", f => {
          f.sub(a);
          const temp = h(0, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }));
        diff(affectTemp, null, [renderer2, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1},
          {wU: 0}, {wU: 1}, {mWA: 1}, {mWR: 0}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const a = diff(h(0), null, [renderer, tracker]);
        const affectTemp = h(1, hooks("didAdd", f => {
          f.sub(a);
          const temp = h(0, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }));
        diff(affectTemp, null, [renderer2, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}, {dA: 1},
          {wU: 0}, {wU: 1}, {mWR: 0}
        ])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer
        const data = {some: 'data'}
        const temp = h(0, hooks("willAdd", f => {
          const r = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, [renderer2, tracker]);
          expect(r).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), r);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        diff(temp, null, [renderer, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(1, data)))
        expect(events).to.eql([{wA: 0}, {wA: 1}, {mWA: 0}, {mWA: 1}])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer
        const data = {some: 'data'}
        const temp = h(0, hooks("didAdd", f => {
          const r = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, [renderer2, tracker]);
          expect(r).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), r);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        diff(temp, null, [renderer, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(1, data)))
        expect(events).to.eql([{wA: 0}, {mWA: 0}, {dA: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should rebase nodes that are not in the path when updating them during willAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        const newTemp = h(0, {some:"data"});
        const temp = h(1, hooks("willAdd", f => {
          const res = diff(newTemp, r1);
          expect(res).to.equal(r1)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        events.length = 0;
        diff(temp, null, [renderer2, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(newTemp));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wA: 1}, {wU: 0}, {mWA: 1}, {mWR: 0}])
      })
      it("should rebase nodes that are not in the path when updating them during didAdd", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        const newTemp = h(0, {some:"data"});
        const temp = h(1, hooks("didAdd", f => {
          const res = diff(newTemp, r1);
          expect(res).to.equal(r1)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        events.length = 0;
        diff(temp, null, [renderer2, tracker])
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(newTemp));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wA: 1}, {mWA: 1}, {dA: 1}, {wU: 0}, {mWR: 0}])
      })
      it("should rebase itself onto the path when updating itself during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(events).to.eql([{wU: 0}, {wU: 0}, {mWR: 0}])
      })
      it("should rebase itself onto the path when updating itself during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("didUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"});
          const res = diff(temp, f);
          expect(res).to.equal(f);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wU: 0}, {mWR: 0}, {dU: 0}])
      })
      it("should rebase its parent and itself onto the path when updating the parent during willUpdate", function(){
        let called = 0, parent;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("ctor", f => parent = f), h(1, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"}, h(1));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })))
        const f = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"}, h(1))));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 0}, {wU: 1},
          {mWR: 0}, {mWR: 1}
        ])
      })
      it("should rebase its parent and itself but not laggard siblings when updating the parent during willUpdate", function(){
        let called = 0, parent;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("ctor", f => parent = f), [h(1, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"}, [h(1), h(2)]);
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        }))])
        const f = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        const copyTemp = copy(temp);
        copyTemp.next.push(h(2));
        diff(copyTemp, f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"}, [h(1), h(2)])));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 0}, {wU: 1}, {wA: 2},
          {mWR: 0}, {mWR: 1}, {mWA: 2}
        ])
      })
      it("should rebase its parent and itself onto the path when updating the parent during didUpdate", function(){
        let called = 0, parent;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const temp = h(0, hooks("ctor", f => parent = f), h(1, hooks("didUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"}, h(1));
          const res = diff(temp, parent);
          expect(res).to.equal(parent);
          expect(res.temp).to.equal(temp);
          called++;
        })))
        const f = diff(temp, null, [renderer, tracker]);
        events.length = 0;
        diff(copy(temp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"}, h(1))));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {mWR: 0}, {mWR: 1}, {dU: 1},
          {wU: 0}, {wU: 1}, {mWR: 0}, {mWR: 1}, {dU: 1}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const a = diff(h(0), null, [renderer, tracker]); // affector
        const affectTemp = h(1, hooks("willUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(affectTemp, null, [renderer2, tracker]);
        f.sub(a);
        events.length = 0;
        diff(h(0), a);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 0}, {wU: 1}, {mWR: 0}
        ])
      })
      it("should rebase an affector and itself onto the path when updating the affector during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const a = diff(h(0), null, [renderer, tracker]); // affector
        const affectTemp = h(1, hooks("didUpdate", f => {
          if (called) return;
          const temp = h(0, {some: "data"});
          const res = diff(temp, a);
          expect(res).to.equal(a);
          expect(res.temp).to.equal(temp);
          called++;
        }))
        const f = diff(affectTemp, null, [renderer2, tracker]);
        f.sub(a);
        events.length = 0;
        diff(h(0), a);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0, {some: "data"})));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(copy(affectTemp)))
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {mWR: 0}, {dU: 1},
          {wU: 0}, {wU: 1}, {mWR: 0}, {dU: 1}
        ])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer
        const data = {some: 'data'}
        const temp = h(0, hooks("willUpdate", f => {
          const r = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, [renderer2, tracker]);
          expect(r).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), r);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(1, data)))
        expect(events).to.eql([{wU: 0}, {wA: 1}, {mWR: 0}, {mWA: 1}])
      })
      it("should not rebase laggard nodes, but should update their input temp when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer
        const data = {some: 'data'}
        const temp = h(0, hooks("didUpdate", f => {
          const r = diff(h(1, hooks("willAdd", f => {
            expect(f.temp).to.eql(h(1, data));
            called++;
          })), null, [renderer2, tracker]);
          expect(r).to.be.an.instanceOf(Frame);
          const res = diff(h(1, data), r);
          expect(res).to.be.an.instanceOf(Frame);
        }))
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(h(1, data)))
        expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should not rebase nodes that are in the path, but should update their input temp when updating them during willUpdate", function(){
        let called = 0, r;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const temp1 = h(1, {some: "data"});
        const temp2 = h(1, {other: "new data"});
        const hooks = {
          willAdd: f => {
            r = diff(h(1), null, [renderer2, tracker]);
          },
          willUpdate: f => {
            const res1 = diff(temp1, r);
            expect(res1).to.equal(r);
            expect(res1.temp).to.equal(temp1);
            const res2 = diff(temp2, r);
            expect(res2).to.equal(r);
            expect(res2.temp).to.equal(temp2);
            called++;
          }
        }
        const temp = h(0, hooks);
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp2));
        expect(events).to.eql([{wU: 0}, {wU: 1}, {mWR: 0}, {mWR: 1}])
      })
      it("should not rebase nodes that are in the path, but should update their input temp when updating them during didUpdate", function(){
        let called = 0, r;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const temp1 = h(1, {some: "data"});
        const temp2 = h(1, {other: "new data"});
        const hooks = {
          didUpdate: f => {
            const r = diff(h(1), null, [renderer2, tracker]);
            const res1 = diff(temp1, r);
            expect(res1).to.equal(r);
            expect(res1.temp).to.equal(temp1);
            const res2 = diff(temp2, r);
            expect(res2).to.equal(r);
            expect(res2.temp).to.equal(temp2);
            called++;
          }
        }
        const temp = h(0, hooks);
        const r1 = diff(temp, null, [renderer, tracker])
        events.length = 0;
        diff(copy(temp), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(copy(temp)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp2));
        expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wA: 1}, {mWA: 1}])
      })
      it("should rebase nodes that are not in the path when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        const newTemp = h(0, {some:"data"});
        const temp = h(1, hooks("willUpdate", f => {
          const res = diff(newTemp, r1);
          expect(res).to.equal(r1)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const f = diff(temp, null, [renderer2, tracker])
        events.length = 0;
        diff(copy(temp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(newTemp));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wU: 1}, {wU: 0}, {mWR: 1}, {mWR: 0}])
      })
      it("should rebase nodes that are not in the path when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer;
        const r1 = diff(h(0), null, [renderer, tracker]);
        const newTemp = h(0, {some:"data"});
        const temp = h(1, hooks("didUpdate", f => {
          const res = diff(newTemp, r1);
          expect(res).to.equal(r1)
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const f = diff(temp, null, [renderer2, tracker])
        events.length = 0;
        diff(copy(temp), f);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(newTemp));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(temp))
        expect(events).to.eql([{wU: 1}, {mWR: 1}, {dU: 1}, {wU: 0}, {mWR: 0}])
      })
      it("should properly rebase nodes that used to be in the path when updating them during willUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const newTemp = h(1, {some: "data"});
        const r1 = diff(h(0), null, [renderer, tracker]);
        const r2 = diff(h(1), null, [renderer2, tracker]);
        const temp = h(2, hooks("willUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const r3 = diff(temp, null, [renderer3, tracker])
        r2.sub(r1), r3.sub(r1);
        events.length = 0;
        diff(h(0), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(newTemp));
        expect(renderer3.tree).to.eql(renderer3.renderStatic(copy(temp)));
        expect(events).to.eql([{wU: 0}, {wU: 1}, {wU: 2}, {wU: 1}, {mWR: 0}, {mWR: 1}])
      })
      it("should properly rebase nodes that used to be in the path when updating them during didUpdate", function(){
        let called = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const newTemp = h(1, {some: "data"});
        const r1 = diff(h(0), null, [renderer, tracker]);
        const r2 = diff(h(1), null, [renderer2, tracker]);
        const temp = h(2, hooks("didUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          called++;
        }))
        const r3 = diff(temp, null, [renderer3, tracker])
        r2.sub(r1), r3.sub(r1);
        events.length = 0;
        diff(h(0), r1);
        expect(called).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(newTemp));
        expect(renderer3.tree).to.eql(renderer3.renderStatic(copy(temp)));
        expect(events).to.eql([{wU: 0}, {wU: 1}, {wU: 2}, {mWR: 0}, {dU: 2}, {wU: 1}, {mWR: 1}])
      })
      it("should properly rebase portions of a subtree that are not in the path when updating the subtree during willUpdate", function(){
        let calledUpd = 0, calledUpd2 = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const newTemp = h(1, {some: "data"}, h(3, {other: "new data"}));
        const r1 = diff(h(0), null, [renderer, tracker]);
        const r2 = diff(h(1, null, h(3, hooks("willUpdate", f => {
          expect(f.temp.data).to.equal(newTemp.next.data)
          calledUpd++
        }))), null, [renderer2, tracker]);
        const temp = h(2, hooks("willUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          calledUpd2++
        }))
        const r3 = diff(temp, null, [renderer3, tracker])
        r2.sub(r1), r3.sub(r1);
        r2.next.sub(r3);
        events.length = 0;
        diff(h(0), r1);
        expect(calledUpd).to.equal(1);
        expect(calledUpd2).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(newTemp));
        expect(renderer3.tree).to.eql(renderer3.renderStatic(copy(temp)));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {wU: 1}, {wU: 3}, 
          {mWR: 0}, {mWR: 3}, {mWR: 1}
        ])
      })
      it("should properly rebase portions of a subtree that are not in the path when updating the subtree during willUpdate", function(){
        let calledUpd = 0, calledUpd2 = 0;
        const events = [], renderer = new LCRSRenderer, tracker = new Tracker(events);
        const renderer2 = new LCRSRenderer, renderer3 = new LCRSRenderer;
        const newTemp = h(1, {some: "data"}, h(3, {other: "new data"}));
        const r1 = diff(h(0), null, [renderer, tracker]);
        const r2 = diff(h(1, null, h(3, hooks("willUpdate", f => {
          if (calledUpd++) expect(f.temp.data).to.equal(newTemp.next.data)
        }))), null, [renderer2, tracker]);
        const temp = h(2, hooks("didUpdate", f => {
          const res = diff(newTemp, r2);
          expect(res).to.equal(r2);
          expect(res.temp).to.equal(newTemp)
          calledUpd2++
        }))
        const r3 = diff(temp, null, [renderer3, tracker])
        r2.sub(r1), r3.sub(r1);
        r2.next.sub(r3);
        events.length = 0;
        diff(h(0), r1);
        expect(calledUpd).to.equal(2);
        expect(calledUpd2).to.equal(1);
        expect(renderer.tree).to.eql(renderer.renderStatic(h(0)));
        expect(renderer2.tree).to.eql(renderer2.renderStatic(newTemp));
        expect(renderer3.tree).to.eql(renderer3.renderStatic(copy(temp)));
        expect(events).to.eql([
          {wU: 0}, {wU: 1}, {wU: 2}, {wU: 3}, 
          {mWR: 0}, {mWR: 3}, {dU: 2}, {wU: 1}, {wU: 3}, {mWR: 1}, {mWR: 3}
        ])
      })
    })
  })
  describe("updating (sync inner-diffs)", function(){
    it("should not update nodes during a constructor", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      diff(h(1, hooks("ctor", f => {
        expect(r.setState({n: 0})).to.be.false;
        called++
      })))
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}])
    })
    it("should not update nodes during cleanup", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      const f = diff(h(1, hooks("ctor", f => {
        expect(r.setState({n: 0})).to.be.false;
        called++
      })))
      diff(null, f);
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}])
    })
    it("should not update nodes that have been unmounted", function(){
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      expect(diff(null, r)).to.be.true;
      events.length = 0;
      expect(r.setState({n: 0})).to.be.false;
      expect(events).to.be.empty;
    })
    it("should not update nodes that are being unmounted", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      diff(h(1, hooks("willAdd", f => {
        expect(diff(null, r)).to.be.true;
        expect(r.setState({n: 0})).to.be.false;
        called++
      })), null, tracker)
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}, {wA: 1}, {mWP: 0}, {mWA: 1}])
    })
    it("should not update nodes during add mutation event", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      diff(h(1), null, {add: f => {
        const res = r.setState({n: 0})
        expect(res).to.be.false;
        called++
      }})
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}])
    })
    it("should not update nodes during remove mutation event", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      const f = diff(h(1), null, {remove: f => {
        const res = r.setState({n: 0})
        expect(res).to.be.false;
        called++
      }})
      diff(null, f);
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}])
    })
    it("should not update nodes during temp mutation event", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      const f = diff(h(1), null, {temp: f => {
        const res = r.setState({n: 0})
        expect(res).to.be.false;
        called++
      }})
      diff(h(1), f)
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}])
    })
    it("should not update nodes during move mutation event", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(0), null, tracker);
      const f = diff(h(1, null, [k(2), k(3)]), null, {move: f => {
        if (f.temp.data.id === 3){
          const res = r.setState({n: 0})
          expect(res).to.be.false;
          called++
        }
      }})
      diff(h(1, null, [k(3), k(2)]), f);
      expect(called).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}])
    })
    it("should rebase itself onto the path when updating itself during willAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const hooks = {
        willAdd: f => {
          expect(f.setState({n: 0})).to.be.true;
          calledAdd++;
        },
        willUpdate: f => {
          expect(f.state).to.eql({n: 0})
          calledUpd++;
        }
      }
      diff(h(0, hooks), null, tracker);
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wA: 0}, {wU: 0}, {mWA: 0}])
    })
    it("should rebase itself onto the path after flush when updating itself during didAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const hooks = {
        didAdd: f => {
          if (!calledAdd++)
            expect(f.setState({n: 0})).to.be.true;
        },
        willUpdate: f => {
          expect(f.state).to.eql({n: 0})
          calledUpd++;
        }
      }
      const f = diff(h(0, hooks), null, tracker);
      expect(calledUpd).to.equal(1);
      expect(calledAdd).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}, {dA: 0}, {wU: 0}])
    })
    it("should call didAdd once and not call didUpdate if rebasing itself during willAdd", function(){
      let calledAdd = 0, calledUpd = 0, calledDidUpd = 0, calledDidAdd = 0;
      const events = [], tracker = new Tracker(events);
      const hooks = {
        didUpdate: f => {
          calledDidUpd++;
        },
        willAdd: f => {
          calledAdd++;
          f.setState({n: 0})
        },
        didAdd: f => {
          calledDidAdd++
        },
        willUpdate: f => {
          calledUpd++;
        }
      }
      const f = diff(h(0, hooks), null, tracker);
      expect(calledUpd).to.equal(1);
      expect(calledAdd).to.equal(1);
      expect(calledDidUpd).to.equal(0);
      expect(calledDidAdd).to.equal(1);
      expect(events).to.eql([{wA: 0}, {wU: 0}, {mWA: 0}, {dA: 0}])
    })
    it("should rebase its parent and itself onto the path when updating the parent during willAdd", function(){
      let calledAdd = 0, calledUpd = 0, parent;
      const events = [], tracker = new Tracker(events);
      const parentHooks = {
        ctor: f => parent = f,
        willUpdate: f => {
          expect(f.state).to.eql({n: 0});
          calledUpd++;
        }
      }
      diff(h(0, parentHooks, h(1, hooks("willAdd", f => {
        expect(parent.setState({n: 0})).to.be.true;
        calledAdd++;
      }))), null, tracker);
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([
        {wA: 0}, {wA: 1}, {wU: 0}, {wU: 1},
        {mWA: 0}, {mWA: 1}
      ])
    })
    it("should rebase its parent and itself but not laggard siblings when updating the parent during willAdd", function(){
      let calledAdd = 0, calledUpd = 0, parent;
      const events = [], tracker = new Tracker(events);
      const parentHooks = {
        ctor: f => parent = f,
        willUpdate: f => {
          expect(f.state).to.eql({n: 0});
          calledUpd++;
        }
      }
      diff(h(0, parentHooks, [h(1, hooks("willAdd", f => {
        expect(parent.setState({n: 0})).to.be.true;
        calledAdd++;
      })), h(2)]), null, tracker);
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([
        {wA: 0}, {wA: 1}, {wU: 0}, {wU: 1}, {wA: 2},
        {mWA: 0}, {mWA: 1}, {mWA: 2}
      ])
    })
    it("should rebase its parent and itself onto the path after flush when updating the parent during didAdd", function(){
      let calledAdd = 0, calledUpd = 0, parent;
      const events = [], tracker = new Tracker(events);
      const parentHooks = {
        ctor: f => parent = f,
        willUpdate: f => {
          expect(f.state).to.eql({n: 0});
          calledUpd++;
        }
      }
      diff(h(0, parentHooks, h(1, hooks("didAdd", f => {
        if (!calledAdd++)
          expect(parent.setState({n: 0})).to.be.true;
      }))), null, tracker);
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([
        {wA: 0}, {wA: 1}, {mWA: 0}, {mWA: 1}, {dA: 1}, {wU: 0}, {wU: 1}, {mWR: 1}
      ])
    })
    it("should rebase an affector and itself onto the path when updating the affector during willAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const a = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql({n: 0});
        calledUpd++;
      })), null, tracker);
      diff(h(1, hooks("willAdd", f => {
        f.sub(a);
        expect(a.setState({n: 0})).to.be.true;
        calledAdd++;
      })), null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([
        {wA: 0}, {mWA: 0}, {wA: 1},
        {wU: 0}, {wU: 1}, {mWA: 1}
      ])
    })
    it("should rebase an affector and itself onto the path after flush when updating the affector during willAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const a = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql({n: 0});
        calledUpd++;
      })), null, tracker);
      diff(h(1, hooks("didAdd", f => {
        if (!calledAdd++){
          f.sub(a);
          expect(a.setState({n: 0})).to.be.true;
        }
      })), null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([
        {wA: 0}, {mWA: 0}, {wA: 1}, {mWA: 1}, {dA: 1},
        {wU: 0}, {wU: 1}
      ])
    })
    it("should not rebase laggard nodes, but should update their state when updating them during willAdd", function(){
      let calledAdd = 0, calledAdd2 = 0;
      const events = [], tracker = new Tracker(events);
      const temp = h(0, hooks("willAdd", f => {
        const r = diff(h(1, hooks("willAdd", f => {
          expect(f.state).to.eql({n: 0});
          calledAdd2++;
        })), null, tracker);
        calledAdd++;
        expect(r.setState({n: 0})).to.be.true;
      }))
      diff(temp, null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledAdd2).to.equal(1);
      expect(events).to.eql([{wA: 0}, {wA: 1}, {mWA: 0}, {mWA: 1}])
    })
    it("should not rebase laggard nodes, but should update their state when updating them during didAdd", function(){
      let calledAdd = 0, calledAdd2 = 0;
      const events = [], tracker = new Tracker(events);
      const temp = h(0, hooks("didAdd", f => {
        if (!calledAdd++){
          const r = diff(h(1, hooks("willAdd", f => {
            expect(f.state).to.eql({n: 0});
            calledAdd2++;
          })), null, tracker);
          expect(r.setState({n: 0})).to.be.true;
        }
      }))
      diff(temp, null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledAdd2).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}, {dA: 0}, {wA: 1}, {mWA: 1}])
    })
    it("should rebase nodes that are not in the path when updating them during willAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const r1 = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql({n: 0});
        calledUpd++;
      })), null, tracker);
      const temp = h(1, hooks("willAdd", f => {
        expect(r1.setState({n: 0})).to.be.true;
        calledAdd++;
      }))
      events.length = 0;
      diff(temp, null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wA: 1}, {wU: 0}, {mWA: 1}])
    })
    it("should rebase nodes that are not in the path after flush when updating them during didAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const r1 = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql({n: 0});
        calledUpd++;
      })), null, tracker);
      const temp = h(1, hooks("didAdd", f => {
        expect(r1.setState({n: 0})).to.be.true;
        calledAdd++;
      }))
      events.length = 0;
      diff(temp, null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wA: 1}, {mWA:1}, {dA: 1}, {wU: 0}])
    })
    it("should rebase once and coalesce state when updating nodes multiple times during willAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(1, hooks("willUpdate", f => {
        calledUpd++;
        expect(f.state).to.eql({n: 1});
      })), null, tracker);
      const temp = h(0, hooks("willAdd", f => {
        expect(r.setState({n: 0})).to.be.true;
        expect(r.setState({n: 1})).be.be.true;
        calledAdd++;
      }))
      events.length = 0;
      diff(temp, null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wA: 0}, {wU: 1}, {mWA: 0}])
    })
    it("should rebase once and coalesce state when updating nodes multiple times during didAdd", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(1, hooks("willUpdate", f => {
        calledUpd++;
        expect(f.state).to.eql({n: 1});
      })), null, tracker);
      const temp = h(0, hooks("didAdd", f => {
        expect(r.setState({n: 0})).to.be.true;
        expect(r.setState({n: 1})).be.be.true;
        calledAdd++;
      }))
      events.length = 0;
      diff(temp, null, tracker)
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wA: 0}, {mWA: 0}, {dA: 0}, {wU: 1}])
    })
    it("should rebase itself onto the path when updating itself during willUpdate", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const temp = h(0, hooks("willUpdate", f => {
        if (called++) return;
        expect(f.setState({n: 0})).to.be.true;
      }))
      const f = diff(temp, null, tracker);
      events.length = 0;
      diff(copy(temp), f);
      expect(called).to.equal(2);
      expect(events).to.eql([{wU: 0}, {wU: 0}, {mWR: 0}])
    })
    it("should rebase itself onto the path when updating itself during didUpdate", function(){
      let called = 0;
      const events = [], tracker = new Tracker(events);
      const temp = h(0, hooks("didUpdate", f => {
        if (called++) return;
        expect(f.setState({n: 0})).to.be.true;
      }))
      const f = diff(temp, null, tracker);
      events.length = 0;
      diff(copy(temp), f);
      expect(called).to.equal(2);
      expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wU: 0}, {dU: 0}])
    })
    it("should call didUpdate once and not call didAdd during the update if rebasing itself during willUpdate", function(){
      let calledAdd = 0, calledUpd = 0, calledDidUpd = 0, calledDidAdd = 0;
      const events = [], tracker = new Tracker(events);
      const hooks = {
        didUpdate: f => {
          calledDidUpd++;
        },
        willAdd: f => {
          calledAdd++;
        },
        didAdd: f => {
          calledDidAdd++
        },
        willUpdate: f => {
          if (calledUpd++) return;
          f.setState({n: 0})
        }
      }
      const f = diff(h(0, hooks), null, tracker);
      events.length = 0;
      diff(copy(f.temp), f);
      expect(calledUpd).to.equal(2);
      expect(calledAdd).to.equal(1);
      expect(calledDidUpd).to.equal(1);
      // note we will still call didAdd once BEFORE the update (during mount)
      expect(calledDidAdd).to.equal(1);
      expect(events).to.eql([{wU: 0}, {wU: 0}, {mWR: 0}, {dU: 0}])
    })
    it("should rebase its parent and itself onto the path when updating the parent during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0, parent;
      const events = [], tracker = new Tracker(events);
      const parentHooks = {
        ctor: f => parent = f,
        willUpdate: f => {
          expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
        }
      }
      const temp = h(0, parentHooks, h(1, hooks("willUpdate", f => {
        if (calledUpd2++) return;
        expect(parent.setState({n: 0})).to.be.true;
      })))
      const f = diff(temp, null, tracker);
      events.length = 0;
      diff(copy(temp), f);
      expect(calledUpd).to.equal(2)
      expect(calledUpd2).to.equal(2)
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {wU: 0}, {wU: 1},
        {mWR: 0}, {mWR: 1}
      ])
    })
    it("should rebase its parent and itself but not laggard siblings when updating the parent during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0, parent;
      const events = [], tracker = new Tracker(events);
      const parentHooks = {
        ctor: f => parent = f,
        willUpdate: f => {
          expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
        }
      }
      const temp = h(0, parentHooks, [h(1, hooks("willUpdate", f => {
        if (calledUpd2++) return;
        expect(parent.setState({n: 0})).to.be.true;
      }))])
      const f = diff(temp, null, tracker);
      events.length = 0;
      const copyTemp = copy(temp);
      copyTemp.next.push(h(2));
      diff(copyTemp, f);
      expect(calledUpd).to.equal(2)
      expect(calledUpd2).to.equal(2)
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {wU: 0}, {wU: 1}, {wA: 2},
        {mWR: 0}, {mWR: 1}, {mWA: 2}
      ])
    })
    it("should rebase its parent and itself onto the path when updating the parent during didUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0, parent;
      const events = [], tracker = new Tracker(events);
      const parentHooks = {
        ctor: f => parent = f,
        willUpdate: f => {
          expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
        }
      }
      const temp = h(0, parentHooks, h(1, hooks("didUpdate", f => {
        if (calledUpd2++) return;
        expect(parent.setState({n: 0})).to.be.true;
      })))
      const f = diff(temp, null, tracker);
      events.length = 0;
      diff(copy(temp), f);
      expect(calledUpd).to.equal(2)
      expect(calledUpd2).to.equal(2)
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {mWR: 0}, {mWR: 1},
        {dU: 1}, {wU: 0}, {wU: 1}, {mWR: 1}, {dU: 1}
      ])
    })
    it("should rebase an affector and itself onto the path when updating the affector during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const a = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
      })), null, tracker); // affector
      const affectTemp = h(1, hooks("willUpdate", f => {
        if (calledUpd2++) return;
        expect(a.setState({n: 0})).to.be.true;
      }))
      const f = diff(affectTemp, null, tracker);
      f.sub(a);
      events.length = 0;
      diff(h(0), a);
      expect(calledUpd).to.equal(2)
      expect(calledUpd2).to.equal(2)
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {wU: 0}, {wU: 1}, {mWR: 0}
      ])
    })
    it("should rebase an affector and itself onto the path when updating the affector during didUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const a = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
      })), null, tracker); // affector
      const affectTemp = h(1, hooks("didUpdate", f => {
        if (calledUpd2++) return;
        expect(a.setState({n: 0})).to.be.true;
      }))
      const f = diff(affectTemp, null, tracker);
      f.sub(a);
      events.length = 0;
      diff(h(0), a);
      expect(calledUpd).to.equal(2)
      expect(calledUpd2).to.equal(2)
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {mWR: 0}, {dU: 1}, {wU: 0}, {wU: 1}, {dU: 1}
      ])
    })
    it("should not rebase laggard nodes, but should update their state when updating them during willUpdate", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const temp = h(0, hooks("willUpdate", f => {
        const r = diff(h(1, hooks("willAdd", f => {
          expect(f.state).to.eql({n: 0});
          calledAdd++
        })), null, tracker);
        expect(r.setState({n: 0})).to.be.true;
        calledUpd++
      }))
      const r1 = diff(temp, null, tracker)
      events.length = 0;
      diff(copy(temp), r1);
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wU: 0}, {wA: 1}, {mWR: 0}, {mWA: 1}])
    })
    it("should not rebase laggard nodes, but should update their state when updating them during didUpdate", function(){
      let calledAdd = 0, calledUpd = 0;
      const events = [], tracker = new Tracker(events);
      const temp = h(0, hooks("didUpdate", f => {
        if (!calledUpd++){
          const r = diff(h(1, hooks("willAdd", f => {
            expect(f.state).to.eql({n: 0});
            calledAdd++
          })), null, tracker);
          expect(r.setState({n: 0})).to.be.true;
        }
      }))
      const r1 = diff(temp, null, tracker)
      events.length = 0;
      diff(copy(temp), r1);
      expect(calledAdd).to.equal(1);
      expect(calledUpd).to.equal(1);
      expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wA: 1}, {mWA: 1}])
    })
    it("should rebase nodes that are not in the path when updating them during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const r1 = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql({n: 0});
        calledUpd++
      })), null, tracker);
      const temp = h(1, hooks("willUpdate", f => {
        expect(r1.setState({n: 0})).to.be.true;
        calledUpd2++
      }))
      const f = diff(temp, null, tracker)
      events.length = 0;
      diff(copy(temp), f);
      expect(calledUpd).to.equal(1);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([{wU: 1}, {wU: 0}, {mWR: 1}])
    })
    it("should rebase nodes that are not in the path when updating them during didUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const r1 = diff(h(0, hooks("willUpdate", f => {
        expect(f.state).to.eql({n: 0});
        calledUpd++
      })), null, tracker);
      const temp = h(1, hooks("didUpdate", f => {
        expect(r1.setState({n: 0})).to.be.true;
        calledUpd2++
      }))
      const f = diff(temp, null, tracker)
      events.length = 0;
      diff(copy(temp), f);
      expect(calledUpd).to.equal(1);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([{wU: 1}, {mWR: 1}, {dU: 1}, {wU: 0}])
    })
    it("should rebase once and coalesce state when updating nodes multiple times during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(1, hooks("willUpdate", f => {
        calledUpd++;
        expect(f.state).to.eql({n: 1});
      })), null, tracker);
      const temp = h(0, hooks("willUpdate", f => {
        expect(r.setState({n: 0})).to.be.true;
        expect(r.setState({n: 1})).to.be.true;
        calledUpd2++;
      }))
      const r1 = diff(temp, null, tracker)
      events.length = 0;
      diff(copy(temp), r1);
      expect(calledUpd).to.equal(1);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([{wU: 0}, {wU: 1}, {mWR: 0}])
    })
    it("should rebase once and coalesce state when updating nodes multiple times during didUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const r = diff(h(1, hooks("willUpdate", f => {
        calledUpd++;
        expect(f.state).to.eql({n: 1});
      })), null, tracker);
      const temp = h(0, hooks("didUpdate", f => {
        expect(r.setState({n: 0})).to.be.true;
        expect(r.setState({n: 1})).to.be.true;
        calledUpd2++;
      }))
      const r1 = diff(temp, null, tracker)
      events.length = 0;
      diff(copy(temp), r1);
      expect(calledUpd).to.equal(1);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([{wU: 0}, {mWR: 0}, {dU: 0}, {wU: 1}])
    })
    it("should properly rebase nodes that used to be in the path when updating them during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const newTemp = h(1, {some: "data"});
      const r1 = diff(h(0), null, tracker);
      const r2 = diff(h(1, hooks("willUpdate", f => {
        expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
      })), null, tracker);
      const temp = h(2, hooks("willUpdate", f => {
        expect(r2.setState({n: 0})).to.be.true;
        calledUpd2++
      }))
      const r3 = diff(temp, null, tracker)
      r2.sub(r1), r3.sub(r1)
      events.length = 0;
      diff(h(0), r1);
      expect(calledUpd).to.equal(2);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([{wU: 0}, {wU: 1}, {wU: 2}, {wU: 1}, {mWR: 0}])
    })
    it("should properly rebase nodes that used to be in the path when updating them during didUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const newTemp = h(1, {some: "data"});
      const r1 = diff(h(0), null, tracker);
      const r2 = diff(h(1, hooks("willUpdate", f => {
        expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
      })), null, tracker);
      const temp = h(2, hooks("didUpdate", f => {
        expect(r2.setState({n: 0})).to.be.true;
        calledUpd2++
      }))
      const r3 = diff(temp, null, tracker)
      r2.sub(r1), r3.sub(r1)
      events.length = 0;
      diff(h(0), r1);
      expect(calledUpd).to.equal(2);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([{wU: 0}, {wU: 1}, {wU: 2}, {mWR: 0}, {dU: 2}, {wU: 1}])
    })
    it("should properly rebase portions of a subtree that are not in the path when updating the subtree during willUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const r1 = diff(h(0), null, tracker);
      const r2 = diff(h(1, hooks("willUpdate", f => {
        expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
      }), h(3)), null, tracker);
      const temp = h(2, hooks("willUpdate", f => {
        expect(r2.setState({n: 0})).to.be.true;
        calledUpd2++
      }))
      const r3 = diff(temp, null, tracker)
      r2.sub(r1), r3.sub(r1);
      r2.next.sub(r3);
      events.length = 0;
      diff(h(0), r1);
      expect(calledUpd).to.equal(2);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {wU: 2}, {wU: 1}, {wU: 3}, 
        {mWR: 0}, {mWR: 3}
      ])
    })
    it("should properly rebase portions of a subtree that are not in the path when updating the subtree during didUpdate", function(){
      let calledUpd = 0, calledUpd2 = 0;
      const events = [], tracker = new Tracker(events);
      const r1 = diff(h(0), null, tracker);
      const r2 = diff(h(1, hooks("willUpdate", f => {
        expect(f.state).to.eql(calledUpd++ ? {n: 0} : null)
      }), h(3)), null, tracker);
      const temp = h(2, hooks("didUpdate", f => {
        expect(r2.setState({n: 0})).to.be.true;
        calledUpd2++
      }))
      const r3 = diff(temp, null, tracker)
      r2.sub(r1), r3.sub(r1);
      r2.next.sub(r3);
      events.length = 0;
      diff(h(0), r1);
      expect(calledUpd).to.equal(2);
      expect(calledUpd2).to.equal(1);
      expect(events).to.eql([
        {wU: 0}, {wU: 1}, {wU: 2}, {wU: 3}, {mWR: 0}, {mWR: 3}, {dU: 2}, {wU: 1}, {wU: 3}, 
        {mWR: 3}
      ])
    })
  })
})
