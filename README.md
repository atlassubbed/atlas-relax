# atlas-relax

Relax is a minimal, powerful declarative VDOM and reactive programming framework.

[![Travis](https://img.shields.io/travis/[username]/[repo].svg)](https://travis-ci.org/[username]/[repo])

<img align="right" width="250" height="250" src="https://user-images.githubusercontent.com/38592371/54081017-120ac200-42cb-11e9-9afe-dd60f0f75fa3.gif">
---

### just relax 😌

This tiny 2.5KB (.min.gz) engine lets you define data-driven apps using declarative components. Relax combines ideas from Meteor, Mithril and Preact into one general framework. Relax supports:

  * Keyed JSX (e.g. `<li key="key1">`) for efficient diffing
  * **Sideways** reactive data between components done right
    * reactive computations
    * reactive variables
    * reactive providers
  * **Fragments** and array return values from `render`
  * Memoization as a replacement for `shouldComponentUpdate`
  * **Fibers** for efficiently tracking work that is being redone
  * **Scheduling** (async and sync)
  * Rendering-agnostic apps
    * render apps to arbitrary targets (not just the DOM)
  * Well-established algorithms to ensure updates remain efficient (O(n)) and correct
    * stack-safe
    * solves the "diamond problem" (no redundant renders)
  * Managed diffs (take imperative control when automatic diffs are too expensive)
    * **rebasing** work (add or override work in a diff)
    * **coherent** batched updates
    * **decoherent** time-sliced updates (incremental rendering)

Relax gives you what you need to build not only simple todo apps, but also rapidly-updating apps like stock tickers.

### FAQs 🤔

  1. **Is JSX necessary? No.**
  2. **Is Relax a view library? Yes.** Use a DOM-rendering plugin to render your app.
  3. **Is Relax a state management library? Yes.** Relax's state management primitives are powerful enough that you could implement your own MOBX/Redux/`Meteor.Tracker.autorun` in a few lines of code on top of Relax.
  4. **Do I need Redux or MOBX? No.** Relax's reactive primitives are sufficient for the majority of apps.
  5. **Do I need something like React hooks? No.** Sufficient lifecycle methods are provided. If you prefer hooks (closures), you could implement React hooks on top of Relax's lifecycle methods in a few lines of code.
  6. **Do updates cause the whole app to re-render? No.** Updates scale linearly with the radius of the update, not with the total graph size. If an update only affects 5 nodes, then only those 5 nodes will get their `render` called.
  7. **Do re-renders always update the DOM? No.** Mutations are calculated with a keyed diffing algorithm to limit interactions with the DOM. Plugins don't have to think -- Relax "tells plugins what to do".

### build your own X 

Relax abstracts out the heavy lifting associated with building frameworks (reconciliation, efficient data flow propagation, reactive functions, etc.). Many frameworks can be built in a few lines of code with Relax's primitives:
  
  * React DOM
  * MOBX
  * Redux

Relax's inner-diff (instance-level `diff`) API is inspired by Mithril's `redraw`. If you prefer React syntax, hooks and other React-like APIs can also be built pretty easily with Relax's primitives:

  * `setState`
  * functional `setState`
  * `useEffect`
  * `useLayoutEffect`
  * `useState`
  * `useRef`
  * Sky is the limit: `afterAll`, `after`, `before`, `beforeAll`, `afterMount`, `beforeUnmount`, `afterUpdate`

If you've ever tinkered with Meteor, you've probably been obsessed with `Tracker.autorun` at some point. Nobody blames you -- it is awesome. If you wanted to, you could implement the exact same API using Relax nodes as Relax supports dependency graphs out-of-the-box. Relax makes it easy to implement reactive patterns such as:
  
  * `Meteor.Tracker`
  * `Meteor.ReactiveVar`
  * `Meteor.ReactiveDict`
  * `Meteor.Collection` (reactive collection)
  * Efficient `Meteor.Collection.find` that supports sort, filter, and multiple listeners per query

### notes

Relax is an experimental framework and your feedback is greatly appreciated! If Relax has piqued your interest, 👀 read the source code! I've included implementation comments for your reference. There are a few things I want to implement in the future:

  1. Make plugins agnostic to reducible nodes (makes DOM rendering more efficient)
  2. Error boundaries -- they're useful for larger apps.
     * not as easy to implement as in React, since we may generalize it to DAGs
  3. Ensure DOM renderers can properly hydrate an existing tree to decrease time-to-mount
  4. Docs, demos and examples 
     * Basic DOM Renderer (plugin) in 20 lines of code
     * Functional reactive framework in 20 lines of code
  5. Re-roll code into modules, provide optimized `dist/` files
     * Use rollup, babel and terser to generate ready-to-use distribution payloads

### inspired by 💜

Meteor, Mithril, Preact and physics analogies. MIT License.

The gif above was made with the help of Paul Falstad's [atomic dipole transition applet](http://www.falstad.com/qmatomrad/). Check out his other amazing interactive physics playgrounds over at his website: [http://www.falstad.com/mathphysics.html](http://www.falstad.com/mathphysics.html).
