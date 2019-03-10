const { describe, it, before } = require("mocha")
const { expect } = require("chai")
const DeferredTests = require("./DeferredTests")
const { Timer } = require("./effects");
const { diff } = require("../");
const { StemCell } = require("./cases/Frames");
const { getMicrostates, getExpectedResult } = require("./cases/field");
const { ALLOW, CHECK, T, taus, verify } = require("./time");

/* There are nine 2-photon-2-node systems to test (we'll explain more in the code):
     g  means photon
     p  means node
     c  means node
     ~> means entangled relationship (affector ~> affected)
     -> means direct relationship (parent -> child)
     .  means incoming photon

      gp      | gp     | gp      For each node relationship type, test
      .       | .      | .       stimulating the system with (0,1) photon,
      p -> c  | p ~> c | p    c  (1,0) photon, and (1,1) photons.
      ________|________|_______  (0,0) represents no stimulation; nothing to test.
          gc  |     gc |     gc
           .  |      . |      .
      p -> c  | p ~> c | p    c
      ________|________|_______
      gp  gc  | gp  gc | gp  gc
      .    .  | .    . | .    .
      p -> c  | p ~> c | p    c */

const h = StemCell.h;

const getEffs = events => new Timer(events)

const mountTree = events => {
  const frame = diff(h(0, null, h(1)), null, getEffs(events));
  events.length = 0;
  return {p: frame, c: frame.next};
}

const mountRoots = events => {
  const root0 = diff(h(0), null, getEffs(events));
  const root1 = diff(h(1), null, getEffs(events));
  events.length = 0;
  return {p: root0, c: root1};
}

const mountEntangledRoots = events => {
  const roots = mountRoots(events);
  roots.c.sub(roots.p);
  events.length = 0;
  return roots;
}

/* There are three fundamental 2-node systems. Consider the two-node graph:
   (vertex P)--directed-edge--(vertex C)
   The edge represents the relationship between nodes P and C:
     1. It may not exist (P and C are unrelated).
     2. It may be a direct edge (P is *the* parent of C).
     3. It may be an entangled edge (P is *a* mentor of C). */  
const systems = [
  {
    name: "one parent and one child node",
    parent: "parent",
    child: "child",
    isChild: true, 
    mount: mountTree
  },
  {
    name: "two unrelated root nodes",
    parent: "first root",
    child: "second root",
    mount: mountRoots
  }, 
  {
    name: "two entangled root nodes",
    parent: "affector",
    child: "affected",
    isEntangled: true,
    mount: mountEntangledRoots
  }
];

const groupByValue = state => {
  const buckets = {};
  for (let id in state) {
    const val = state[id];
    (buckets[val] = buckets[val] || []).push(id);
  }
  return buckets;
}
const getSystemDescription = state => {
  const buckets = groupByValue(state), positives = [], other = [], parts = [];
  for (let val in buckets) (val = Number(val)) > 0 ? positives.push(val) : other.push(val);
  if (other.length) parts.push(other.map(val => `${buckets[val].join(" = ")} = ${val}`).join(", "));
  if (positives.length) parts.push(positives.sort((a,b) => a-b).map(val => buckets[val].join(" = ")).join(" < "));
  return parts.join(", 0 < ")
}

// given two live nodes, oscillate them and perturb them with update photons
// this is not very DRY, but we may as well test each supported signature for frame.diff.
const oscillate = (nodes, state) => {
  const { tau_p, tau_c, tau_gp, tau_gc } = state;
  // are p and/or c already oscillating?
  if (tau_p > -1) nodes.p.setState({n: 0}, tau_p);
  if (tau_c > -1) nodes.c.setState({n: 0}, tau_c);
  // are update photons hitting p and/or c?
  if (tau_gp != null) nodes.p.setState({n: 1}, tau_gp);
  if (tau_gc != null) nodes.c.setState({n: 1}, tau_gc);
}
const oscillateDef = (nodes, state) => {
  const { tau_p, tau_c, tau_gp, tau_gc } = state;
  // are p and/or c already oscillating?
  if (tau_p > -1) nodes.p.setState({n: 0}, tau_p);
  if (tau_c > -1) nodes.c.setState({n: 0}, tau_c);
  // are update photons hitting p and/or c?
  if (tau_gp != null) nodes.p.setState({n: 1}, tau_gp < 0 ? undefined : tau_gp);
  if (tau_gc != null) nodes.c.setState({n: 1}, tau_gc < 0 ? undefined : tau_gc);
}

// XXX could add another param to control whether or not tau_gc hits before tau_gp
//   would pass to getExpectedResult, and perturb
const makeCase = (mount, state, perturb, system) => {
  const actualEvents = [], expected = getExpectedResult(state, system);
  return {
    name: `should ${expected.desc} (such that ${getSystemDescription(state)})`,
    run: () => perturb(mount(actualEvents), state),
    expected: expected.events,
    actual: actualEvents
  }
}
const makeGenCase = (name, test, check) => {
  const data = {events: []};
  return {
    name, 
    run: () => test(data), 
    check: () => check(data), 
  }
}

// XXX without the hideous code below, these tests take three orders of magnitude longer to execute
//   * all of these tests are time consuming and independent of each other
//     * decreasing T below 500ms is not an option because variance(T) ~ 1/T
//     * even if T was 50ms, total time taken ~ ALLOW*N*T ~ 2*2500*.05 seconds ~ 4 minutes
//   * mocha does not make it easy to write concurrent async tests
//     * with the DeferredTests skeleton, we run every simulation simulataneously (concurrently)
//       * total time taken becomes ~ ALLOW*T
//       * even if we increase T to 1s, our tests would still only take 2 seconds.

// we'll have redundant tests under each microstate loop, but at least they are exhaustive.
const buildMochaScaffold = () => {
  const scaffold = new DeferredTests;
  const childPhotonStates = getMicrostates(["tau_gc", "tau_p", "tau_c"], taus);
  const parentPhotonStates = getMicrostates(["tau_gp", "tau_p", "tau_c"], taus);
  const dualPhotonStates = getMicrostates(["tau_gp", "tau_gc", "tau_p", "tau_c"], taus);
  scaffold.describe("functional tau", function(){
    scaffold.push(makeGenCase(
      "should not cancel an oscillator if there is no cancellation function specified",
      data => {
        const f = diff(h(0), null, getEffs(data.events));
        data.events.length = 0;
        f.diff((start, tau, node) => {
          const t = setTimeout(() => {
            data.calledOscillator = true;
            start()
          }, T)
        })
        diff(null, f);
      },
      ({events, calledOscillator}) => {
        expect(calledOscillator).to.be.true;
        verify(events, [])
      }
    ))
    scaffold.push(makeGenCase(
      "should cancel an oscillator if there is a cancellation function specified",
      data => {
        const f = diff(h(0), null, getEffs(data.events));
        data.events.length = 0;
        f.diff((start, tau, node) => {
          const t = setTimeout(() => {
            data.calledOscillator = true;
            start()
          }, T)
          node.clear = () => clearTimeout(t);
        })
        diff(null, f);
      },
      ({events, calledOscillator}) => {
        expect(calledOscillator).to.be.undefined;
        verify(events, [])
      }
    ))
    scaffold.describe("decoherence", function(){
      scaffold.push(makeGenCase(
        "should batch === taus together",
        data => {
          data.calledOscillator = 0;
          const tau = (start, tau, node) => {
            const t = setTimeout(() => {
              data.calledOscillator++;
              start()
            }, T)
          }
          const tau2 = tau;
          const f = diff(h(0), null, getEffs(data.events));
          const f2 = diff(h(1), null, getEffs(data.events));
          data.events.length = 0;
          f.diff(tau);
          setTimeout(() => f2.diff(tau2), T/2)
        },
        ({events, calledOscillator}) => {
          expect(calledOscillator).to.equal(1);
          verify(events, [{wU: 1, dt: T, state:null}, {wU: 0, dt: T, state:null}])
        }
      ))
      scaffold.push(makeGenCase(
        "should not batch !== taus together",
        data => {
          data.calledOscillator = 0;
          const t1 = {tau: (start, tau, node) => {
            const t = setTimeout(() => {
              data.calledOscillator++;
              start()
            }, T)
          }}
          const t2 = {tau: (start, tau, node) => {
            const t = setTimeout(() => {
              data.calledOscillator++;
              start()
            }, T)
          }}
          expect(t1.tau.name).to.equal(t2.tau.name);
          expect(t1.tau).to.not.equal(t2.tau);
          const f = diff(h(0), null, getEffs(data.events));
          const f2 = diff(h(1), null, getEffs(data.events));
          data.events.length = 0;
          f.diff(t1.tau);
          f2.diff(t2.tau)
        },
        ({events, calledOscillator}) => {
          expect(calledOscillator).to.equal(2);
          verify(events, [{wU: 0, dt: T, state:null}, {wU: 1, dt: T, state:null}, ])
        }
      ))
    })
  })
  systems.forEach(s => {
    /* There are three ways we can perturb a two-node system:
         1. An update (photon) can hit P (1,0)
         2. A photon can hit C (0,1)
         3. A photon can hit both (1,1) (TODO: technically, order matters here)
         ~4. A photon does not exist (0,0) -- not tested, as not interesting. 
       Again, not very DRY, but keep in mind we're actually testing a few thousand cases here */
    scaffold.describe(`system with ${s.name}`, () => {
      scaffold.describe(`photon (tau_gp) hits ${s.parent} (tau_p) and not ${s.child} (tau_c)`, () => {
        parentPhotonStates.forEach(state => {
          scaffold.push(makeCase(s.mount, state, oscillate, s));
          if (state.tau_gp < 0){
            const defaultCase = makeCase(s.mount, state, oscillateDef, s);
            defaultCase.name += " w/ default tau"
            scaffold.push(defaultCase)
          }
        })
      })
      scaffold.describe(`photon (tau_gc) hits ${s.child} (tau_c) but not ${s.parent} (tau_p)`, () => {
        childPhotonStates.forEach(state => {
          scaffold.push(makeCase(s.mount, state, oscillate, s));
          if (state.tau_gc < 0){
            const defaultCase = makeCase(s.mount, state, oscillateDef, s);
            defaultCase.name += " w/ default tau"
            scaffold.push(defaultCase)
          }
        }) 
      })
      scaffold.describe(`photon (tau_gp) hits ${s.parent} (tau_p) then photon (tau_gc) hits ${s.child} (tau_c)`, () => {
        dualPhotonStates.forEach(state => {
          scaffold.push(makeCase(s.mount, state, oscillate, s));
          if (state.tau_gp < 0 || state.tau_gc < 0){
            const defaultCase = makeCase(s.mount, state, oscillateDef, s);
            defaultCase.name += " w/ default tau"
            scaffold.push(defaultCase)
          }
        })
      })
      // XXX could add another case where tau_gc hits before tau_gp
    })
  })
  return scaffold;
}

describe("scheduling in a 2-node system", function(){
  this.timeout(ALLOW);
  const tests = buildMochaScaffold(); // simulations are running
  before(function(done){
    tests.forEach(testCase => testCase.run())
    setTimeout(done, CHECK) // wait for simulations to finish
  })
  tests.forEach(testCase => {
    it(testCase.name, function(){
      if (testCase.check) testCase.check();
      else verify(testCase.actual, testCase.expected)
    })
  }, describe)
})
