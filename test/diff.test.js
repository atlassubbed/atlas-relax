const { describe, it } = require("mocha")
const { expect } = require("chai")
const { LCRSRenderer, Cache } = require("./effects");
const { Frame, diff } = require("../");
const { isScalar, type, inject, deepIgnore, assertDeleted } = require("./util")
const { 
  irreducibleBlackboxes: primes, 
  reducibleBlackboxes: comps,
  functionals: functionalRoots,
  voidBlackboxes: voids,
  updatingBlackboxes
} = require("./cases/diff");

const allBlackboxes = [...voids, ...primes, ...comps]
const allNontrivialBlackboxes = allBlackboxes.filter(n => type(n.name) !== "void")
const blackboxRoots = allNontrivialBlackboxes.filter(n => isScalar(n.name))

const ignoreMetaTemp = node => deepIgnore(node, n => {
  delete n.temp.p;
})

const getNullFrame = () => {
  const f = diff({});
  diff(null, f);
  return f;
}

// XXX needs to be a factory, this is a legacy factory which used to support ArrayRenderers
const renderers = () => [new LCRSRenderer];

describe("diff", function(){
  describe("standard interface", function(){
    it("should not add void templates", function(){
      const voids = [null, true, undefined, false];
      voids.forEach(val => {
        renderers().forEach(renderer => {
          const result = diff(val, null, renderer);
          expect(result).to.be.false;
          expect(renderer.tree).to.be.null;
          const { a, r, u } = renderer.counts;
          expect(a).to.equal(r).to.equal(u).to.equal(0)
        })
      })
    })
    it("should add a new frame if diffing on top of a null frame", function(){
      const nullFrame = getNullFrame();
      const result = diff({name: "div"}, nullFrame);
      expect(result).to.not.be.false;
      expect(result).to.not.equal(nullFrame);
    })
    it("should not add multiple templates", function(){
      renderers().forEach(renderer => {
        const result = diff([{name:"div"},{name:"p"}], null, renderer);
        expect(result).to.be.false;
        expect(renderer.tree).to.be.null;
        const { a, r, u } = renderer.counts;
        expect(a).to.equal(r).to.equal(u).to.equal(0)
      })
    })
    it("should not replace a frame with a different species", function(){
      renderers().forEach(renderer => {
        const result = diff({name: "p"}, new Frame({name: "div"}), renderer);
        expect(result).to.be.false;
        expect(renderer.tree).to.be.null;
        const { a, r, u } = renderer.counts;
        expect(a).to.equal(r).to.equal(u).to.equal(0)
      })
    })
    it("should not replace a frame with multiple templates", function(){
      renderers().forEach(renderer => {
        const result = diff([{name:"div"}, {name: "p"}], new Frame({}), renderer);
        expect(result).to.be.false;
        expect(renderer.tree).to.be.null;
        const { a, r, u } = renderer.counts;
        expect(a).to.equal(r).to.equal(u).to.equal(0)
      })
    })
    it("should not remove non-frames", function(){
      renderers().forEach(renderer => {
        const result = diff(null, "not a frame", renderer);
        expect(result).to.be.false;
        expect(renderer.tree).to.be.null;
        const { a, r, u } = renderer.counts;
        expect(a).to.equal(r).to.equal(u).to.equal(0)
      })
    })
    it("should not remove non-root frames", function(){
      renderers().forEach(renderer => {
        const temp = {name: "p", next: {name: "p"}};
        const child = diff(temp, null, renderer).next;
        const result = diff(null, child);
        expect(result).to.be.false;
        expect(renderer.tree).to.eql(renderer.renderStatic(temp))
        const { a, r, u } = renderer.counts;
        expect(a).to.equal(2);
        expect(r).to.equal(u).to.equal(0)
      })
    })
    it("should not move top level root frames", function(){
      renderers().forEach(renderer => {
        const child = diff({name: "p"}, null, renderer);
        const child2 = diff({name: "c"})
        const result = diff(child.temp, child, child2);
        expect(result).to.be.false;
        expect(renderer.tree).to.eql(renderer.renderStatic({name: "p"}));
        const { a, r, u } = renderer.counts;
        expect(u).to.equal(r).to.equal(0);
        expect(a).to.equal(1)
      })
    })
  })
  // used for imperative, managed diffs (virtual children/portals)
  describe("low-level interface", function(){
    describe("allows positional placement of virtual children under parents", function(){
      it("should not add void templates", function(){
        const voids = [null, true, undefined, false];
        voids.forEach(val => {
          const renderer = new LCRSRenderer;
          const p = diff({name:"p"}, null, renderer);
          const result = diff(val, null, p);
          expect(result).to.be.false;
          expect(renderer.renderStatic({name:"p"})).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(1);
          expect(r).to.equal(u).to.equal(s).to.equal(0)
        })
      })
      it("should mount a new frame as the first virtual child if diffing on top of a null frame", function(){
        const nullFrames = [null, false, 0, undefined, getNullFrame(), ""];
        nullFrames.forEach(f => {
          const renderer = new LCRSRenderer;
          const p = diff({name: "p"}, null, renderer);
          const result = diff({name:"c"}, f, p);
          expect(result).to.be.an.instanceOf(Frame);
          expect(renderer.renderStatic({name:"p", next: {name: "c"}})).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(2);
          expect(r).to.equal(u).to.equal(s).to.equal(0)
        })
      })
      it("should mount a new frame as the first virtual child if the parent already has virtual children", function(){
        const nullFrames = [null, false, 0, undefined, getNullFrame(), ""];
        nullFrames.forEach(f => {
          const renderer = new LCRSRenderer;
          const p = diff({name: "p"}, null, renderer);
          const c = diff({name:"c"}, f, p);
          const result = diff({name: "c2"}, f, p);
          expect(result).to.be.an.instanceOf(Frame);
          const tree = {name:"p", next: [{name: "c2"}, {name: "c"}]};
          expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(3);
          expect(r).to.equal(u).to.equal(s).to.equal(0);
        })
      })
      it("should not be able to mount multiple frames at once", function(){
        const nullFrames = [null, false, 0, undefined, getNullFrame(), ""];
        nullFrames.forEach(f => {
          const renderer = new LCRSRenderer;
          const p = diff({name: "p"}, null, renderer);
          const result = diff([{name:"c"}, {name: "d"}], f, p);
          expect(result).to.be.false
          expect(renderer.renderStatic({name:"p"})).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(1);
          expect(r).to.equal(u).to.equal(s).to.equal(0)
        })
      })
      it("should remove the first virtual child properly", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const c2 = diff({name:"c2"}, null, p, c);
        const result = diff(null, c);
        expect(result).to.be.true;

        expect(renderer.tree).to.eql(renderer.renderStatic({name:"p", next: {name: "c2"}}));
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(3);
        expect(n).to.equal(2);
        expect(r).to.equal(1);
        expect(u).to.equal(s).to.equal(0)
      })
      it("should remove the last virtual child properly", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const c2 = diff({name:"c2"}, null, p, c);
        const result = diff(null, c2);
        expect(result).to.be.true;
        expect(renderer.renderStatic({name:"p", next: {name: "c"}})).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(3);
        expect(n).to.equal(2);
        expect(r).to.equal(1);
        expect(u).to.equal(s).to.equal(0)
      })
      it("should remove a middle virtual child properly", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const c2 = diff({name:"c2"}, null, p, c);
        const c3 = diff({name:"c3"}, null, p, c2);
        const result = diff(null, c2);
        expect(result).to.be.true;
        expect(renderer.renderStatic({name:"p", next: [{name: "c"}, {name: "c3"}]})).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(4);
        expect(n).to.equal(3);
        expect(r).to.equal(1);
        expect(u).to.equal(s).to.equal(0)
      })
      it("should not be able to replace a frame with a different species", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const result = diff({name: "d"}, c);
        expect(result).to.be.false;
        expect(renderer.renderStatic({name:"p", next: {name: "c"}})).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(2);
        expect(r).to.equal(u).to.equal(s).to.equal(0)
      })
      it("should not be able to replace a frame with multiple templates", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const result = diff([{name: "d"}, {name: "e"}], c);
        expect(result).to.be.false;
        expect(renderer.renderStatic({name:"p", next: {name: "c"}})).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(2);
        expect(r).to.equal(u).to.equal(s).to.equal(0)
      })
      it("should not update or move frames if diffed with a memoized template with no after sibling argument", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        diff({name:"d"}, null, p);
        const result = diff(c.temp, c);
        expect(result).to.be.false;
        expect(renderer.renderStatic({name:"p", next: [{name:"d"}, {name: "c"}]}))
          .to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(r).to.equal(u).to.equal(s).to.equal(0)
      })
      it("should update but not move a frame if a new template is provided with no after sibling argument", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        diff({name:"d"}, null, p);
        const result = diff({name: "c", data:{n:1}}, c);
        expect(result).to.equal(c);
        expect(renderer.tree).to.eql(renderer.renderStatic({name:"p", next: [{name: "d"}, {name: "c", data:{n:1}}]}))
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(u).to.equal(1);
        expect(r).to.equal(s).to.equal(0)
      })
    })
    describe("allows positional placement of virtual children under parents and after siblings", function(){
      it("should not add void templates", function(){
        const voids = [null, true, undefined, false];
        voids.forEach(val => {
          const renderer = new LCRSRenderer;
          const p = diff({name:"p"}, null, renderer);
          const c = diff({name:"c"}, null, p);
          expect(c).to.be.an.instanceOf(Frame);
          const result = diff(val, null, p, c);
          expect(result).to.be.false;
          expect(renderer.renderStatic({name:"p", next: {name: "c"}})).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(2);
          expect(r).to.equal(u).to.equal(s).to.equal(0)
        })
      })
      it("should mount a new frame after the specified virtual sibling if diffing on top of a null frame", function(){
        const nullFrames = [null, false, 0, undefined, getNullFrame(), ""];
        nullFrames.forEach(f => {
          const renderer = new LCRSRenderer;
          const p = diff({name: "p"}, null, renderer);
          const c = diff({name:"c"}, f, p);
          const result = diff({name: "c2"}, f, p, c);
          expect(result).to.be.an.instanceOf(Frame);
          const tree = {name:"p", next: [{name: "c"}, {name: "c2"}]};
          expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(3);
          expect(r).to.equal(u).to.equal(s).to.equal(0)
        })
      })
      it("should not be able to mount multiple frames at once", function(){
        const nullFrames = [null, false, 0, undefined, getNullFrame(), ""];
        nullFrames.forEach(f => {
          const renderer = new LCRSRenderer;
          const p = diff({name: "p"}, null, renderer);
          const c = diff({name:"c"}, f, p);
          const result = diff([{name: "c2"},{name:"d"}], f, p, c);
          expect(result).to.be.false
          const tree = {name:"p", next: {name: "c"}};
          expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
          const { a, r, u, n, s } = renderer.counts;
          expect(a).to.equal(n).to.equal(2);
          expect(r).to.equal(u).to.equal(s).to.equal(0)
        })
      })
      it("should not be able to replace a frame with a different species", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const result = diff({name: "e"}, c, d);
        expect(result).to.be.false;
        const tree = {name:"p", next: [{name: "d"}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(r).to.equal(u).to.equal(s).to.equal(0)
      })
      it("should not be able to replace a frame with multiple templates", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const result = diff([{name: "e"}, {name:"f"}], c, d);
        expect(result).to.be.false;
        const tree = {name:"p", next: [{name: "d"}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(r).to.equal(u).to.equal(s).to.equal(0)
      })
      it("should move the first child frame after the specified virtual sibling but not update it if diffed with a memoized template", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const result = diff(d.temp, d, c);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "c"}, {name: "d"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(s).to.equal(1);
        expect(r).to.equal(u).to.equal(0)
      })
      it("should move an aribtrary child frame after the specified virtual sibling but not update it if diffed with a memoized template", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const e = diff({name: "e"}, null, p);
        const result = diff(d.temp, d, c);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "e"}, {name: "c"}, {name: "d"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(4);
        expect(s).to.equal(1);
        expect(r).to.equal(u).to.equal(0)
      })
      it("should move a subsequent child frame to the top of the list but not update it if diffed with a memoized template and a null sibling", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const e = diff({name: "e"}, null, p);
        const result = diff(d.temp, d, null);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "d"}, {name: "e"}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(4);
        expect(s).to.equal(1);
        expect(r).to.equal(u).to.equal(0)
      })
      it("should not update the first child or move it if diffed with a memoized template and a null sibling", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const e = diff({name: "e"}, null, p);
        const d = diff({name: "d"}, null, p);
        const result = diff(d.temp, d, null);
        expect(result).to.be.false;
        const tree = {name:"p", next: [{name: "d"}, {name: "e"}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(4);
        expect(s).to.equal(0);
        expect(r).to.equal(u).to.equal(0)
      })
      it("should update and move a frame", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const result = diff({name:"d",data:{n:1}}, d, c);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "c"}, {name: "d", data:{n:1}}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(u).to.equal(s).to.equal(1)
        expect(r).to.equal(0)
      })
      it("should update and move a frame to the top of the list if a null sibling is provided", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const d = diff({name: "d"}, null, p);
        const c = diff({name:"c"}, null, p);
        const result = diff({name:"d",data:{n:1}}, d, null);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "d", data:{n:1}}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(u).to.equal(s).to.equal(1)
        expect(r).to.equal(0)
      })
      it("should update and not move a frame if a null sibling is provided and it is already at the top of the list", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const result = diff({name:"d",data:{n:1}}, d, null);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "d", data:{n:1}}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(3);
        expect(u).to.equal(1)
        expect(s).to.equal(0);
        expect(r).to.equal(0)
      })
      it("should update but not move a frame if the previous virtual sibling was unchanged", function(){
        const renderer = new LCRSRenderer;
        const p = diff({name: "p"}, null, renderer);
        const c = diff({name:"c"}, null, p);
        const d = diff({name: "d"}, null, p);
        const e = diff({name: "e"}, null, p);
        const result = diff({name: "d", data:{n:1}}, d, e);
        expect(result).to.equal(d);
        const tree = {name:"p", next: [{name: "e"}, {name: "d", data:{n:1}}, {name: "c"}]}
        expect(renderer.renderStatic(tree)).to.deep.equal(renderer.tree);
        const { a, r, u, n, s } = renderer.counts;
        expect(a).to.equal(n).to.equal(4);
        expect(u).to.equal(1)
        expect(r).to.equal(s).to.equal(0)
      })
    })
  })
  // diff should let you play legos with blackbox templates
  describe("blackboxes", function(){
    blackboxRoots.forEach(({ name: id, get }) => {
      describe(`${id} frames`, function(){
        it("should be added", function(){
          renderers().forEach(renderer => {
            const data = {v: 0, id};
            const result = diff(get(data), null, renderer);
            expect(result).to.be.an.instanceOf(Frame);
            expect(renderer.tree).to.deep.equal(renderer.renderStatic(get(data)))
            const { a, r, u, n } = renderer.counts;
            expect(n).to.equal(a)
            expect(u).to.equal(r).to.equal(0)
          })
        })
        it("should be removed", function(){
          renderers().forEach(renderer => {
            const data = {v: 0, id};
            const cache = [], c = new Cache(cache);
            const frame = diff(get(data), null, [renderer, c]);
            const result = diff(null, frame);
            expect(result).to.be.true;
            expect(renderer.tree).to.be.null
            const { a, r, u } = renderer.counts;
            expect(a).to.equal(cache.length).to.equal(r)
            expect(u).to.equal(0)
            for (let c of cache) assertDeleted(c);
          })
        })
        it("should be updated without getting replaced", function(){
          renderers().forEach(renderer => {
            const data = {v: 0, id}, newData = {v: 1, id}
            const template = get(data), newTemplate = get(newData)
            const frame = diff(get(data), null, renderer);
            const result = diff(get(newData), frame, renderer);
            expect(result).to.be.an.instanceOf(Frame).to.equal(frame)
            expect(renderer.tree).to.deep.equal(renderer.renderStatic(get(newData)));
            const { a, r, u, n } = renderer.counts;
            expect(n).to.equal(a).to.equal(u)
            expect(r).to.equal(0)
          })
        })
        it("should satisfy the identity diff(t) = diff(t, diff(t))", function(){
          const t1 = get({v: 0, id}), t2 = get({v: 0, id}), t3 = get({v: 0, id})
          expect(t1).to.deep.equal(t2).to.deep.equal(t3)
          expect(diff(t1)).to.be.an.instanceOf(Frame)
            .to.deep.equal(ignoreMetaTemp(diff(t2, diff(t3))))
        })
      })
    })
  })
  // diff should let you play legos with functional templates, which should play nicely with other templates
  describe("functionals", function(){
    functionalRoots.forEach(({ name: id, get }) => {
      describe(id, function(){
        allBlackboxes.forEach(({ name: nextId, get: nextGet }) => {
          describe(`with ${nextId} child`, function(){
            it("should be added", function(){
              renderers().forEach(renderer => {
                const data = {v: 0, id}
                const result = diff(inject(get(data), nextGet(data)), null, renderer);
                expect(result).to.be.an.instanceOf(Frame);
                const rendered = renderer.renderStatic(inject(get(data), nextGet(data)))
                expect(renderer.tree).to.deep.equal(rendered)
                const { a, r, u, n } = renderer.counts;
                expect(a).to.equal(n)
                expect(r).to.equal(u).to.equal(0)
              })
            })
            it("should remove the root", function(){
              renderers().forEach(renderer => {
                const data = {v: 0, id}, cache = [], c = new Cache(cache);
                const frame = diff(inject(get(data), nextGet(data)), null, [renderer, c]);
                const result = diff(null, frame);
                expect(result).to.be.true;
                expect(renderer.tree).to.be.null;
                const { a, r, u } = renderer.counts;
                expect(a).to.equal(cache.length).to.equal(r)
                expect(u).to.equal(0)
                for (let c of cache) assertDeleted(c);
              })
            })
            it("should remove just the child", function(){
              renderers().forEach(renderer => {
                const data = {v: 0, id}, cache = [], c = new Cache(cache);
                const frame = diff(inject(get(data), nextGet(data)), null, [renderer, c]);
                const result = diff(get(data), frame, [renderer, c])
                const rendered = renderer.renderStatic(get(data));
                expect(result).to.be.an.instanceOf(Frame).to.equal(frame);
                expect(renderer.tree).to.deep.equal(rendered);
                const { a, r, u, n } = renderer.counts;
                expect(n).to.equal(u).to.equal(a - r)
                expect(cache.length).to.equal(a);
                for (let c of cache) if (!c.temp) assertDeleted(c);
              })
            })
            it("should update just the root without getting replaced", function(){
              renderers().forEach(renderer => {
                const data = {v: 0, id}, newData = {v: 1, id}
                const frame = diff(inject(get(data), nextGet(data)), null, renderer);
                const result = diff(inject(get(newData), nextGet(data)), frame, renderer);
                expect(result).to.be.an.instanceOf(Frame).to.equal(frame)
                const rendered = renderer.renderStatic(inject(get(newData), nextGet(data)));
                expect(renderer.tree).to.deep.equal(rendered);
                const { a, r, u, n } = renderer.counts;
                expect(n).to.equal(a).to.equal(u)
                expect(r).to.equal(0)
              })
            })
            it("should update just the child without getting replaced", function(){
              renderers().forEach(renderer => {
                const data = {v: 0, id}, newData = {v: 1, id}
                const frame = diff(inject(get(data), nextGet(data)), null, renderer);
                const result = diff(inject(get(data), nextGet(newData)), frame, renderer);
                expect(result).to.be.an.instanceOf(Frame).to.equal(frame)
                const rendered = renderer.renderStatic(inject(get(data), nextGet(newData)));
                expect(renderer.tree).to.deep.equal(rendered);
                const { a, r, u, n } = renderer.counts;
                expect(n).to.equal(a).to.equal(u)
                expect(r).to.equal(0)
              })
            })
            it("should update both parent and child without getting replaced", function(){
              renderers().forEach(renderer => {
                const data = {v: 0, id}, newData = {v: 1, id}
                const frame = diff(inject(get(data), nextGet(data)), null, renderer);
                const result = diff(inject(get(newData), nextGet(newData)), frame, renderer);
                expect(result).to.be.an.instanceOf(Frame).to.equal(frame)
                const rendered = renderer.renderStatic(inject(get(newData), nextGet(newData)));
                expect(renderer.tree).to.deep.equal(rendered);
                const { a, r, u, n } = renderer.counts;
                expect(n).to.equal(a).to.equal(u)
                expect(r).to.equal(0)
              })
            })
            allNontrivialBlackboxes.forEach(({ name: replaceId, get: replaceGet }) => {
              if (!nextId.startsWith("reducible") && type(nextId) === type(replaceId)) return;
              const data = {id, v: 0}, 
                template = inject(get(data), nextGet(data)), 
                newTemplate = inject(get(data), replaceGet(data));
              if (!nextId.startsWith("void") && template.next.name === newTemplate.next.name) return;
              it(`should replace the child with ${replaceId} frames`, function(){
                renderers().forEach(renderer => {
                  const cache = [], c = new Cache(cache);
                  const frame = diff(template, null, [renderer, c]);
                  const oldAddedCount = renderer.counts.a;
                  const newFrame = diff(newTemplate, frame, [renderer, c]);
                  expect(newFrame).to.be.an.instanceOf(Frame).to.equal(frame);
                  const rendered = renderer.renderStatic(inject(get(data), replaceGet(data)));
                  expect(renderer.tree).to.deep.equal(rendered)
                  const { a, r, u, n } = renderer.counts;
                  expect(a).to.equal(cache.length).to.equal(n + r);
                  expect(u).to.equal(oldAddedCount - r)
                  for (let c of cache) if (!c.temp) assertDeleted(c);
                })
              })
            })
            it("should satisfy the identity diff(t) = diff(t, diff(t))", function(){
              const t1 = inject(get({v:0, id}), nextGet({v: 0, id})),
                t2 = inject(get({v:0, id}), nextGet({v: 0, id})),
                t3 = inject(get({v:0, id}), nextGet({v: 0, id}))
              expect(t1).to.deep.equal(t2).to.deep.equal(t3)
              expect(diff(t1)).to.be.an.instanceOf(Frame)
                .to.deep.equal(ignoreMetaTemp(diff(t2, diff(t3))))
            })
          })
        })
      })
    })
  })
})
