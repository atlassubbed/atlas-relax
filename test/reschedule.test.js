const { describe, it, before } = require("mocha")
const { expect } = require("chai")
const { Timer } = require("./effects");
const { diff } = require("../");
const { StemCell } = require("./cases/Frames");
const DeferredTests = require("./DeferredTests")
const { ALLOW, CHECK, T, taus, verify } = require("./time");
const { copy } = require("./util");

const asyncTaus = taus.filter(tau => tau >= 0)
const p = StemCell.h
const h = (id, hooks, next) => p(id, {hooks}, next);
const hooks = (hook, job) => ({[hook]: function(){job(this)}})
const k = (id, hooks, next) => { // keyed
  const node = p(id, {hooks}, next);
  node.key = id;
  return node;
}

describe("reschedule (queueing a new diff after current diff)", function(){
  this.timeout(ALLOW);
  const tests = buildMochaScaffold();
    before(function(done){
    tests.forEach(testCase => {
      const { task } = testCase;
      let events = testCase.events = [];
      testCase.task(new Timer(events));
    })
    setTimeout(() => {
      done();
    }, CHECK)
  })
  tests.forEach(testCase => {
    it(testCase.desc, function(){
      verify(testCase.events, testCase.result)
    })
  }, describe)
})

// XXX Can refactor these repetitive tests later. Let's just get them working for now.
function buildMochaScaffold(){
  const scaffold = new DeferredTests;
  scaffold.describe("async inner-diff during ctor", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update on itself`,
        task: effs => {
          diff(h(id, hooks("ctor", f => {
            const res = f.setState({n: 0}, tau);
            expect(res).to.be.false;
          })), null, effs);
        },
        result: [
          {wA: id, dt: -1, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update on other nodes`,
        task: effs => {
          const r = diff(h(1), null, effs);
          diff(h(id, hooks("ctor", () => {
            const res = r.setState({n: 0}, tau);
            expect(res).to.be.false;
          })), null, effs);
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null}
        ]
      })
    })
  })
  scaffold.describe("async inner-diff on orphaned nodes", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update on nodes that have been unmounted`,
        task: effs => {
          const r = diff(h(0), null, effs);
          expect(diff(null, r)).to.be.true;
          expect(r.setState({n: 0}, tau)).to.be.false;
        },
        result: [
          {wA: id, dt: -1, state: null},
        ]
      })
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update on nodes that are being unmounted`,
        task: effs => {
          let called = 0;
          const r = diff(h(0), null, effs);
          diff(h(1, hooks("willAdd", f => {
            expect(diff(null, r)).to.be.true;
            expect(r.setState({n: 0}, tau)).to.be.false;
            called++
          })), null, effs)
          expect(called).to.equal(1);
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wA: 1, dt: -1, state: null}
        ]
      })
    })
  })
  scaffold.describe("async inner-diff during mutation events", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update during add event`,
        task: effs => {
          let called = 0;
          const r = diff(h(0), null, effs);
          diff(h(1), null, {add: f => {
            const res = r.setState({n: 0})
            expect(res).to.be.false;
            called++
          }})
          expect(called).to.equal(1);
        },
        result: [
          {wA: id, dt: -1, state: null}
        ]
      })
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update during remove event`,
        task: effs => {
          let called = 0;
          const r = diff(h(0), null, effs);
          const f = diff(h(1), null, {remove: f => {
            const res = r.setState({n: 0})
            expect(res).to.be.false;
            called++
          }})
          diff(null, f);
          expect(called).to.equal(1);
        },
        result: [
          {wA: id, dt: -1, state: null}
        ]
      })
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update during temp event`,
        task: effs => {
          let called = 0;
          const r = diff(h(0), null, effs);
          const f = diff(h(1), null, {temp: f => {
            const res = r.setState({n: 0})
            expect(res).to.be.false;
            called++
          }})
          diff(h(1), f)
          expect(called).to.equal(1);
        },
        result: [
          {wA: id, dt: -1, state: null}
        ]
      })
      scaffold.push({
        desc: `should not schedule a tau ${rel} 0 update during move event`,
        task: effs => {
          let called = 0;
          const r = diff(h(0), null, effs);
          const f = diff(h(1, null, [k(2), k(3)]), null, {move: f => {
            if (f.temp.data.id === 3){
              const res = r.setState({n: 0})
              expect(res).to.be.false;
              called++
            }
          }})
          diff(h(1, null, [k(3), k(2)]), f);
          expect(called).to.equal(1);
        },
        result: [
          {wA: id, dt: -1, state: null}
        ]
      })
    })
  })
  scaffold.describe("async inner-diff on itself during willAdd", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update`,
        task: effs => {
          diff(h(id, hooks("willAdd", f => {
            const res = f.setState({n: 0}, tau)
            expect(res).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wU: id, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          diff(h(id, hooks("willAdd", f => {
            const res = f.setState({n: 0}, tau);
            expect(res).to.be.true;
            const res2 = f.setState({n: 1});
            expect(res2).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: {n: 1}}
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update`,
          task: effs => {
            diff(h(id, hooks("willAdd", f => {
              const res = f.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = f.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: id, dt: -1, state: null},
            {wU: id, dt: newTau, state: {n: 1}}
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on itself during didAdd", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update`,
        task: effs => {
          diff(h(id, hooks("didAdd", f => {
            const res = f.setState({n: 0}, tau)
            expect(res).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: id, dt: -1, state: null},
          {dA: id, dt: -1, state: null},
          {wU: id, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          diff(h(id, hooks("didAdd", f => {
            const res = f.setState({n: 0}, tau);
            expect(res).to.be.true;
            const res2 = f.setState({n: 1});
            expect(res2).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: id, dt: -1, state: null},
          {dA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: {n: 1}}
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update`,
          task: effs => {
            diff(h(id, hooks("didAdd", f => {
              const res = f.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = f.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: id, dt: -1, state: null},
            {dA: id, dt: -1, state: null},
            {wU: id, dt: newTau, state: {n: 1}}
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on other nodes during willAdd", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update on nodes not in the path`,
        task: effs => {
          const r = diff(h(1), null, effs);
          diff(h(id, hooks("willAdd", () => {
            const res = r.setState({n: 0}, tau)
            expect(res).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {wU: 1, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should coalesce a tau ${rel} 0 update on nodes about to be mounted`,
        task: effs => {
          let sib;
          diff(
            h(0, null, [h(1, hooks("willAdd", () => {
              const res = sib.setState({n: 0}, tau)
              expect(res).to.be.true;
            })), h(2, hooks("ctor", f => sib = f))]), 
            null, effs
          );
        },
        result: [
          {wA: 0, dt: -1, state: null},
          {wA: 1, dt: -1, state: null},
          {wA: 2, dt: -1, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          const r = diff(h(1), null, effs);
          diff(h(id, hooks("willAdd", f => {
            const res = r.setState({n: 0}, tau);
            expect(res).to.be.true;
            const res2 = r.setState({n: 1});
            expect(res2).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {wU: 1, dt: -1, state: {n: 1}}
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update on the same node`,
          task: effs => {
            const r = diff(h(1), null, effs);
            diff(h(id, hooks("willAdd", f => {
              const res = r.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: 1, dt: newTau, state: {n: 1}}
          ]
        })
        if (tau === newTau) scaffold.push({
          desc: `should schedule two tau ${rel} 0 updates on different nodes in the same cycle`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            diff(h(id, hooks("willAdd", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, tau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: 2, dt: tau, state: {n: 1}},
            {wU: 1, dt: tau, state: {n: 0}},
          ]
        }); else scaffold.push({
          desc: `should schedule a tau ${rel} 0 and a tau ${newRel} 0 update on different nodes in different cycles`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            diff(h(id, hooks("willAdd", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: newTau < tau ? 2 : 1, dt: Math.min(newTau, tau), state: {n: newTau < tau ? 1 : 0}},
            {wU: newTau < tau ? 1 : 2, dt: Math.max(newTau, tau), state: {n: newTau < tau ? 0 : 1}},
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on other nodes during didAdd", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update on nodes not in the path`,
        task: effs => {
          const r = diff(h(1), null, effs);
          diff(h(id, hooks("didAdd", () => {
            const res = r.setState({n: 0}, tau)
            expect(res).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {dA: id, dt: -1, state: null},
          {wU: 1, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should coalesce a tau ${rel} 0 update on nodes about to be mounted`,
        task: effs => {
          diff(
            h(0, null, h(1, hooks("didAdd", () => {
              const sib = diff(h(2), null, effs);
              const res = sib.setState({n: 0}, tau)
              expect(res).to.be.true;
            }))), 
            null, effs
          );
        },
        result: [
          {wA: 0, dt: -1, state: null},
          {wA: 1, dt: -1, state: null},
          {dA: 1, dt: -1, state: null},
          {wA: 2, dt: -1, state: {n: 0}},
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          const r = diff(h(1), null, effs);
          diff(h(id, hooks("didAdd", f => {
            const res = r.setState({n: 0}, tau);
            expect(res).to.be.true;
            const res2 = r.setState({n: 1});
            expect(res2).to.be.true;
          })), null, effs)
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {dA: id, dt: -1, state: null},
          {wU: 1, dt: -1, state: {n: 1}}
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update on the same node`,
          task: effs => {
            const r = diff(h(1), null, effs);
            diff(h(id, hooks("didAdd", f => {
              const res = r.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {dA: id, dt: -1, state: null},
            {wU: 1, dt: newTau, state: {n: 1}}
          ]
        })
        if (tau === newTau) scaffold.push({
          desc: `should schedule two tau ${rel} 0 updates on different nodes in the same cycle`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            diff(h(id, hooks("didAdd", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, tau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {dA: id, dt: -1, state: null},
            {wU: 2, dt: tau, state: {n: 1}},
            {wU: 1, dt: tau, state: {n: 0}},
          ]
        }); else scaffold.push({
          desc: `should schedule a tau ${rel} 0 and a tau ${newRel} 0 update on different nodes in different cycles`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            diff(h(id, hooks("didAdd", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs)
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {dA: id, dt: -1, state: null},
            {wU: newTau < tau ? 2 : 1, dt: Math.min(newTau, tau), state: {n: newTau < tau ? 1 : 0}},
            {wU: newTau < tau ? 1 : 2, dt: Math.max(newTau, tau), state: {n: newTau < tau ? 0 : 1}},
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on itself during willUpdate", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update`,
        task: effs => {
          let called = 0;
          const f = diff(h(id, hooks("willUpdate", f => {
            if (called) return;
            const res = f.setState({n: called++}, tau)
            expect(res).to.be.true;
          })), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wR: id, dt: -1, state: null},
          {wU: id, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          let called = 0;
          const f = diff(h(id, hooks("willUpdate", f => {
            if (called) return;
            const res = f.setState({n: called++}, tau);
            expect(res).to.be.true;
            const res2 = f.setState({n: called++});
            expect(res2).to.be.true;
          })), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wU: id, dt: -1, state: {n: 1}},
          {wR: id, dt: -1, state: {n: 1}},
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update`,
          task: effs => {
            let called = 0;
            const f = diff(h(id, hooks("willUpdate", f => {
              if (called) return;
              const res = f.setState({n: called++}, tau)
              expect(res).to.be.true;
              const res2 = f.setState({n: called++}, newTau);
              expect(res2).to.be.true;
            })), null, effs);
            diff(copy(f.temp), f);
          },
          result: [
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {wU: id, dt: newTau, state: {n: 1}}
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on itself during didUpdate", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update`,
        task: effs => {
          let called = 0;
          const f = diff(h(id, hooks("didUpdate", f => {
            if (called) return;
            const res = f.setState({n: called++}, tau)
            expect(res).to.be.true;
          })), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wR: id, dt: -1, state: null},
          {dU: id, dt: -1, state: null},
          {wU: id, dt: tau, state: {n: 0}},
          {dU: id, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          let called = 0;
          const f = diff(h(id, hooks("didUpdate", f => {
            if (called) return;
            const res = f.setState({n: called++}, tau);
            expect(res).to.be.true;
            const res2 = f.setState({n: called++});
            expect(res2).to.be.true;
          })), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wR: id, dt: -1, state: null},
          {dU: id, dt: -1, state: null},
          {wU: id, dt: -1, state: {n: 1}},
          {dU: id, dt: -1, state: {n: 1}},
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update`,
          task: effs => {
            let called = 0;
            const f = diff(h(id, hooks("didUpdate", f => {
              if (called) return;
              const res = f.setState({n: called++}, tau)
              expect(res).to.be.true;
              const res2 = f.setState({n: called++}, newTau);
              expect(res2).to.be.true;
            })), null, effs);
            diff(copy(f.temp), f);
          },
          result: [
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {dU: id, dt: -1, state: null},
            {wU: id, dt: newTau, state: {n: 1}},
            {dU: id, dt: newTau, state: {n: 1}}
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on other nodes during willUpdate", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update on nodes not in the path`,
        task: effs => {
          const r = diff(h(1), null, effs);
          const f = diff(h(id, hooks("willUpdate", () => {
            const res = r.setState({n: 0}, tau)
            expect(res).to.be.true;
          })), null, effs)
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wR: id, dt: -1, state: null},
          {wU: 1, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should coalesce a tau ${rel} 0 update on nodes about to be mounted`,
        task: effs => {
          let sib;
          const f = diff(
            h(0, null, [h(1, hooks("willUpdate", () => {
              const res = sib.setState({n: 0}, tau)
              expect(res).to.be.true;
            }))]), 
            null, effs
          );
          const newTemp = copy(f.temp);
          newTemp.next.push(h(2, hooks("ctor", f => sib = f)))
          diff(newTemp, f);
        },
        result: [
          {wA: 0, dt: -1, state: null},
          {wA: 1, dt: -1, state: null},
          {wU: 0, dt: -1, state: null},
          {wU: 1, dt: -1, state: null},
          {wA: 2, dt: -1, state: {n: 0}},
          {wR: 0, dt: -1, state: null},
          {wR: 1, dt: -1, state: null}
        ]
      })
      scaffold.push({
        desc: `should coalesce a tau ${rel} 0 update on nodes in the path`,
        task: effs => {
          let sib;
          const f = diff(
            h(0, null, [h(1, hooks("willUpdate", () => {
              const res = sib.setState({n: 0}, tau)
              expect(res).to.be.true;
            })), h(2, hooks("ctor", f => sib = f))]), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 0, dt: -1, state: null},
          {wA: 1, dt: -1, state: null},
          {wA: 2, dt: -1, state: null},
          {wU: 0, dt: -1, state: null},
          {wU: 1, dt: -1, state: null},
          {wU: 2, dt: -1, state: {n: 0}},
          {wR: 0, dt: -1, state: null},
          {wR: 1, dt: -1, state: null},
          {wR: 2, dt: -1, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          const r = diff(h(1), null, effs);
          const f = diff(h(id, hooks("willUpdate", f => {
            const res = r.setState({n: 0}, tau);
            expect(res).to.be.true;
            const res2 = r.setState({n: 1});
            expect(res2).to.be.true;
          })), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wU: 1, dt: -1, state: {n: 1}},
          {wR: id, dt: -1, state: null}
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update on the same node`,
          task: effs => {
            const r = diff(h(1), null, effs);
            const f = diff(h(id, hooks("willUpdate", f => {
              const res = r.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs);
            diff(copy(f.temp), f);
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {wU: 1, dt: newTau, state: {n: 1}}
          ]
        })
        if (tau === newTau) scaffold.push({
          desc: `should schedule two tau ${rel} 0 updates on different nodes in the same cycle`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            const f = diff(h(id, hooks("willUpdate", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, tau);
              expect(res2).to.be.true;
            })), null, effs)
            diff(copy(f.temp), f);
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {wU: 2, dt: tau, state: {n: 1}},
            {wU: 1, dt: tau, state: {n: 0}},
          ]
        }); else scaffold.push({
          desc: `should schedule a tau ${rel} 0 and a tau ${newRel} 0 update on different nodes in different cycles`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            const f = diff(h(id, hooks("willUpdate", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs);
            diff(copy(f.temp), f);
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {wU: newTau < tau ? 2 : 1, dt: Math.min(newTau, tau), state: {n: newTau < tau ? 1 : 0}},
            {wU: newTau < tau ? 1 : 2, dt: Math.max(newTau, tau), state: {n: newTau < tau ? 0 : 1}},
          ]
        })
      })
    })
  })
  scaffold.describe("async inner-diff on other nodes during didUpdate", () => {
    asyncTaus.forEach(tau => {
      const rel = tau > 0 ? ">" : "=", id = 0;
      scaffold.push({
        desc: `should schedule a tau ${rel} 0 update on nodes not in the path`,
        task: effs => {
          const r = diff(h(1), null, effs);
          const f = diff(h(id, hooks("didUpdate", () => {
            const res = r.setState({n: 0}, tau)
            expect(res).to.be.true;
          })), null, effs)
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wR: id, dt: -1, state: null},
          {dU: id, dt: -1, state: null},
          {wU: 1, dt: tau, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should coalesce a tau ${rel} 0 update on nodes about to be mounted`,
        task: effs => {
          const f = diff(
            h(0, null, h(1, hooks("didUpdate", () => {
              const sib = diff(h(2), null, effs);
              const res = sib.setState({n: 0}, tau)
              expect(res).to.be.true;
            }))), 
            null, effs
          );
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 0, dt: -1, state: null},
          {wA: 1, dt: -1, state: null},
          {wU: 0, dt: -1, state: null},
          {wU: 1, dt: -1, state: null},
          {wR: 0, dt: -1, state: null},
          {wR: 1, dt: -1, state: null},
          {dU: 1, dt: -1, state: null},
          {wA: 2, dt: -1, state: {n: 0}},
        ]
      })
      scaffold.push({
        desc: `should coalesce a tau ${rel} 0 update on nodes in the path`,
        task: effs => {
          const sib = diff(h(2), null, effs)
          const f = diff(
            h(0, null, h(1, hooks("didUpdate", () => {
              diff(copy(sib.temp), sib);
              const res = sib.setState({n: 0}, tau)
              expect(res).to.be.true;
            }))), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 2, dt: -1, state: null},
          {wA: 0, dt: -1, state: null},
          {wA: 1, dt: -1, state: null},
          {wU: 0, dt: -1, state: null},
          {wU: 1, dt: -1, state: null},
          {wR: 0, dt: -1, state: null},
          {wR: 1, dt: -1, state: null},
          {dU: 1, dt: -1, state: null},
          {wU: 2, dt: -1, state: {n: 0}},
          {wR: 2, dt: -1, state: {n: 0}}
        ]
      })
      scaffold.push({
        desc: `should rebase a previously scheduled tau ${rel} 0 update when hit with a sync update`,
        task: effs => {
          const r = diff(h(1), null, effs);
          const f = diff(h(id, hooks("didUpdate", f => {
            const res = r.setState({n: 0}, tau);
            expect(res).to.be.true;
            const res2 = r.setState({n: 1});
            expect(res2).to.be.true;
          })), null, effs);
          diff(copy(f.temp), f);
        },
        result: [
          {wA: 1, dt: -1, state: null},
          {wA: id, dt: -1, state: null},
          {wU: id, dt: -1, state: null},
          {wR: id, dt: -1, state: null},
          {dU: id, dt: -1, state: null},
          {wU: 1, dt: -1, state: {n: 1}},
        ]
      })
      asyncTaus.forEach(newTau => {
        const newRel = newTau > 0 ? ">" : "=";
        scaffold.push({
          desc: `should coalesce an initial tau ${rel} 0 update into a new tau ${newRel} 0 update on the same node`,
          task: effs => {
            const r = diff(h(1), null, effs);
            const f = diff(h(id, hooks("didUpdate", f => {
              const res = r.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs);
            diff(copy(f.temp), f);
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {dU: id, dt: -1, state: null},
            {wU: 1, dt: newTau, state: {n: 1}},
          ]
        })
        if (tau === newTau) scaffold.push({
          desc: `should schedule two tau ${rel} 0 updates on different nodes in the same cycle`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            const f = diff(h(id, hooks("didUpdate", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, tau);
              expect(res2).to.be.true;
            })), null, effs)
            diff(copy(f.temp), f);
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {dU: id, dt: -1, state: null},
            {wU: 2, dt: tau, state: {n: 1}},
            {wU: 1, dt: tau, state: {n: 0}},
          ]
        }); else scaffold.push({
          desc: `should schedule a tau ${rel} 0 and a tau ${newRel} 0 update on different nodes in different cycles`,
          task: effs => {
            const r1 = diff(h(1), null, effs);
            const r2 = diff(h(2), null, effs);
            const f = diff(h(id, hooks("didUpdate", f => {
              const res = r1.setState({n: 0}, tau)
              expect(res).to.be.true;
              const res2 = r2.setState({n: 1}, newTau);
              expect(res2).to.be.true;
            })), null, effs);
            diff(copy(f.temp), f);
          },
          result: [
            {wA: 1, dt: -1, state: null},
            {wA: 2, dt: -1, state: null},
            {wA: id, dt: -1, state: null},
            {wU: id, dt: -1, state: null},
            {wR: id, dt: -1, state: null},
            {dU: id, dt: -1, state: null},
            {wU: newTau < tau ? 2 : 1, dt: Math.min(newTau, tau), state: {n: newTau < tau ? 1 : 0}},
            {wU: newTau < tau ? 1 : 2, dt: Math.max(newTau, tau), state: {n: newTau < tau ? 0 : 1}},
          ]
        })
      })
    })
  })
  return scaffold;
}
