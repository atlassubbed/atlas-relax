const { Timer } = require("atlas-basic-timer");
const serial = require("atlas-serial");
const { printHeap, printTitle } = require("./helpers");
const { expect } = require("chai");

const SCALES = [50];
const SAMPLES = 2e4;
const RENDER_WORK = 0; // set to zero to compare just the implementation
const DEC = 1;
const PAD_AMT = 25;
const timer = Timer({dec: DEC});
const frames = [];

const time = (name, job, cb) => {
  printTitle(name, PAD_AMT);
  if (!cb) return timer(job, SAMPLES);
  timer(job, SAMPLES, errs => {
    if (errs.length) throw errs[0];
    cb();
  })
}

// build initial cache of trees to test
const fillCases = fillCase => {
  const cases = {
    star: {}, keyedStar: {}, binaryTree: {}, linkedList: {}
  }
  for (let c in cases){
    let cache = cases[c];
    for (let s of SCALES){
      fillCase(c, s, cases[c][s] = { temps: [] });
    }
  }
  return cases;
}
const makeTasks = (cases, subtask) => {
  const tasks = [];
  for (let c in cases){
    tasks.push(caseDone => {
      console.log(`\n${c}`);
      const subtasks = [];
      for (let s of SCALES){
        subtasks.push(taskDone => {
          console.log(`  N = ${s}`)
          subtask(c, s, taskDone)
        });
      }
      serial(subtasks, errs => {
        if (errs.length) throw errs[0];
        caseDone();
      })
    })
  }
  return tasks;
}
const runTasks = (cases, tasks) => {
  gc();
  printHeap();
  serial(tasks, () => {
    for (let c in cases){
      for (let s of SCALES){
        const cur = cases[c][s];
        const { temps } = cur;
        expect(temps).to.be.empty;
      }
    }
    frames.length = 0;
    gc();
    printHeap();
  })
}
const runTests = (cases, test) => {
  runTasks(cases, makeTasks(cases, test));
}

module.exports = { fillCases, runTests, time, frames, RENDER_WORK, SAMPLES }
