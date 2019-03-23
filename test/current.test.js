const { describe, it } = require("mocha")
const { expect } = require("chai")
const { diff, current } = require("../");

describe("current", function(){
  it("should return the current rendering node during render", function(){
    let called = 0;
    const h = next => ({name: (t, node) => {
      called++;
      expect(current()).to.equal(node);
      return next;
    }, next});
    const t1 = h([h(), h(h())]);
    diff(t1);
    expect(called).to.equal(4)
  })
  it("should return the current rendered node during rendered", function(){
    let called = 0;
    const h = next => ({name: (t, node) => {
      node.rendered = () => {
        called++;
        expect(current()).to.equal(node);
      }
      return next;
    }, next});
    const t1 = h([h(), h(h())]);
    diff(t1);
    expect(called).to.equal(4)
  })
})
