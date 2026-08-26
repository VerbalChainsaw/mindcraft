const { Vec3 } = require('vec3')

class Move extends Vec3 {
  constructor (x, y, z, remainingBlocks, cost, toBreak = [], toPlace = [], parkour = false, locomotion = null) {
    super(Math.floor(x), Math.floor(y), Math.floor(z))
    this.remainingBlocks = remainingBlocks
    this.cost = cost
    this.toBreak = toBreak
    this.toPlace = toPlace
    this.parkour = parkour
    this.locomotion = locomotion

    // Scaffolding is part of the planner state, not merely metadata. Routes
    // that reach the same voxel with different remaining block inventories
    // have different future movement options (bridge/tower edges), so merging
    // them in A* can discard the only route that still has enough material to
    // finish.
    this.hash = this.x + ',' + this.y + ',' + this.z + ',' + this.remainingBlocks
  }
}

module.exports = Move
