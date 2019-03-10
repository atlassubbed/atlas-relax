const { describe, it } = require("mocha")
const { expect } = require("chai")
const { Frame, diff } = require("../");
const { StemCell } = require("./cases/Frames");

describe("Frame", function(){
  describe("constructor", function(){
    it("should set template and effects onto the instance", function(){
      const name = 1, data = 2, next = 3, key = 4, effs = [5]
      const temp = {name, data, next, key}, temp2 = {};
      const f = new Frame(temp, effs);
      const f2 = new Frame(temp2, effs[0])
      const f3 = new Frame(temp2, null);
      expect(f.temp).to.equal(temp)
      expect(f._evt._evt).to.equal(effs);
      expect(f2._evt._evt).to.equal(5)
      expect(f2.temp).to.equal(temp2)
      expect(f3._evt).to.be.null;
      expect(f3.temp).to.equal(temp2)
    })
  })
  describe("sub", function(){
    it("should be idempotent", function(){
      const nodes = ["p","p","p"].map(name => diff({name}));
      expect(nodes[0]).to.deep.equal(nodes[1]).to.deep.equal(nodes[2])
      nodes[1].sub(nodes[0])
      nodes[1].sub(nodes[2])
      expect(nodes[0]).to.deep.equal(nodes[2]);
      nodes[1].sub(nodes[0])
      expect(nodes[0]).to.deep.equal(nodes[2]);
    })
    it("should do nothing if entangling with self", function(){
      const f1 = diff({name:"p", next: {name: "div"}});
      const f2 = diff({name:"p", next: {name: "div"}});
      expect(f1).to.deep.equal(f2);
      f1.sub(f1)
      expect(f1).to.deep.equal(f2);
    })
  })
  describe("unsub", function(){
    it("should be idempotent", function(){
      const nodes = ["p","p","p"].map(name => diff({name}));
      expect(nodes[0]).to.deep.equal(nodes[1]).to.deep.equal(nodes[2])
      nodes[1].sub(nodes[0])
      nodes[1].sub(nodes[2])
      expect(nodes[0]).to.deep.equal(nodes[2]);
      nodes[1].unsub(nodes[2])
      nodes[1].unsub(nodes[0])
      nodes[1].unsub(nodes[0])
      expect(nodes[0]).to.deep.equal(nodes[2]);
    })
    it("should be the inverse of sub if removing last edge", function(){
      const nodes = ["p","p","p"].map(name => diff({name}));
      expect(nodes[0]).to.deep.equal(nodes[1]).to.deep.equal(nodes[2])
      nodes[0].sub(nodes[1])
      expect(nodes[1]).to.not.deep.equal(nodes[2]);
      nodes[0].unsub(nodes[1]);
      expect(nodes[1]).to.deep.equal(nodes[2])
    })
    it("should not remove nodes that aren't in the set", function(){
      const nodes = ["p","p","p"].map(name => diff({name}));
      expect(nodes[0]).to.deep.equal(nodes[1]).to.deep.equal(nodes[2])
      nodes[0].sub(nodes[1])
      nodes[0].sub(nodes[2])
      expect(nodes[1]).to.eql(nodes[2]);
      nodes[2].unsub(nodes[1]);
      expect(nodes[1]).to.eql(nodes[2])
    })
  })
})
