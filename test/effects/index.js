/* Plugins (e.g. renderers) are pivotal to this library
   * We use plugins in order to "self-test" the library.
   * Plugins should be as dumb as possible, but not too dumb.
     * They should be able to requeue and proxy events (XXX should/can they without async diffing?)
     * They shouldn't have to do this; an effect can be a thoughtless worker.
   * Plugins don't care about how the internal diff, subdiff, etc. functions work.
     * plugins are only concerned with whether or not they can maintain the correct tree.
     * If they can't do this, then we must change the internal code until they can. */

// f === current node, p === parent node, s === previous sibling, and i === next index
module.exports = {
  Tracker: require("./Tracker"),
  Timer: require("./Timer"),
  Cache: require("./Cache"),
  LCRSRenderer: require("./LCRSRenderer")
}
