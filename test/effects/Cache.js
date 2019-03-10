const { isArr } = require("../util");

// Cache is used to cache all frames in the constructed tree.
module.exports = class Cache {
  constructor(nodes){
    this.nodes = nodes
    this.isArr = isArr(nodes);
  }
  add(f){
    if(this.isArr) this.nodes.push(f);
    else this.nodes[f.temp.data.id] = f;
  }
}
