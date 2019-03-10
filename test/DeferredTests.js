const next = (d, next) => next();
const ctx = () => ({describe: {}});
class DeferredTests {
  constructor(){
    this.ctxStack = [this.root = ctx()]
  }
  getContext(){
    const s = this.ctxStack;
    return s[s.length-1];
  }
  describe(name, cb){
    const d = this.getContext().describe;
    this.ctxStack.push(d[name] = d[name] || ctx());
    cb();
    this.ctxStack.pop();
  }
  push(c){
    const ctx = this.getContext();
    (ctx.cases = ctx.cases || []).push(c)
  }
  forEach(caseCb, ctxCb=next, ctx=this.root){
    let next = ctx.cases;
    if (next) for (let c of next) caseCb(c);
    next = ctx.describe;
    for (let d in next) ctxCb(d, () => {
      this.forEach(caseCb, ctxCb, next[d])
    })
  }
}

module.exports = DeferredTests
