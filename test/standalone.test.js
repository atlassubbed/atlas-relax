const { describe, it } = require("mocha")
const { expect } = require("chai")
const { LCRSRenderer, Tracker } = require("./effects");
const { Frame, diff } = require("../");
const { copy, assertDeleted } = require("./util")

/* Standalone nodes are root nodes that are diffed either at top level or during a render.
   Since I implemented rebasing, we can achieve sideways data storage & dependencies without
   polluting the tree with higher order wrapper nodes.

   Standalone nodes are not ordered nodes. They belong to a set and cannot be moved within it.
   Internally, pointers are reused over sets. If you need order, use direct or managed children. 

   Standalone nodes are useful for abstracting out reactive services w/ the entanglement model.
   Thanks to this, we don't need to implement something like closure-based hooks:

      useEffect(() => {
        subscribe(...);
        return () => unsubscribe(...);
      }) */

const h = (id, next) => ({name: "s", key: id, data: {id}, next})

// not very DRY, but that's not too important right now
describe("diffing standalone (unordered) nodes", function(){
  describe("top level standalone nodes", function(){
    it("should mount standalone nodes in the order they are diffed", function(){
      const events = [], tracker = new Tracker(events);
      const s1 = diff(h(0), null, tracker);
      const s2 = diff(h(1), null, tracker);
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}
      ])
    })
    it("should unmount standalone nodes", function(){
      const events = [], tracker = new Tracker(events);
      const s1 = diff(h(0), null, tracker);
      const s2 = diff(h(1), null, tracker);
      events.length = 0;
      diff(null, s1), diff(null, s2);
      expect(events).to.eql([
        {mWP: 0}, {mWP: 1}
      ])
      s1._node = s2._node = null // eh, don't wanna write two assertDeleted functions
      assertDeleted(s1), assertDeleted(s2)
    })
    it("should not move standalone nodes as they are members of an unordered set", function(){
      const events = [], tracker = new Tracker(events);
      const s1 = diff(h(0), null, tracker);
      const s2 = diff(h(1), null, tracker);
      events.length = 0;
      const res = diff(s1.temp, s1, s2)
      expect(res).to.be.false;
      expect(events).to.be.empty;
    })
  })
  describe("standalone nodes owned by another node", function(){
    it("should mount standalone nodes in the order they are diffed", function(){
      const events = [], tracker = new Tracker(events);
      diff({name: () => {
        const s1 = diff(h(1), null, tracker);
        const s2 = diff(h(2), null, tracker);
      }, data: {id: 0}}, null, tracker)
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}
      ])
    })
    it("should unmount standalone nodes", function(){
      const events = [], tracker = new Tracker(events);
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          node.s1 = diff(h(1), null, tracker);
          node.s2 = diff(h(2), null, tracker);
        } else {
          diff(null, node.s1), diff(null, node.s2);
        }
      }, data: {id: 0}}, null, tracker)
      events.length = 0;
      diff(copy(r.temp), r);
      expect(events).to.eql([
        {mWP: 1}, {mWP: 2}, {mWR: 0}
      ])
      r.s1._node = r.s2._node = null 
      assertDeleted(r.s1), assertDeleted(r.s2)
    })
    it("should not move standalone nodes as they are members of an unordered set", function(){
      const events = [], tracker = new Tracker(events);
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          node.s1 = diff(h(1), null, tracker);
          node.s2 = diff(h(2), null, tracker);
        } else {
          const res = diff(node.s1.temp, node.s1, null);
          expect(res).to.be.false;
        }
      }, data: {id: 0}}, null, tracker)
      events.length = 0;
      diff(copy(r.temp), r);
      expect(called).to.equal(2);
      expect(events).to.eql([
        {mWR: 0}
      ])
    })
    it("should automatically unmount standalone nodes when their owner unmounts", function(){
      const events = [], tracker = new Tracker(events);
      const r = diff({name: (temp, node) => {
        node.s1 = diff(h(1), null, tracker);
        node.s2 = diff(h(2), null, tracker);
      }, data: {id: 0}}, null, tracker)
      events.length = 0;
      diff(null, r);
      expect(events).to.eql([
        {mWP: 0}, {mWP: 2}, {mWP: 1}
      ])
      r._node = r.s1._node = r.s2._node = null 
      assertDeleted(r), assertDeleted(r.s1), assertDeleted(r.s2)
    })
    it("should automatically unmount standalone nodes when their owner unmounts even if the owner has children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      const r = diff({name: (temp, node) => {
        node.one = diff(h(1), null, node);
        node.two = diff(h(2), null, node, node.one)
        node.tre = diff(h(3), null, node, node.two)
        node.s1 = diff(h(4), null, tracker);
        node.s2 = diff(h(5), null, tracker);
      }, data: {id: 0}}, null, [renderer, tracker])
      events.length = 0;
      diff(null, r);
      expect(renderer.tree).to.be.null;
      expect(events).to.eql([
        {mWP: 0}, {mWP: 3}, {mWP: 2}, {mWP: 1}, {mWP: 5}, {mWP: 4}
      ])
      r.s1._node = r.s2._node = null;
      assertDeleted(r.one), assertDeleted(r.two), assertDeleted(r.tre)
      assertDeleted(r), assertDeleted(r.s1), assertDeleted(r.s2)
    })
    it("should automatically unmount standalone nodes when their owner unmounts if a child is added to the front", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      const r = diff({name: (temp, node) => {
        node.one = diff(h(1), null, node);
        node.two = diff(h(2), null, node, node.one)
        node.tre = diff(h(3), null, node, node.two)
        node.s1 = diff(h(4), null, tracker);
        node.s2 = diff(h(5), null, tracker);
      }, data: {id: 0}}, null, [renderer, tracker])
      events.length = 0;
      const added = diff(h(6), null, r)
      diff(null, r);
      expect(renderer.tree).to.be.null;
      expect(events).to.eql([
        {mWA: 6}, {mWP: 0}, {mWP: 3}, {mWP: 2}, {mWP: 1}, {mWP: 6}, {mWP: 5}, {mWP: 4}
      ])
      r.s1._node = r.s2._node = null;
      assertDeleted(r.one), assertDeleted(r.two), assertDeleted(r.tre), assertDeleted(added)
      assertDeleted(r), assertDeleted(r.s1), assertDeleted(r.s2)
    })
    it("should automatically unmount standalone nodes when their owner unmounts if a child has moved to the front", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      const r = diff({name: (temp, node) => {
        node.one = diff(h(1), null, node);
        node.two = diff(h(2), null, node, node.one)
        node.tre = diff(h(3), null, node, node.two)
        node.s1 = diff(h(4), null, tracker);
        node.s2 = diff(h(5), null, tracker);
      }, data: {id: 0}}, null, [renderer, tracker])
      events.length = 0;
      diff(r.tre.temp, r.tre, null)
      diff(null, r);
      expect(renderer.tree).to.be.null;
      expect(events).to.eql([
        {mWM: 3}, {mWP: 0}, {mWP: 2}, {mWP: 1}, {mWP: 3}, {mWP: 5}, {mWP: 4}
      ])
      r.s1._node = r.s2._node = null;
      assertDeleted(r.one), assertDeleted(r.two), assertDeleted(r.tre)
      assertDeleted(r), assertDeleted(r.s1), assertDeleted(r.s2)
    })
    it("should automatically unmount standalone nodes when their owner unmounts if a child has moved from the front", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      const r = diff({name: (temp, node) => {
        node.one = diff(h(1), null, node);
        node.two = diff(h(2), null, node, node.one)
        node.tre = diff(h(3), null, node, node.two)
        node.s1 = diff(h(4), null, tracker);
        node.s2 = diff(h(5), null, tracker);
      }, data: {id: 0}}, null, [renderer, tracker])
      events.length = 0;
      diff(r.one.temp, r.one, r.tre)
      diff(null, r);
      expect(renderer.tree).to.be.null;
      expect(events).to.eql([
        {mWM: 1}, {mWP: 0}, {mWP: 1}, {mWP: 3}, {mWP: 2}, {mWP: 5}, {mWP: 4}
      ])
      r.s1._node = r.s2._node = null;
      assertDeleted(r.one), assertDeleted(r.two), assertDeleted(r.tre)
      assertDeleted(r), assertDeleted(r.s1), assertDeleted(r.s2)
    })
    it("should automatically unmount standalone nodes when their owner unmounts if a child is removed from the front", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      const r = diff({name: (temp, node) => {
        node.one = diff(h(1), null, node);
        node.two = diff(h(2), null, node, node.one)
        node.tre = diff(h(3), null, node, node.two)
        node.s1 = diff(h(4), null, tracker);
        node.s2 = diff(h(5), null, tracker);
      }, data: {id: 0}}, null, [renderer, tracker])
      events.length = 0;
      const res = diff(null, r.one)
      expect(res).to.be.true;
      diff(null, r);
      expect(renderer.tree).to.be.null;
      expect(events).to.eql([
        {mWP: 1}, {mWP: 0}, {mWP: 3}, {mWP: 2}, {mWP: 5}, {mWP: 4}
      ])
      r.s1._node = r.s2._node = null;
      assertDeleted(r.one), assertDeleted(r.two), assertDeleted(r.tre);
      assertDeleted(r), assertDeleted(r.s1), assertDeleted(r.s2)
    })
  })
  describe("adding managed children when there are only standalone nodes", function(){
    it("should add the child to the front of the list by default", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(1), null, tracker);
          diff(h(2), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(h(3), null, r)
      const expected = copy(r.temp);
      expected.next = h(3);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}
      ])
    })
    it("should add the child to the front of the list if attempted to add after a standalone node", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let s;
      const r = diff({name: (temp, node) => {
        if (!s){
          s = diff(h(1), null, tracker);
          diff(h(2), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      expect(s).to.be.an.instanceOf(Frame);
      diff(h(3), null, r, s)
      const expected = copy(r.temp);
      expected.next = h(3);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}
      ])
    })
  })
  describe("adding direct children when there are only standalone nodes", function(){
    it("should add the child to the front of the list", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(1), null, tracker);
          diff(h(2), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = h(3);
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWR: 0}, {mWA: 3}
      ])
    })
  })
  describe("adding standalone nodes when there are only managed children", function(){
    it("should add the node without changing the order of the existing children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          const first = diff(h(1), null, node);
          diff(h(2), null, node, first);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(h(3), null, tracker)
      const expected = copy(r.temp);
      expected.next = [h(1), h(2)]
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}
      ])
    })
    it("should not add the node if there is a specified after sibling", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let first;
      const r = diff({name: (temp, node) => {
        if (!first){
          first = diff(h(1), null, node);
          diff(h(2), null, node, first);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(h(3), null, tracker, first)
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2)]
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}
      ])
    })
  })
  describe("adding standalone nodes when there are only direct children", function(){
    it("should add the node without changing the order of the existing children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          return [h(1), h(2)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(h(3), null, tracker)
      const expected = copy(r.temp);
      expected.next = [h(1), h(2)]
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}
      ])
    })
    it("should not add the node if there is a specified after sibling", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          return [h(1), h(2)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(h(3), null, tracker, r.next)
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2)]
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}
      ])
    })
  })
  describe("moving managed children amongst standalone nodes", function(){
    it("should move the last child to the front if moving after null sibling", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(tre.temp, tre, null)
      const expected = copy(r.temp);
      expected.next = [h(3), h(1), h(2)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 3}
      ])
    })
    it("should move the last child to the front if moved after a standalone node", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(tre.temp, tre, s)
      const expected = copy(r.temp);
      expected.next = [h(3), h(1), h(2)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 3}
      ])
    })
    it("should move the last child to the middle", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(tre.temp, tre, one)
      const expected = copy(r.temp);
      expected.next = [h(1), h(3), h(2)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 3}
      ])
    })
    it("should move a middle child to the front if moving after null sibling", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(two.temp, two, null)
      const expected = copy(r.temp);
      expected.next = [h(2), h(1), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 2}
      ])
    })
    it("should move the middle child to the front if moved after a standalone node", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(two.temp, two, s)
      const expected = copy(r.temp);
      expected.next = [h(2), h(1), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 2}
      ])
    })
    it("should move a middle child to the end", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(two.temp, two, tre)
      const expected = copy(r.temp);
      expected.next = [h(1), h(3), h(2)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 2}
      ])
    })
    it("should not move the first child if moving after null sibling", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(one.temp, one, null)
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}
      ])
    })
    it("should not move the first child if moved after a standalone node", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(one.temp, one, s)
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}
      ])
    })
    it("should move the first child to the middle", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(one.temp, one, two)
      const expected = copy(r.temp);
      expected.next = [h(2), h(1), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 1}
      ])
    })
    it("should move the first child to the end", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(one.temp, one, tre)
      const expected = copy(r.temp);
      expected.next = [h(2), h(3), h(1)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWM: 1}
      ])
    })
  })
  describe("moving direct children amongst standalone nodes", function(){
    it("should move the last child to the front", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(3), h(1), h(2)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5},
        {mWR: 0}, {mWR: 3}, {mWM: 3}, {mWR: 1}, {mWR: 2},
      ])
    })
    it("should move the last child to the middle", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(1), h(3), h(2)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5},
        {mWR: 0}, {mWR: 1}, {mWR: 3}, {mWM: 3}, {mWR: 2},
      ])
    })
    it("should move a middle child to the front", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(2), h(1), h(3)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5},
        {mWR: 0}, {mWR: 2}, {mWM: 2}, {mWR: 1}, {mWR: 3},
      ])
    })
    it("should move a middle child to the end", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(1), h(3), h(2)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5},
        {mWR: 0}, {mWR: 1}, {mWR: 3}, {mWM: 3}, {mWR: 2},
      ])
    })
    it("should move the first child to the middle", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(2), h(1), h(3)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5},
        {mWR: 0}, {mWR: 2}, {mWM: 2}, {mWR: 1}, {mWR: 3},
      ])
    })
    it("should move the first child to the end", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(2), h(3), h(1)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5},
        {mWR: 0}, {mWR: 2}, {mWM: 2}, {mWR: 3}, {mWM: 3}, {mWR: 1},
      ])
    })
  })
  describe("removing managed children amongst standalone nodes", function(){
    it("should remove the last child", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(null, tre)
      const expected = copy(r.temp);
      expected.next = [h(1), h(2)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 3}
      ])
    })
    it("should remove a middle child", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(null, two)
      const expected = copy(r.temp);
      expected.next = [h(1), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 2}
      ])
    })
    it("should remove the first child", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(null, one)
      const expected = copy(r.temp);
      expected.next = [h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 1}
      ])
    })
  })
  describe("removing direct children amongst standalone nodes", function(){
    it("should remove the last child", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(1), h(2)];
      diff(expected, r)
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 3},
        {mWR: 0}, {mWR: 1}, {mWR: 2}
      ])
    })
    it("should remove a middle child", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(1), h(3)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 2},
        {mWR: 0}, {mWR: 1}, {mWR: 3}
      ])
    })
    it("should remove the first child", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let called = 0;
      const r = diff({name: (temp, node) => {
        if (!called++){
          diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const expected = copy(r.temp);
      expected.next = [h(2), h(3)];
      diff(expected, r);
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 1},
        {mWR: 0}, {mWR: 2}, {mWR: 3}
      ])
    })
  })
  describe("moving standalone nodes amongst managed children", function(){
    it("should not move standalone nodes after other standalone nodes", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s1, s2;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s1 = diff(h(4), null, tracker);
          s2 = diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      let res = diff(s1.temp, s1, s2);
      expect(res).to.be.false;
      res = diff(s2.temp, s2, s1);
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}
      ])
    })
    it("should not move standalone nodes after other children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s1, s2;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s1 = diff(h(4), null, tracker);
          s2 = diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(s1.temp, s1, two);
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}
      ])
    })
  })
  describe("updating standalone nodes amongst managed children", function(){
    it("should update standalone nodes", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s1, s2;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s1 = diff(h(4), null, tracker);
          s2 = diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(copy(s2.temp), s2);
      diff(copy(s1.temp), s1);
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWR: 5}, {mWR: 4}
      ])
    })
  })
  describe("updating standalone nodes amongst direct children", function(){
    it("should update standalone nodes", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let s1, s2;
      const r = diff({name: (temp, node) => {
        if (!s1){
          s1 = diff(h(4), null, tracker);
          s2 = diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      diff(copy(s1.temp), s1);
      diff(copy(s2.temp), s2);
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWR: 4}, {mWR: 5}
      ])
    })
  })
  describe("moving standalone nodes amongst direct children", function(){
    it("should not move standalone nodes after other standalone nodes", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let s1, s2;
      const r = diff({name: (temp, node) => {
        if (!s1){
          s1 = diff(h(4), null, tracker);
          s2 = diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      let res = diff(s1.temp, s1, s2);
      expect(res).to.be.false;
      res = diff(s2.temp, s2, s1);
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}
      ])
    })
    it("should not move standalone nodes after other children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let s1, s2;
      const r = diff({name: (temp, node) => {
        if (!s1){
          s1 = diff(h(4), null, tracker);
          s2 = diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(s1.temp, s1, r.next.sib);
      expect(res).to.be.false;
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}
      ])
    })
  })
  describe("removing standalone nodes amongst managed children", function(){
    it("should remove a node without affecting the children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let one, two, tre, s;
      const r = diff({name: (temp, node) => {
        if (!one){
          one = diff(h(1), null, node);
          two = diff(h(2), null, node, one);
          tre = diff(h(3), null, node, two);
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(null, s)
      expect(res).to.be.true;
      s._node = null;
      assertDeleted(s);
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 4}
      ])
    })
  })
  describe("removing standalone nodes amongst direct children", function(){
    it("should remove a node without affecting the children", function(){
      const events = [], tracker = new Tracker(events), renderer = new LCRSRenderer;
      let s;
      const r = diff({name: (temp, node) => {
        if (!s){
          s = diff(h(4), null, tracker);
          diff(h(5), null, tracker);
          return [h(1), h(2), h(3)]
        } else return temp.next;
      }, data: {id: 0}}, null, [renderer, tracker])
      const res = diff(null, s)
      expect(res).to.be.true;
      s._node = null;
      assertDeleted(s);
      const expected = copy(r.temp);
      expected.next = [h(1), h(2), h(3)];
      expect(renderer.tree).to.eql(renderer.renderStatic(expected))
      expect(events).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 2}, {mWA: 3}, {mWA: 4}, {mWA: 5}, {mWP: 4}
      ])
    })
  })
})