const { Vec3 } = require('vec3')
const nbt = require('prismarine-nbt')
const Move = require('./move')

const cardinalDirections = [
  { x: -1, z: 0 }, // West
  { x: 1, z: 0 }, // East
  { x: 0, z: -1 }, // North
  { x: 0, z: 1 } // South
]
const diagonalDirections = [
  { x: -1, z: -1 },
  { x: -1, z: 1 },
  { x: 1, z: -1 },
  { x: 1, z: 1 }
]

class Movements {
  constructor (bot) {
    const registry = bot.registry
    this.bot = bot

    this.canDig = true
    this.digCost = 1
    this.placeCost = 1
    this.liquidCost = 1
    this.entityCost = 1

    this.dontCreateFlow = true
    this.dontMineUnderFallingBlock = true
    // Physical block placement is a separate authority from opening a door.
    // Callers may disable bridge, step-fill, and tower edges while retaining
    // native locomotion and openable interactions.
    this.canPlaceBlocks = true
    this.allow1by1towers = true
    this.allowFreeMotion = false
    this.allowParkour = true
    // Flat and descending parkour use predictable ballistic paths. An
    // ascending gap jump currently has no reliable execution settlement and
    // must not be advertised to A* as an executable edge.
    this.allowParkourAscend = false
    this.allowSprinting = true
    this.allowEntityDetection = true
    // Callers that explicitly authorize temporary building may bound and
    // account for every physical placement. Ordinary movement leaves the
    // bound infinite but still has allow1by1towers disabled by V2 policy.
    this.maxScaffoldingPlacements = Infinity
    this.scaffoldingPlacementsUsed = 0
    this.onBlockPlaced = null

    this.entitiesToAvoid = new Set()
    this.passableEntities = new Set(require('./passableEntities.json'))
    this.interactableBlocks = new Set(require('./interactable.json'))

    this.blocksCantBreak = new Set()
    this.blocksCantBreak.add(registry.blocksByName.chest.id)

    registry.blocksArray.forEach(block => {
      if (block.diggable) return
      this.blocksCantBreak.add(block.id)
    })

    this.blocksToAvoid = new Set()
    this.blocksToAvoid.add(registry.blocksByName.fire.id)
    if (registry.blocksByName.cobweb) this.blocksToAvoid.add(registry.blocksByName.cobweb.id)
    if (registry.blocksByName.web) this.blocksToAvoid.add(registry.blocksByName.web.id)

    // Only avoid lava if bot is not currently in lava
    // Check if bot.entity exists and is initialized
    if (!bot.entity || !bot.entity.isInLava) {
      this.blocksToAvoid.add(registry.blocksByName.lava.id)
    }

    this.liquids = new Set()
    this.liquids.add(registry.blocksByName.water.id)
    this.liquids.add(registry.blocksByName.lava.id)

    this.gravityBlocks = new Set()
    this.gravityBlocks.add(registry.blocksByName.sand.id)
    this.gravityBlocks.add(registry.blocksByName.gravel.id)

    this.climbables = new Set()
    this.climbables.add(registry.blocksByName.ladder.id)
    if (registry.blocksByName.vine) this.climbables.add(registry.blocksByName.vine.id)
    this.emptyBlocks = new Set()

    this.replaceables = new Set()
    this.replaceables.add(registry.blocksByName.air.id)
    if (registry.blocksByName.cave_air) this.replaceables.add(registry.blocksByName.cave_air.id)
    if (registry.blocksByName.void_air) this.replaceables.add(registry.blocksByName.void_air.id)
    this.replaceables.add(registry.blocksByName.water.id)
    this.replaceables.add(registry.blocksByName.lava.id)

    this.scafoldingBlocks = []
    this.scafoldingBlocks.push(registry.itemsByName.dirt.id)
    this.scafoldingBlocks.push(registry.itemsByName.cobblestone.id)

    const Block = require('prismarine-block')(bot.registry)
    this.fences = new Set()
    this.carpets = new Set()
    this.openable = new Set()
    registry.blocksArray.map(x => Block.fromStateId(x.minStateId, 0)).forEach(block => {
      if (block.shapes.length > 0) {
        // Fences or any block taller than 1, they will be considered as non-physical to avoid
        // trying to walk on them
        if (block.shapes[0][4] > 1) this.fences.add(block.type)
        // Carpets or any blocks smaller than 0.1, they will be considered as safe to walk in
        if (block.shapes[0][4] < 0.1) this.carpets.add(block.type)
      } else if (block.shapes.length === 0) {
        this.emptyBlocks.add(block.type)
      }
    })
    registry.blocksArray.forEach(block => {
      if (this.interactableBlocks.has(block.name)
        && (block.name.toLowerCase().includes('gate') || block.name.toLowerCase().includes('door') || block.name.toLowerCase().includes('trapdoor'))
        && !block.name.toLowerCase().includes('iron')) {
        // console.info(block)
        this.openable.add(block.id)
      }
    })

    this.canOpenDoors = true

    this.exclusionAreasStep = []
    this.exclusionAreasBreak = []
    this.exclusionAreasPlace = []

    this.maxDropDown = 4
    this.infiniteLiquidDropdownDistance = true

    this.entityIntersections = {}
  }

  makeMove (node, x, y, z, remainingBlocks, cost, toBreak = [], toPlace = [], type = 'walk', parkour = false, locomotion = {}) {
    return new Move(x, y, z, remainingBlocks, cost, toBreak, toPlace, parkour, {
      type,
      source: { x: node.x, y: node.y, z: node.z },
      ...locomotion
    })
  }

  remainingScaffoldingAfter (node, actions) {
    const consumed = actions.reduce((count, action) => count + (action?.useOne ? 0 : 1), 0)
    return node.remainingBlocks - consumed
  }

  openableAction (node, block) {
    if (!this.canOpenDoors || !block.openable || block._properties?.open === true) return null
    // An open door or fence gate is not empty space: activation rotates its
    // collision plane. It is traversable only front-to-back along the axis
    // named by its facing. Approaching laterally can rotate the fixture into
    // the requested step, leaving Pathfinder jumping beside the hinge while
    // its close/reopen lifecycle repeatedly services an edge that never
    // existed physically.
    const facing = block._properties?.facing
    const dx = Math.sign(block.position.x - node.x)
    const dz = Math.sign(block.position.z - node.z)
    const crossesFixturePlane = ['north', 'south'].includes(facing)
      ? dx === 0 && dz !== 0
      : ['east', 'west'].includes(facing)
          ? dz === 0 && dx !== 0
          : false
    if (!crossesFixturePlane) return null
    return {
      x: block.position.x,
      y: block.position.y,
      z: block.position.z,
      dx: 0,
      dy: 0,
      dz: 0,
      useOne: true,
      closeAfterCrossing: {
        source: { x: node.x, y: node.y, z: node.z },
        destination: { x: block.position.x, y: block.position.y, z: block.position.z }
      }
    }
  }

  exclusionPlace (block) {
    return this.exclusionWeight(this.exclusionAreasPlace, block)
  }

  exclusionStep (block) {
    return this.exclusionWeight(this.exclusionAreasStep, block)
  }

  exclusionBreak (block) {
    return this.exclusionWeight(this.exclusionAreasBreak, block)
  }

  exclusionWeight (areas, block) {
    if (areas.length === 0) return 0
    let weight = 0
    for (const a of areas) {
      weight += a(block)
    }
    // The public exclusion callback contract reserves a weight of 100 (or a
    // larger accumulated weight) for a prohibited interaction. Normalize that
    // policy sentinel here so ordinary movement costs can grow without being
    // mistaken for an impossible edge.
    return weight >= 100 ? Infinity : weight
  }

  countScaffoldingItems () {
    let count = 0
    const items = this.bot.inventory.items()
    for (const id of this.scafoldingBlocks) {
      for (const j in items) {
        const item = items[j]
        if (item.type === id) count += item.count
      }
    }
    const configuredLimit = Number(this.maxScaffoldingPlacements)
    const remainingLimit = Number.isFinite(configuredLimit)
      ? Math.max(0, Math.floor(configuredLimit) - this.scaffoldingPlacementsUsed)
      : count
    return Math.min(count, remainingLimit)
  }

  recordScaffoldingPlacement (placement) {
    this.scaffoldingPlacementsUsed += 1
    if (typeof this.onBlockPlaced === 'function') this.onBlockPlaced(placement)
  }

  getScaffoldingItem () {
    const items = this.bot.inventory.items()
    for (const id of this.scafoldingBlocks) {
      for (const j in items) {
        const item = items[j]
        if (item.type === id) return item
      }
    }
    return null
  }

  clearCollisionIndex () {
    this.entityIntersections = {}
  }

  /**
   * Finds blocks intersected by entity bounding boxes
   * and sets the number of ents intersecting in a dict.
   * Ignores entities that do not affect block placement
   */
  updateCollisionIndex () {
    for (const ent of Object.values(this.bot.entities)) {
      if (ent === this.bot.entity) { continue }

      const avoidedEnt = this.entitiesToAvoid.has(ent.name)
      if (avoidedEnt || !this.passableEntities.has(ent.name)) {
        const entSquareRadius = ent.width / 2.0
        const minY = Math.floor(ent.position.y)
        const maxY = Math.ceil(ent.position.y + ent.height)
        const minX = Math.floor(ent.position.x - entSquareRadius)
        const maxX = Math.ceil(ent.position.x + entSquareRadius)
        const minZ = Math.floor(ent.position.z - entSquareRadius)
        const maxZ = Math.ceil(ent.position.z + entSquareRadius)

        // Keep policy prohibition separate from ordinary traversal cost. Slow
        // digging can legitimately cost more than 100, while an avoided
        // entity's occupied cells must never become selectable merely because
        // A* is willing to pay that labor cost.
        const cost = avoidedEnt ? Infinity : 1

        for (let y = minY; y < maxY; y++) {
          for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
              this.entityIntersections[`${x},${y},${z}`] = this.entityIntersections[`${x},${y},${z}`] ?? 0
              this.entityIntersections[`${x},${y},${z}`] += cost // More ents = more weight
            }
          }
        }
      }
    }
  }

  /**
   * Gets number of entities who's bounding box intersects the node + offset
   * @param {import('vec3').Vec3} pos node position
   * @param {number} dx X axis offset
   * @param {number} dy Y axis offset
   * @param {number} dz Z axis offset
   * @returns {number} Number of entities intersecting block
   */
  getNumEntitiesAt (pos, dx, dy, dz) {
    if (this.allowEntityDetection === false) return 0
    if (!pos) return 0
    const y = pos.y + dy
    const x = pos.x + dx
    const z = pos.z + dz

    return this.entityIntersections[`${x},${y},${z}`] ?? 0
  }

  getBlock (pos, dx, dy, dz) {
    const b = pos ? this.bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz), false) : null
    if (!b) {
      return {
        replaceable: false,
        canFall: false,
        safe: false,
        physical: false,
        liquid: false,
        climbable: false,
        height: dy,
        openable: false
      }
    }
    b.climbable = this.climbables.has(b.type)

    // Enhanced trapdoor logic - open trapdoors are safe to pass through
    const isOpenTrapdoor = this.openable.has(b.type) && b.name.includes('trapdoor') && b._properties?.open === true
    const isClosedTrapdoor = this.openable.has(b.type) && b.name.includes('trapdoor') && b._properties?.open !== true

    b.safe = (b.boundingBox === 'empty' || b.climbable || this.carpets.has(b.type) || isOpenTrapdoor) && !this.blocksToAvoid.has(b.type)
    b.physical = (b.boundingBox === 'block' && !this.fences.has(b.type)) || isClosedTrapdoor
    b.replaceable = this.replaceables.has(b.type) && !b.physical
    b.liquid = this.liquids.has(b.type)
    b.height = pos.y + dy
    b.canFall = this.gravityBlocks.has(b.type)
    b.openable = this.openable.has(b.type)

    for (const shape of b.shapes) {
      b.height = Math.max(b.height, pos.y + dy + shape[4])
    }
    return b
  }

  /**
   * Takes into account if the block is within a break exclusion area.
   * @param {import('prismarine-block').Block} block
   * @returns
   */
  safeToBreak (block) {
    if (!this.canDig) {
      return false
    }

    if (this.dontCreateFlow) {
      // false if next to liquid
      if (this.getBlock(block.position, 0, 1, 0).liquid) return false
      if (this.getBlock(block.position, -1, 0, 0).liquid) return false
      if (this.getBlock(block.position, 1, 0, 0).liquid) return false
      if (this.getBlock(block.position, 0, 0, -1).liquid) return false
      if (this.getBlock(block.position, 0, 0, 1).liquid) return false
    }

    if (this.dontMineUnderFallingBlock) {
      // TODO: Determine if there are other blocks holding the entity up
      if (this.getBlock(block.position, 0, 1, 0).canFall || (this.getNumEntitiesAt(block.position, 0, 1, 0) > 0)) {
        return false
      }
    }

    return block.type && !this.blocksCantBreak.has(block.type) && Number.isFinite(this.exclusionBreak(block))
  }

  /**
   * Returns a finite traversal cost for passable or breakable blocks, and
   * Infinity when the interaction is prohibited.
   * @param {import('prismarine-block').Block} block block
   * @param {[]} toBreak
   * @returns {number}
   */
  safeOrBreak (block, toBreak) {
    let cost = 0
    cost += this.exclusionStep(block) // Is excluded so can't move or break
    cost += this.getNumEntitiesAt(block.position, 0, 0, 0) * this.entityCost
    if (block.safe) return cost

    // process door cost
    if ((this.canOpenDoors && block.openable)
      || (block.openable && block._properties?.open === true)) {
      return cost
    }

    // Handle trapdoors specifically - they can be opened instead of broken
    if (this.canOpenDoors && block.openable && block.name.includes('trapdoor') && !block.name.includes('iron')) {
      return cost + 1 // Small cost for opening trapdoor
    }

    if (!this.safeToBreak(block)) return Infinity
    toBreak.push(block.position)

    if (block.physical) cost += this.getNumEntitiesAt(block.position, 0, 1, 0) * this.entityCost // Add entity cost if there is an entity above (a breakable block) that will fall

    const tool = this.bot.pathfinder.bestHarvestTool(block)
    const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
    const effects = this.bot.entity.effects
    const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
    const laborCost = (1 + 3 * digTime / 1000) * this.digCost
    cost += laborCost
    return cost
  }

  getMoveJumpUp (node, dir, neighbors) {
    const blockA = this.getBlock(node, 0, 2, 0)
    const blockH = this.getBlock(node, dir.x, 2, dir.z)
    const blockB = this.getBlock(node, dir.x, 1, dir.z)
    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const block0 = this.getBlock(node, 0, -1, 0)

    // Doors and gates are traversable body cells after activation, never a
    // solid launch platform. Treating the lower half beneath a node as full
    // support advertises a synthetic step-up from inside the fixture; the
    // executor then jumps against its collision plane forever. Keep ordinary
    // horizontal door traversal, but make A* leave the doorway before it may
    // climb. Trapdoors retain their dedicated movement handling below.
    if (
      (block0.openable && !String(block0.name || '').includes('trapdoor')) ||
      (blockC.openable && !String(blockC.name || '').includes('trapdoor'))
    ) return

    let cost = 2 // move cost (move+jump)
    const toBreak = []
    const toPlace = []

    if (blockA.physical && (this.getNumEntitiesAt(blockA.position, 0, 1, 0) > 0)) return // Blocks A, B and H are above C, D and the player's space, we need to make sure there are no entities that will fall down onto our building space if we break them
    if (blockH.physical && (this.getNumEntitiesAt(blockH.position, 0, 1, 0) > 0)) return
    if (blockB.physical && !blockH.physical && !blockC.physical && (this.getNumEntitiesAt(blockB.position, 0, 1, 0) > 0)) return // It is fine if an ent falls on B so long as we don't need to replace block C

    if (!blockC.physical) {
      if (this.canPlaceBlocks === false) return
      if (node.remainingBlocks === 0) return // not enough blocks to place

      if (this.getNumEntitiesAt(blockC.position, 0, 0, 0) > 0) return // Check for any entities in the way of a block placement

      const blockD = this.getBlock(node, dir.x, -1, dir.z)
      if (!blockD.physical) {
        if (node.remainingBlocks === 1) return // not enough blocks to place

        if (this.getNumEntitiesAt(blockD.position, 0, 0, 0) > 0) return // Check for any entities in the way of a block placement

        if (!blockD.replaceable) {
          if (!this.safeToBreak(blockD)) return
          cost += this.exclusionBreak(blockD)
          toBreak.push(blockD.position)
        }
        cost += this.exclusionPlace(blockD)
        toPlace.push({ x: node.x, y: node.y - 1, z: node.z, dx: dir.x, dy: 0, dz: dir.z, returnPos: new Vec3(node.x, node.y, node.z) })
        cost += this.placeCost // additional cost for placing a block
      }

      if (!blockC.replaceable) {
        if (!this.safeToBreak(blockC)) return
        cost += this.exclusionBreak(blockC)
        toBreak.push(blockC.position)
      }
      cost += this.exclusionPlace(blockC)
      toPlace.push({ x: node.x + dir.x, y: node.y - 1, z: node.z + dir.z, dx: 0, dy: 1, dz: 0 })
      cost += this.placeCost // additional cost for placing a block

      blockC.height += 1
    }

    const current = this.getBlock(node, 0, 0, 0)
    // In water the body launches from the occupied liquid cell, not from the
    // solid floor beneath the column. Measuring from that floor turns an
    // ordinary one-block shore into a synthetic two-block jump and removes
    // the native exit edge from the graph.
    const launchHeight = current.liquid ? current.height : block0.height
    if (blockC.height - launchHeight > 1.2) return // Too high to jump

    cost += this.safeOrBreak(blockA, toBreak)
    if (!Number.isFinite(cost)) return
    cost += this.safeOrBreak(blockH, toBreak)
    if (!Number.isFinite(cost)) return
    const openableAction = this.openableAction(node, blockB)
    if (openableAction) {
      toPlace.push(openableAction)
    } else {
      // A closed fixture rejected by openableAction is being approached from
      // an axis its opened collision plane would block. Do not let the generic
      // openable shortcut in safeOrBreak recreate that impossible edge. An
      // already-open fixture remains eligible only when its actual shape is
      // safe for the candidate body cell.
      if (blockB.openable && !blockB.safe) return
      cost += this.safeOrBreak(blockB, toBreak)
      if (!Number.isFinite(cost)) return
    }

    neighbors.push(this.makeMove(node, blockB.position.x, blockB.position.y, blockB.position.z, this.remainingScaffoldingAfter(node, toPlace), cost, toBreak, toPlace, 'step_up'))
  }

  getMoveForward (node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z)
    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const blockD = this.getBlock(node, dir.x, -1, dir.z)
    const sourceSupport = this.getBlock(node, 0, -1, 0)

    let cost = 1 // move cost
    cost += this.exclusionStep(blockC)

    const toBreak = []
    const toPlace = []

    if (!blockD.physical && !blockC.liquid) {
      if (this.canPlaceBlocks === false) return
      if (node.remainingBlocks === 0) return // not enough blocks to place

      if (this.getNumEntitiesAt(blockD.position, 0, 0, 0) > 0) return // D intersects an entity hitbox

      if (!blockD.replaceable) {
        if (!this.safeToBreak(blockD)) return
        cost += this.exclusionBreak(blockD)
        toBreak.push(blockD.position)
      }
      cost += this.exclusionPlace(blockC)
      toPlace.push({ x: node.x, y: node.y - 1, z: node.z, dx: dir.x, dy: 0, dz: dir.z })
      cost += this.placeCost // additional cost for placing a block
    }

    // Open fence gates and doors
    const openableAction = this.openableAction(node, blockC)
    // A two-block door opens as one fixture. Its upper half occupies the head
    // cell but is not a separate obstruction to break; evaluating it before
    // the lower-half openable action removes the ordinary horizontal doorway
    // edge and makes A* prefer a synthetic climb over the door instead.
    const pairedOpenableHead = Boolean(
      openableAction &&
      blockB.openable &&
      blockB.name === blockC.name &&
      blockB.position.x === blockC.position.x &&
      blockB.position.z === blockC.position.z
    )
    if (!pairedOpenableHead) {
      if (blockB.openable && !blockB.safe && !openableAction) return
      cost += this.safeOrBreak(blockB, toBreak)
      if (!Number.isFinite(cost)) return
    }

    if (openableAction) {
      toPlace.push(openableAction)
    } else {
      if (blockC.openable && !blockC.safe) return
      cost += this.safeOrBreak(blockC, toBreak)
      if (!Number.isFinite(cost)) return
    }

    if (this.getBlock(node, 0, 0, 0).liquid) cost += this.liquidCost

    neighbors.push(this.makeMove(
      node,
      blockC.position.x,
      blockC.position.y,
      blockC.position.z,
      this.remainingScaffoldingAfter(node, toPlace),
      cost,
      toBreak,
      toPlace,
      'walk',
      false,
      { supportDelta: blockD.height - sourceSupport.height }
    ))
  }

  getMoveDiagonal (node, dir, neighbors) {
    let cost = Math.SQRT2 // move cost
    const toBreak = []

    const blockC = this.getBlock(node, dir.x, 0, dir.z) // Landing block or standing on block when jumping up by 1
    const y = blockC.physical ? 1 : 0

    const block0 = this.getBlock(node, 0, -1, 0)

    let cost1 = 0
    const toBreak1 = []
    const blockB1 = this.getBlock(node, 0, y + 1, dir.z)
    const blockC1 = this.getBlock(node, 0, y, dir.z)
    const blockD1 = this.getBlock(node, 0, y - 1, dir.z)
    cost1 += this.safeOrBreak(blockB1, toBreak1)
    cost1 += this.safeOrBreak(blockC1, toBreak1)
    if (blockD1.height - block0.height > 1.2) cost1 += this.safeOrBreak(blockD1, toBreak1)

    let cost2 = 0
    const toBreak2 = []
    const blockB2 = this.getBlock(node, dir.x, y + 1, 0)
    const blockC2 = this.getBlock(node, dir.x, y, 0)
    const blockD2 = this.getBlock(node, dir.x, y - 1, 0)
    cost2 += this.safeOrBreak(blockB2, toBreak2)
    cost2 += this.safeOrBreak(blockC2, toBreak2)
    if (blockD2.height - block0.height > 1.2) cost2 += this.safeOrBreak(blockD2, toBreak2)

    if (cost1 < cost2) {
      cost += cost1
      toBreak.push(...toBreak1)
    } else {
      cost += cost2
      toBreak.push(...toBreak2)
    }
    if (!Number.isFinite(cost)) return

    cost += this.safeOrBreak(this.getBlock(node, dir.x, y, dir.z), toBreak)
    if (!Number.isFinite(cost)) return
    cost += this.safeOrBreak(this.getBlock(node, dir.x, y + 1, dir.z), toBreak)
    if (!Number.isFinite(cost)) return

    if (this.getBlock(node, 0, 0, 0).liquid) cost += this.liquidCost

    const blockD = this.getBlock(node, dir.x, -1, dir.z)
    if (y === 1) { // Case jump up by 1
      if (blockC.height - block0.height > 1.2) return // Too high to jump
      cost += this.safeOrBreak(this.getBlock(node, 0, 2, 0), toBreak)
      if (!Number.isFinite(cost)) return
      cost += 1
      neighbors.push(this.makeMove(node, blockC.position.x, blockC.position.y + 1, blockC.position.z, node.remainingBlocks, cost, toBreak, [], 'step_up'))
    } else if (blockD.physical || blockC.liquid) {
      neighbors.push(this.makeMove(
        node,
        blockC.position.x,
        blockC.position.y,
        blockC.position.z,
        node.remainingBlocks,
        cost,
        toBreak,
        [],
        'walk',
        false,
        { supportDelta: blockD.height - block0.height }
      ))
    } else if (this.getBlock(node, dir.x, -2, dir.z).physical || blockD.liquid) {
      if (!blockD.safe) return // don't self-immolate
      cost += this.getNumEntitiesAt(blockC.position, 0, -1, 0) * this.entityCost
      neighbors.push(this.makeMove(node, blockC.position.x, blockC.position.y - 1, blockC.position.z, node.remainingBlocks, cost, toBreak, [], 'drop_down'))
    }
  }

  getLandingBlock (node, dir) {
    let blockLand = this.getBlock(node, dir.x, -2, dir.z)
    while (blockLand.position && blockLand.position.y > this.bot.game.minY) {
      if (blockLand.liquid && blockLand.safe) return blockLand
      if (blockLand.physical) {
        const standingBlock = this.getBlock(blockLand.position, 0, 1, 0)
        // maxDropDown is a locomotion limit between standing cells, not a
        // distance to the destination's support block. Comparing against the
        // support made a one-block descent consume two blocks of budget and
        // silently removed ordinary stair steps when maxDropDown was 1.
        if (node.y - standingBlock.position.y <= this.maxDropDown) return standingBlock
        return null
      }
      if (!blockLand.safe) return null
      blockLand = this.getBlock(blockLand.position, 0, -1, 0)
    }
    return null
  }

  getMoveDropDown (node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z)
    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const blockD = this.getBlock(node, dir.x, -1, dir.z)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []

    const blockLand = this.getLandingBlock(node, dir)
    if (!blockLand) return
    if (!this.infiniteLiquidDropdownDistance && ((node.y - blockLand.position.y) > this.maxDropDown)) return // Don't drop down into water

    cost += this.safeOrBreak(blockB, toBreak)
    if (!Number.isFinite(cost)) return
    cost += this.safeOrBreak(blockC, toBreak)
    if (!Number.isFinite(cost)) return
    cost += this.safeOrBreak(blockD, toBreak)
    if (!Number.isFinite(cost)) return

    if (blockC.liquid) return // dont go underwater

    cost += this.getNumEntitiesAt(blockLand.position, 0, 0, 0) * this.entityCost // add cost for entities

    neighbors.push(this.makeMove(node, blockLand.position.x, blockLand.position.y, blockLand.position.z, this.remainingScaffoldingAfter(node, toPlace), cost, toBreak, toPlace, 'drop_down'))
  }

  getMoveDown (node, neighbors) {
    const block0 = this.getBlock(node, 0, -1, 0)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []

    const blockLand = this.getLandingBlock(node, { x: 0, z: 0 })
    if (!blockLand) return

    cost += this.safeOrBreak(block0, toBreak)
    if (!Number.isFinite(cost)) return

    if (this.getBlock(node, 0, 0, 0).liquid) return // dont go underwater

    cost += this.getNumEntitiesAt(blockLand.position, 0, 0, 0) * this.entityCost // add cost for entities

    neighbors.push(this.makeMove(node, blockLand.position.x, blockLand.position.y, blockLand.position.z, this.remainingScaffoldingAfter(node, toPlace), cost, toBreak, toPlace, 'fall_down'))
  }

  getMoveSwimUp (node, neighbors) {
    const current = this.getBlock(node, 0, 0, 0)
    const destination = this.getBlock(node, 0, 1, 0)
    const head = this.getBlock(node, 0, 2, 0)
    const waterType = this.bot.registry.blocksByName.water.id

    // A submerged route must first converge on the top water cell. The
    // executor can hold jump, but A* previously advertised only level liquid
    // nodes, so the executor deliberately withheld jump and the bot walked
    // along the bottom until drowning preempted the route. Keep this a native
    // movement edge: ordinary travel still owns the destination and the
    // package owns how the body reaches it.
    if (!current || !destination || !head) return false
    if (current.type !== waterType) return false
    // The top water cell must connect to the clear feet cell immediately
    // above it. Without that final native edge, A* can swim to the surface
    // but cannot compose the following step-up onto an ordinary bank. The
    // existing safe-cell predicate admits both water and collision-free air.
    if (!destination.safe || !head.safe) return false
    if (this.getNumEntitiesAt(node, 0, 1, 0) > 0) return false

    const cost = 1 + this.liquidCost + this.exclusionStep(destination)
    if (!Number.isFinite(cost)) return false
    neighbors.push(this.makeMove(
      node,
      node.x,
      node.y + 1,
      node.z,
      node.remainingBlocks,
      cost,
      [],
      [],
      'swim_up'
    ))
    return destination.type === waterType ? 'submerged' : 'surface'
  }

  getMoveUp (node, neighbors) {
    const block1 = this.getBlock(node, 0, 0, 0)
    if (block1.liquid) return
    if (this.getNumEntitiesAt(node, 0, 0, 0) > 0) return // an entity (besides the player) is blocking the building area

    const block2 = this.getBlock(node, 0, 2, 0)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    cost += this.safeOrBreak(block2, toBreak)
    if (!Number.isFinite(cost)) return

    if (block1.climbable) {
      // A climb node is transient, not literal ground. The installed physics
      // can keep ascending only while the destination feet cell is also a
      // supported ladder/vine. Advertising the air cell above the top of a
      // vine makes A* end on an unoccupiable node and the executor jump until
      // its stall watchdog fires. Exiting onto a ledge is an ordinary
      // horizontal move from the last real climbable cell.
      const destination = this.getBlock(node, 0, 1, 0)
      if (!destination.climbable) return
    } else {
      if (this.canPlaceBlocks === false || !this.allow1by1towers || node.remainingBlocks === 0) return // not enough blocks to place

      if (!block1.replaceable) {
        if (!this.safeToBreak(block1)) return
        toBreak.push(block1.position)
      }

      const block0 = this.getBlock(node, 0, -1, 0)
      if (block0.physical && block0.height - node.y < -0.2) return // cannot jump-place from a half block

      cost += this.exclusionPlace(block1)
      toPlace.push({ x: node.x, y: node.y - 1, z: node.z, dx: 0, dy: 1, dz: 0, jump: true })
      cost += this.placeCost // additional cost for placing a block
    }

    if (!Number.isFinite(cost)) return

    neighbors.push(this.makeMove(node, node.x, node.y + 1, node.z, this.remainingScaffoldingAfter(node, toPlace), cost, toBreak, toPlace, 'vertical_up'))
  }

  getMoveClimbUpThroughTrapdoor (node, neighbors) {
    const blockCurrent = this.getBlock(node, 0, 0, 0) // Current position (should be climbable)
    const blockAbove = this.getBlock(node, 0, 1, 0) // Block directly above
    const blockCeiling = this.getBlock(node, 0, 2, 0) // Trapdoor or ceiling block

    // Only attempt this move if we're on a climbable block (ladder/vine)
    if (!blockCurrent.climbable) return

    // Check if there's a closed trapdoor above us
    if (!blockCeiling.openable || blockCeiling._properties?.open === true) return

    let cost = 2 // Base cost for climbing up and opening trapdoor
    const toBreak = []
    const toPlace = []

    // Make sure we can break/pass through the block above if needed
    cost += this.safeOrBreak(blockAbove, toBreak)
    if (!Number.isFinite(cost)) return

    // Add cost for opening the trapdoor
    toPlace.push({ x: node.x, y: node.y + 2, z: node.z, dx: 0, dy: 0, dz: 0, useOne: true })

    neighbors.push(this.makeMove(node, node.x, node.y + 2, node.z, this.remainingScaffoldingAfter(node, toPlace), cost, toBreak, toPlace, 'climb_up'))
  }

  startTransitionIsExecutable (node, neighbor) {
    const start = node?.physicalStart
    if (!start || !neighbor) return true

    const sourcePosition = new Vec3(
      Math.floor(start.x),
      Math.floor(start.y),
      Math.floor(start.z)
    )
    const sourceBlock = this.bot.blockAt(sourcePosition, false)
    if (!sourceBlock?.position || !Array.isArray(sourceBlock.shapes) || sourceBlock.shapes.length === 0) return true

    const width = Number(start.width)
    const height = Number(start.height)
    const halfWidth = Number.isFinite(width) && width > 0 ? width / 2 : 0.3
    const bodyHeight = Number.isFinite(height) && height > 0 ? height : 1.8
    const target = {
      x: neighbor.x + 0.5,
      y: neighbor.y,
      z: neighbor.z + 0.5
    }
    const sweep = {
      minX: Math.min(start.x, target.x) - halfWidth,
      maxX: Math.max(start.x, target.x) + halfWidth,
      minY: Math.min(start.y, target.y),
      maxY: Math.max(start.y, target.y) + bodyHeight,
      minZ: Math.min(start.z, target.z) - halfWidth,
      maxZ: Math.max(start.z, target.z) + halfWidth
    }
    const locomotion = neighbor.locomotion?.type
    const canJumpClear = locomotion === 'step_up' || locomotion === 'drop_down'
    const jumpHeight = 1.25
    const epsilon = 1e-6

    return !sourceBlock.shapes.some(shape => {
      if (!Array.isArray(shape) || shape.length < 6 || !shape.every(Number.isFinite)) return true
      const collision = {
        minX: sourceBlock.position.x + shape[0],
        minY: sourceBlock.position.y + shape[1],
        minZ: sourceBlock.position.z + shape[2],
        maxX: sourceBlock.position.x + shape[3],
        maxY: sourceBlock.position.y + shape[4],
        maxZ: sourceBlock.position.z + shape[5]
      }
      const overlapsSweep = sweep.minX < collision.maxX - epsilon &&
        sweep.maxX > collision.minX + epsilon &&
        sweep.minY < collision.maxY - epsilon &&
        sweep.maxY > collision.minY + epsilon &&
        sweep.minZ < collision.maxZ - epsilon &&
        sweep.maxZ > collision.minZ + epsilon
      if (!overlapsSweep) return false

      // Native jump execution can leave low enclosing blocks such as a
      // cauldron. A fence or wall rises 1.5 blocks above the feet and cannot
      // be cleared by the ordinary 1.25-block jump, so that edge must not enter
      // the graph in the first place.
      return !canJumpClear || collision.maxY - start.y > jumpHeight + epsilon
    })
  }

  // Jump up, down or forward over a 1 block gap
  getMoveParkourForward (node, dir, neighbors) {
    const block0 = this.getBlock(node, 0, -1, 0)
    const block1 = this.getBlock(node, dir.x, -1, dir.z)
    if ((block1.physical && block1.height >= block0.height) ||
      !this.getBlock(node, dir.x, 0, dir.z).safe ||
      !this.getBlock(node, dir.x, 1, dir.z).safe) return
    if (this.getBlock(node, 0, 0, 0).liquid) return // cant jump from water

    let cost = 1

    // Leaving entities at the ceiling level (along path) out for now because there are few cases where that will be important
    cost += this.getNumEntitiesAt(node, dir.x, 0, dir.z) * this.entityCost

    // If we have a block on the ceiling, we cannot jump but we can still fall
    let ceilingClear = this.getBlock(node, 0, 2, 0).safe && this.getBlock(node, dir.x, 2, dir.z).safe

    // Similarly for the down path
    let floorCleared = !this.getBlock(node, dir.x, -2, dir.z).physical

    // The executor can settle two- and three-block gap jumps from an ordinary
    // path node. A four-block edge needs a guaranteed run-up that this graph
    // does not bind or preserve, and live execution repeatedly stopped just
    // short of the landing. Do not advertise a move the native executor
    // cannot deterministically complete.
    const maxD = this.allowSprinting ? 3 : 2
    const runUpFeet = this.getBlock(node, -dir.x, 0, -dir.z)
    const runUpHead = this.getBlock(node, -dir.x, 1, -dir.z)
    const runUpCeiling = this.getBlock(node, -dir.x, 2, -dir.z)
    const runUpSupport = this.getBlock(node, -dir.x, -1, -dir.z)
    const runUp = runUpFeet.safe && runUpHead.safe && runUpCeiling.safe &&
      runUpSupport.physical && !runUpSupport.liquid &&
      Math.abs(runUpSupport.height - block0.height) <= 0.2 &&
      this.getNumEntitiesAt(runUpFeet.position, 0, 0, 0) === 0
      ? { x: runUpFeet.position.x, y: node.y, z: runUpFeet.position.z }
      : null

    for (let d = 2; d <= maxD; d++) {
      const dx = dir.x * d
      const dz = dir.z * d
      const blockA = this.getBlock(node, dx, 2, dz)
      const blockB = this.getBlock(node, dx, 1, dz)
      const blockC = this.getBlock(node, dx, 0, dz)
      const blockD = this.getBlock(node, dx, -1, dz)

      if (blockC.safe) cost += this.getNumEntitiesAt(blockC.position, 0, 0, 0) * this.entityCost

      if (ceilingClear && blockB.safe && blockC.safe && blockD.physical) {
        cost += this.exclusionStep(blockB)
        if (!Number.isFinite(cost)) break
        if (d === 3 && !runUp) break
        // Forward
        neighbors.push(this.makeMove(node, blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, cost, [], [], 'parkour', true, { distance: d, runUp }))
        break
      } else if (this.allowParkourAscend && ceilingClear && blockB.safe && blockC.physical) {
        // Up
        if (blockA.safe && d !== 4) { // 4 Blocks forward 1 block up is very difficult and fails often
          cost += this.exclusionStep(blockA)
          if (!Number.isFinite(cost)) break
          if (blockC.height - block0.height > 1.2) break // Too high to jump
          cost += this.getNumEntitiesAt(blockB.position, 0, 0, 0) * this.entityCost
          if (d === 3 && !runUp) break
          neighbors.push(this.makeMove(node, blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks, cost, [], [], 'parkour', true, { distance: d, runUp }))
          break
        }
      } else if ((ceilingClear || d === 2) && blockB.safe && blockC.safe && blockD.safe && floorCleared) {
        // Down
        const blockE = this.getBlock(node, dx, -2, dz)
        if (blockE.physical) {
          cost += this.exclusionStep(blockD)
          if (!Number.isFinite(cost)) break
          cost += this.getNumEntitiesAt(blockD.position, 0, 0, 0) * this.entityCost
          if (d === 3 && !runUp) break
          neighbors.push(this.makeMove(node, blockD.position.x, blockD.position.y, blockD.position.z, node.remainingBlocks, cost, [], [], 'parkour', true, { distance: d, runUp }))
        }
        floorCleared = floorCleared && !blockE.physical
      } else if (!blockB.safe || !blockC.safe) {
        break
      }

      ceilingClear = ceilingClear && blockA.safe
    }
  }

  // for each cardinal direction:
  // "." is head. "+" is feet and current location.
  // "#" is initial floor which is always solid. "a"-"u" are blocks to check
  //
  //   --0123-- horizontalOffset
  //  |
  // +2  aho
  // +1  .bip
  //  0  +cjq
  // -1  #dkr
  // -2   els
  // -3   fmt
  // -4   gn
  //  |
  //  dy

  getNeighbors (node) {
    const neighbors = []

    // Do not plan a level route along the bottom of an open water column.
    // When ascent is obstructed, retain the ordinary horizontal neighbors so
    // Pathfinder can swim beneath the obstruction to the next open column.
    const waterColumn = this.getMoveSwimUp(node, neighbors)
    if (waterColumn === 'submerged') return neighbors

    // Simple moves in 4 cardinal points
    for (const i in cardinalDirections) {
      const dir = cardinalDirections[i]
      this.getMoveForward(node, dir, neighbors)
      this.getMoveJumpUp(node, dir, neighbors)
      this.getMoveDropDown(node, dir, neighbors)
      if (this.allowParkour) {
        this.getMoveParkourForward(node, dir, neighbors)
      }
    }

    // Diagonals
    for (const i in diagonalDirections) {
      const dir = diagonalDirections[i]
      this.getMoveDiagonal(node, dir, neighbors)
    }

    this.getMoveDown(node, neighbors)
    this.getMoveUp(node, neighbors)

    // Climbing remains bounded to continuous physics-supported cells. A top
    // exit must be represented by an ordinary supported horizontal node.
    this.getMoveClimbUpThroughTrapdoor(node, neighbors)

    // Movement producers may accumulate an impossible contribution after an
    // earlier local check (for example an entity occupying a drop landing).
    // Enforce the graph contract once at its owning boundary: every advertised
    // edge has a finite cost, regardless of which movement composed it.
    return neighbors.filter(neighbor => (
      Number.isFinite(neighbor?.cost) &&
      (!node?.physicalStart || this.startTransitionIsExecutable(node, neighbor))
    ))
  }

  // Update lava avoidance based on bot's current state
  updateLavaAvoidance () {
    const registry = this.bot.registry
    const lavaId = registry.blocksByName.lava.id

    // Check if bot.entity exists and is initialized
    if (this.bot.entity && this.bot.entity.isInLava) {
      // If bot is in lava, allow pathfinding through lava to escape
      this.blocksToAvoid.delete(lavaId)
    } else {
      // If bot is not in lava, avoid lava blocks
      this.blocksToAvoid.add(lavaId)
    }
  }
}

module.exports = Movements
