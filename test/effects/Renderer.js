const { isArr, toArr, isObj, isVoid, isFn } = require("../util")

// Base Renderer (subclasses implement attachChildren)
//   * The complicated abstration here is so that other types of renderers may extend the base renderer
//   * Given a template, recursively diff and render it into a fully evaluated literal tree
//   * The output will be used to verify the live-view is correct after a series of edits
module.exports = class Renderer {
  constructor(){
    this.tree = null, this.resetCounts();
  }
  resetCounts(){
    this.counts = {a: 0, r: 0, u: 0, n: 0, s: 0}
  }
  node({name, key, data}){
    const node = { name, next: null, sib: null };
    if (key != null) node.key = key;
    if (data != null) node.data = data;
    return node;
  }
  diff(temp){
    const { name, data, next } = temp;
    if (!isFn(name)) return next;
    const p = name.prototype, args = [{data, next}, {}];
    return p && isFn(p.render) ? p.render.apply(args[2], args) : name(...args);
  }
  renderStatic(temp){
    if (isVoid(temp)) return null;
    this.counts.n++;
    if (!isObj(temp)) 
      return this.node({name: null, data: String(temp)});
    const rendered = this.node(temp);
    let next = this.diff(temp);
    if (isVoid(next)) return rendered;
    next = [...toArr(next)];
    const nextRendered = [];
    while(next.length){
      let el = next.pop(), renderedChild;
      if (isArr(el)) next.push(...el);
      else if (renderedChild = this.renderStatic(el)){
        nextRendered.push(renderedChild);
      }
    }
    if (nextRendered.reverse().length)
      this.attachChildren(rendered, nextRendered);
    return rendered;
  }
}
