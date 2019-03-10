// root = 0, 1 or 2
// path = -2, -1, 0, or 1+
// evt.path = -1 or 0
// aff count = 0+

//                                step count       state
//                      --------------C------------|-S-|
//                      00000000000000000000000000000001    isChild       1
//                      00000000000000000000000000000010    isContextual  2
//                      00000000000000000000000000000100    hasEvent      4  
//                      00000000000000000000000000001000    inPath        16
// 000000000000000000000XXXXXXXXXXXXXXXXXXXXXXXXXXXX0000    X bits are reserved for a counter

// in path x root type x has event      = 2 x 3 x 2
// list of states:
// in path, child, no event
// in path, child, event
// in path, root, no event
// in path, root, event
// in path, context, no event
// in path, context, event
// not in path, child, no event
// not in path, child, event
// not in path, root, no event
// not in path, root, event
// not in path, context, no event
// not in path, context, event

