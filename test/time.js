const { expect } = require("chai")
const { pretty } = require("./util");

const T = 3000
const CHECK = T*1.3; // at least T
const ALLOW = T*1.6; // at least CHECK
const ASYNC_ERROR = t => t ? t*.15 : 150 // Promise/setTimeout(0) given leeway
const SYNC_ERROR = 25 // sync updates given less leeway
const taus = [-1, 0, T];

const projectTime = event => {
  const ev = {}, copy = {event: ev, time: event.dt};
  for (let f in event) if (f !== "dt") ev[f] = event[f];
  return copy;
}

const verify = (events, expected) => {
  let n = events.length;
  expect(n).to.equal(expected.length, pretty(events));
  for (let i = 0; i < n; i++){
    const actual = projectTime(events[i]), exp = projectTime(expected[i]);
    expect(actual.event).to.deep.equal(exp.event, pretty(events));
    if (exp.time < 0) expect(actual.time).to.be.closeTo(0, SYNC_ERROR);
    else expect(actual.time).to.be.closeTo(exp.time, ASYNC_ERROR(exp.time));
  }
}

module.exports = { ALLOW, CHECK, T, taus, verify }
