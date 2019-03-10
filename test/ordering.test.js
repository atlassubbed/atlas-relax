const { describe, it } = require("mocha")
const { expect } = require("chai")
const { Frame, diff } = require("../");
const { copy } = require("./util");
const { Tracker } = require("./effects");
const { StemCell: { h: rawH } } = require("./cases/Frames");

const h = (id, next) => rawH(id, null, next);

const t = h(0, [
  h(1, [
    h(3),
    h(4)
  ]),
  h(2, [
    h(5),
    h(6)
  ])
])

const N = 7;

const mount = events => diff(t, null, new Tracker(events))

// forward order means "child 1 before child 2"
// reverse order means "child 2 before child 1"
describe("mutation event and lifecycle event ordering", function(){
  describe("mounts", function(){
    it("should run the correct number of events", function(){
      const events = [], f = mount(events);
      expect(events.length).to.equal(2*N)
    })
    it("should run render events in depth-first in order", function(){
      const events = [], f = mount(events);
      expect(events.slice(0, N)).to.eql([
        {wA: 0}, {wA: 1}, {wA: 3}, {wA: 4}, {wA: 2}, {wA: 5}, {wA: 6}
      ])
    })
    it("should run willAdd events in depth-first order after all render events", function(){
      const events = [], f = mount(events);
      expect(events.slice(-N)).to.eql([
        {mWA: 0}, {mWA: 1}, {mWA: 3}, {mWA: 4}, {mWA: 2}, {mWA: 5}, {mWA: 6}
      ])
    })
  })
  describe("unmounts", function(){
    it("should run the correct number of events", function(){
      const events = [], f = mount(events);
      events.length = 0;
      diff(null, f);
      expect(events.length).to.equal(N)
    })
    it("should run willRemove events in depth-first reverse order", function(){
      const events = [], f = mount(events);
      events.length = 0;
      diff(null, f);
      expect(events).to.eql([
        {mWP: 0}, {mWP: 2}, {mWP: 6}, {mWP: 5}, {mWP: 1}, {mWP: 4}, {mWP: 3}
      ])
    })
  })
  describe("updates", function(){
    it("should run the correct number of events", function(){
      const events = [], f = mount(events);
      events.length = 0;
      diff(copy(t), f);
      expect(events.length).to.equal(2*N)
    })
    it("should run render events in depth-first order", function(){
      const events = [], f = mount(events);
      events.length = 0;
      diff(copy(t), f);
      expect(events.slice(0, N)).to.eql([
        {wU: 0}, {wU: 1}, {wU: 3}, {wU: 4}, {wU: 2}, {wU: 5}, {wU: 6}
      ])
    })
    // XXX this should change to a more intuitive order, but it's probably fine
    it("should run willReceive events in depth-children-first order after all render events", function(){
      const events = [], f = mount(events);
      events.length = 0;
      diff(copy(t), f);
      expect(events.slice(-N)).to.eql([
        {mWR: 0}, {mWR: 1}, {mWR: 2}, {mWR: 3}, {mWR: 4}, {mWR: 5}, {mWR: 6}
      ])
    })
  })
})
