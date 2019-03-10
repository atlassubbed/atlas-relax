const { Frame, diff } = require("../../");
const { toArr } = require("../util");
const { shuffle } = require("atlas-random");

class DoublyLinkedList {
  constructor(){
    this.head = null
  }
  add(data, prevNode){
    const node = {data};
    if (!prevNode) {
      if (this.head) this.head = (node.sib = this.head).prev = node;
      else (this.head = node).sib = null;
      node.prev = null;
    } else {
      if (node.sib = prevNode.sib) node.sib.prev = node;
      (node.prev = prevNode).sib = node;
    }
    return node;
  }
  rem(node){
    if (node.prev){
      if (node.prev.sib = node.sib) node.sib.prev = node.prev
    } else if (this.head = node.sib) node.sib.prev = null;
    node.sib = node.prev = null;
  }
}

let id = 0;
// edge cases:
//   * max height (linked list)
//   * max width (star)
//   * typical/log height (binary tree)
class TemplateFactory {
  constructor(Subframe, chainDepth=0){
    this.Frame = Subframe || Frame;
    if (!Subframe) while(chainDepth--)
      this.Frame = class extends this.Frame {};
  }
  h(next){
    const node = {name: this.Frame, data: {id: ++id}};
    if (next) node.next = next;
    return node;
  }
  linkedList(n){
    let node;
    while(n--) node = this.h(node);
    return node;
  }
  // balanced
  binaryTree(n){
    let nodes = [], m = n;
    while(m--) nodes.push(this.h());
    let r = nodes[n-1], i = 0, p, c1, c2;
    while(i++, p = nodes.pop()){
      const s = n - 2*i;
      if (c1 = nodes[s]) (p.next = p.next || []).push(c1);
      if (c2 = nodes[s-1]) p.next.push(c2);
    }
    return r;
  }
  star(n){
    const next = [];
    while(n-- > 1) next.push(this.h());
    return this.h(next.reverse());
  }
  keyedStar(n){
    let key = 0;
    const next = [];
    while(n-- > 1) {
      const node = this.h();
      node.key = ++key
      next.push(node)
    }
    return this.h(shuffle(next))
  }
}

const makeEntangled = tree => {
  const rootNode = diff({name: tree.name, data: tree.data})
  let node, temp, nodeStack = [rootNode], tempStack = [tree.next];
  while(node = nodeStack.pop()){
    if (temp = tempStack.pop()) toArr(temp).forEach(t => {
      const child = diff({name: t.name, data: t.data});
      tempStack.push(t.next), nodeStack.push(child);
      child.sub(node);
    })
  }
  return rootNode;
}

const count = tree => {
  let stack = [tree], n = 0, next;
  while(next = stack.pop()){
    n++;
    if (next.next) stack.push(next.next);
    if (next.ctx) stack.push(next.ctx);
    if (!next.prev) while(next = next.sib) stack.push(next);
  }
  return n;
}

const asap = Promise.resolve().then.bind(Promise.resolve())

const printHeap = () => {
  const mb = process.memoryUsage().heapUsed/(1024*1024);
  console.log(`\n${Math.floor(mb)} MB being used`)
}

const printTitle = (name, padding) => {
  const numPad = Math.max(0, padding-name.length)
  name = name + Array(numPad+1).fill().join(" ");
  process.stdout.write(`    ${name} `);
}

const doWork = n => {
  const result = [];
  while(n--) result.push({name: "div"});
}

module.exports = { 
  DoublyLinkedList, TemplateFactory, 
  count, printHeap, printTitle, doWork, asap, makeEntangled
}

