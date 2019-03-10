const { 
  Blackboxes, 
  Functionals, 
  IrreducibleFunctional
} = require("./Frames");
const { has } = require("../util");

const voidBlackboxes = [
  {name: "void (true)", get: ({v}) => v ? false : true},
  {name: "void (false)", get: ({v}) => v ? null : false},
  {name: "void (null)", get: ({v}) => v ? undefined : null},
  {name: "void (undefined)", get: ({v}) => v ? true : undefined},
  {name: "void (array)", get: ({v}) => [true, false, v ? false : null, undefined]},
  {name: "void (tensor)", get: ({v}) => [
    true, 
    [false, true, null, [undefined, [true]]],
    null, null, [null, undefined, false]
  ]}
]

const irreducibleBlackboxes = [
  {name: "literal (zero)", get: ({v}) => v ? 0.1 : 0},
  {name: "literal (number)", get: ({v}) => v ? 34532 : 23412},
  {name: "literal (empty string)", get: ({v}) => v ? " " : ""},
  {name: "literal (string)", get: ({v}) => v ? "new" : "old"},
  {name: "literal (array)", get: ({v}) => ["old", v ? 234 : -234, "last"]},
  {name: "literal (tensor)", get: ({v}) => [
    1243, 
    ["this", 234, "that", [" ", [""]]],
    "undefined", "false", [v ? "null" : "NaN", "some \n thing", 645.8]
  ]},
  {name: "irreducible (single)", get: data => ({name: "div", data})},
  {name: "irreducible (array)", get: data => [{name: "div", data}, {name: "p", data}]},
  {name: "irreducible (tensor)", get: data => [
    [{name: "div", data}], 
    [[[[{name: "p", data}]]]]
  ]},
  {name: "irreducible (nested)", get: data => ({name: "div", data, next: {name: "p", data}})},
  {name: "irreducible (nested array)", get: data => ({
    name: "div", data, next: [
      {name: "p", data, next: {name: "a", data}},
      {name: "tag", data, next: {name: "tag2", data}}
    ]
  })},
  {name: "irreducible (nested tensor)", get: data => ({
    name: "div", data, next: [[
      [[{name: "p", data, next: [{name: "a", data}]}]],
      {name: "tag", data, next: [[[{name: "tag2", data}]]]}
    ]]
  })}
]

const buildReducibles = Comps => Comps.map(Comp => {
  let { name } = Comp;
  const type = has(name, "Stateful") ? 
    "stateful" : has(name, "Legacy") ? 
    "legacy" : "stateless";
  const rank = has(name, "Scalar") ? "one" : "many";
  name = `reducible (${type}, returns ${rank})`
  return {name, get: data => ({name: Comp, data})}
})

const functionals = [
  {name: "irreducible (returns zero to many)", get: data => ({name: IrreducibleFunctional, data})},
  ...buildReducibles(Functionals)
]

module.exports = { 
  voidBlackboxes,
  irreducibleBlackboxes,
  reducibleBlackboxes: buildReducibles(Blackboxes),
  functionals
}
