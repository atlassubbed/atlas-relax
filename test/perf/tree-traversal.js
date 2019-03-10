const { diff, Frame } = require("../../");
const { Tracker, LCRSRenderer } = require("../effects");
const { isFn } = require("../util");
const { Timer } = require("atlas-basic-timer");
const timer = Timer();

const job = f => {
  f._id = f.temp.data.id;
  console.log(`${f._id} is emitted and linked`);
  f.temp = f.affs = f._affs = f.top = f.bot = null
}
const kill = f => {
  const next = f.prev || f.parent;
  f.sib = f.parent = f.prev = f.next = null;
  console.log(f._id)
  return next;
}

const last = f => {
  let last = f.next;
  if (last) while(last.sib) last = last.sib;
  return last;
}
const trav = f => {
  while(f = f.temp && (job(f) || last(f)) || kill(f));
}

const trav2 = (f, c) => {
  while(f){
    if (f.temp){
      job(f);
      if (c = f.next) while(c.sib) c = c.sib;
      if (c) {
        f = c; 
        continue;
      }
    }
    c = f.prev || f.parent;
    f.sib = f.parent = f.prev = f.next = null;
    console.log(f._id)
    f = c;
  }
}

const h = (id, next) => ({name: "p", data: {id, upd: true}, next}) 

let temp;
timer(() => temp = h(0, [
  h(1), 
  h(2, [
    h(5), 
    h(6), 
    h(7, [
      h(9, h(11)), 
      h(10)
    ]), 
    h(8)
  ]), 
  h(3), 
  h(4)
]))
let f;
timer(() => f = diff(temp))
timer(() => trav2(f));