// Mindcraft-owned runtime fork of mineflayer-pathfinder 2.4.5 (MIT).
// Physical locomotion defects belong here instead of in companion strategy.
const { performance } = require('perf_hooks')

const AStar = require('./lib/astar')
const Move = require('./lib/move')
const Movements = require('./lib/movements')
const gotoUtil = require('./lib/goto')
const Lock = require('./lib/lock')

const Vec3 = require('vec3').Vec3

const Physics = require('./lib/physics')
const nbt = require('prismarine-nbt')
const interactableBlocks = require('./lib/interactable.json')
const NODE_EXECUTION_STALL_MS = 2500
const NODE_PROGRESS_EPSILON = 0.02
const OPENABLE_STATE_TIMEOUT_MS = 1200
const OPENABLE_CLEAR_TIMEOUT_MS = 3000
const OPENABLE_SAFE_CLEARANCE = 0.7

function inject (bot) {
  const waterType = bot.registry.blocksByName.water.id
  const lavaType = bot.registry.blocksByName.lava.id
  const ladderId = bot.registry.blocksByName.ladder.id
  const vineId = bot.registry.blocksByName.vine.id
  let stateMovements = new Movements(bot)
  let stateGoal = null
  let statePathOptions = {}
  let astarContext = null
  let astartTimedout = false
  let dynamicGoal = false
  let path = []
  let pathUpdated = false
  let digging = false
  let placing = false
  let placingBlock = null
  let lastNodeTime = performance.now()
  let nodeProgress = null
  let returningPos = null
  let stopPathing = false
  let lastStuckState = null
  let verticalTransition = null
  let pendingOpenable = null
  let activatingUseBlock = false
  let openableGeneration = 0
  const physics = new Physics(bot)
  const lockPlaceBlock = new Lock()
  const lockEquipItem = new Lock()
  const lockUseBlock = new Lock()

  bot.pathfinder = {}

  bot.pathfinder.thinkTimeout = 5000 // ms
  bot.pathfinder.tickTimeout = 40 // ms, amount of thinking per tick (max 50 ms)
  bot.pathfinder.searchRadius = -1 // in blocks, limits of the search area, -1: don't limit the search
  bot.pathfinder.enablePathShortcut = false // disabled by default as it can cause bugs in specific configurations
  bot.pathfinder.LOSWhenPlacingBlocks = true

  bot.pathfinder.bestHarvestTool = (block) => {
    const availableTools = bot.inventory.items()
    const effects = bot.entity.effects

    let fastest = Number.MAX_VALUE
    let bestTool = null
    for (const tool of availableTools) {
      const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
      const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
      if (digTime < fastest) {
        fastest = digTime
        bestTool = tool
      }
    }

    return bestTool
  }

  bot.pathfinder.getPathTo = (movements, goal, options = {}) => {
    // Update lava avoidance based on current bot state
    if (movements.updateLavaAvoidance) {
      movements.updateLavaAvoidance()
    }
    const pathOptions = Number.isFinite(options) ? { timeout: options } : options
    const generator = bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, pathOptions)
    const { value: { result, astarContext: context } } = generator.next()
    astarContext = context
    return result
  }

  bot.pathfinder.getPathFromTo = function * (movements, startPos, goal, options = {}) {
    const optimizePath = options.optimizePath ?? true
    const resetEntityIntersects = options.resetEntityIntersects ?? true
    const timeout = options.timeout ?? bot.pathfinder.thinkTimeout
    const tickTimeout = options.tickTimeout ?? bot.pathfinder.tickTimeout
    const searchRadius = options.searchRadius ?? bot.pathfinder.searchRadius
    let start
    if (options.startMove) {
      start = options.startMove
    } else {
      const p = startPos.floored()
      const dy = startPos.y - p.y
      const b = bot.blockAt(p) // The block we are standing in
      // Offset only for an actual collision surface such as a slab or carpet.
      // Water is replaceable but intentionally absent from emptyBlocks; using
      // that set here promoted a wading bot to the block above and mislabeled
      // a shore step-up as a flat walk.
      const hasStandingSurface = Boolean(
        b?.shapes?.length > 0 && !movements.liquids.has(b.type)
      )
      const offset = (dy > 0.001 && bot.entity.onGround && hasStandingSurface) ? 1 : 0
      start = new Move(p.x, p.y + offset, p.z, movements.countScaffoldingItems(), 0)
      // A legal Minecraft body can share a block coordinate with a partial
      // collision shape while standing beside it. A fence is the common case:
      // floor(position) names the fence cell even though the body is outside
      // its narrow collision arms. The abstract start node alone loses which
      // side the body occupies and may advertise an impossible first edge
      // straight through the shape. Preserve the exact body pose only on the
      // first graph node so Movements can reject that false transition without
      // changing ordinary block-to-block path expansion.
      start.physicalStart = {
        x: startPos.x,
        y: startPos.y,
        z: startPos.z,
        width: bot.entity?.width,
        height: bot.entity?.height
      }
    }
    if (movements.allowEntityDetection) {
      if (resetEntityIntersects) {
        movements.clearCollisionIndex()
      }
      movements.updateCollisionIndex()
    }
    const astarContext = new AStar(start, movements, goal, timeout, tickTimeout, searchRadius)
    let result = astarContext.compute()
    if (optimizePath) result.path = postProcessPath(result.path)
    yield { result, astarContext }
    while (result.status === 'partial') {
      result = astarContext.compute()
      if (optimizePath) result.path = postProcessPath(result.path)
      yield { result, astarContext }
    }
  }

  Object.defineProperties(bot.pathfinder, {
    goal: {
      get () {
        return stateGoal
      }
    },
    movements: {
      get () {
        return stateMovements
      }
    }
  })

  bot.pathfinder.getLastStuckState = () => {
    if (!lastStuckState) return null
    return {
      ...lastStuckState,
      position: { ...lastStuckState.position },
      nextPoint: { ...lastStuckState.nextPoint },
      delta: { ...lastStuckState.delta },
      controls: { ...lastStuckState.controls },
      blocks: { ...lastStuckState.blocks }
    }
  }

  function detectDiggingStopped () {
    digging = false
    bot.removeAllListeners('diggingAborted', detectDiggingStopped)
    bot.removeAllListeners('diggingCompleted', detectDiggingStopped)
  }

  function resetPath (reason, clearStates = true) {
    if (!stopPathing && path.length > 0) bot.emit('path_reset', reason)
    path = []
    if (digging) {
      bot.on('diggingAborted', detectDiggingStopped)
      bot.on('diggingCompleted', detectDiggingStopped)
      bot.stopDigging()
    }
    placing = false
    placingBlock = null
    verticalTransition = null
    nodeProgress = null
    pathUpdated = false
    astarContext = null
    lockEquipItem.release()
    lockPlaceBlock.release()
    if (!activatingUseBlock) lockUseBlock.release()
    stateMovements.clearCollisionIndex()
    if (clearStates) bot.clearControlStates()
    if (stopPathing) return stop()
  }

  bot.pathfinder.setGoal = (goal, dynamic = false, options = {}) => {
    if (goal) {
      lastStuckState = null
    }
    stateGoal = goal
    statePathOptions = goal ? { ...options } : {}
    dynamicGoal = dynamic
    bot.emit('goal_updated', goal, dynamic)
    resetPath('goal_updated')
  }

  bot.pathfinder.setMovements = (movements) => {
    stateMovements = movements
    resetPath('movements_updated')
  }

  bot.pathfinder.isMoving = () => path.length > 0 || activatingUseBlock || pendingOpenable !== null
  bot.pathfinder.isMining = () => digging
  bot.pathfinder.isBuilding = () => placing

  bot.pathfinder.goto = (goal, options = {}) => {
    return gotoUtil(bot, goal, options)
  }

  bot.pathfinder.stop = () => {
    stopPathing = true
  }

  bot.on('physicsTick', monitorMovement)

  function postProcessPath (path) {
    for (let i = 0; i < path.length; i++) {
      const curPoint = path[i]
      if (curPoint.toBreak.length > 0 || curPoint.toPlace.length > 0) break
      const b = bot.blockAt(new Vec3(curPoint.x, curPoint.y, curPoint.z))

      // A swim-up node names the body's target feet cell, including the clear
      // air cell immediately above the top water block. Generic unsupported-
      // air normalization would move that node down and erase the emergence
      // edge before the executor ever sees it.
      if (curPoint.locomotion?.type === 'swim_up') {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.z = Math.floor(curPoint.z) + 0.5
        continue
      }

      // openned doors have small Collision box
      // that may stop the bot from moving forward
      if(i === 0 && b?.name.includes('door')) {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = Math.floor(curPoint.y)
        curPoint.z = Math.floor(curPoint.z) + 0.5
        continue
      }

      if (b && (b.type === waterType || ((b.type === ladderId || b.type === vineId) && i + 1 < path.length && path[i + 1].y < curPoint.y))) {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = Math.floor(curPoint.y)
        curPoint.z = Math.floor(curPoint.z) + 0.5
        continue
      }
      let np = getPositionOnTopOf(b)
      if (np === null) np = getPositionOnTopOf(bot.blockAt(new Vec3(curPoint.x, curPoint.y - 1, curPoint.z)))
      if (np) {
        curPoint.x = np.x
        curPoint.y = np.y
        curPoint.z = np.z
      } else {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = curPoint.y - 1
        curPoint.z = Math.floor(curPoint.z) + 0.5
      }
    }

    if (!bot.pathfinder.enablePathShortcut || stateMovements.exclusionAreasStep.length !== 0 || path.length === 0) return path

    const newPath = []
    let lastNode = bot.entity.position
    for (let i = 1; i < path.length; i++) {
      const node = path[i]
      if (Math.abs(node.y - lastNode.y) > 0.5 || node.toBreak.length > 0 || node.toPlace.length > 0 || !physics.canStraightLineBetween(lastNode, node)) {
        newPath.push(path[i - 1])
        lastNode = path[i - 1]
      }
    }
    newPath.push(path[path.length - 1])
    return newPath
  }

  function pathFromPlayer (path) {
    if (path.length === 0) return
    let minI = 0
    let minDistance = 1000
    for (let i = 0; i < path.length; i++) {
      const node = path[i]
      if (node.toBreak.length !== 0 || node.toPlace.length !== 0) break
      const dist = bot.entity.position.distanceSquared(node)
      if (dist < minDistance) {
        minDistance = dist
        minI = i
      }
    }
    // check if we are between 2 nodes
    const n1 = path[minI]
    // check if node already reached
    const dx = n1.x - bot.entity.position.x
    const dy = n1.y - bot.entity.position.y
    const dz = n1.z - bot.entity.position.z
    const reached = Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1
    if (minI + 1 < path.length && n1.toBreak.length === 0 && n1.toPlace.length === 0) {
      const n2 = path[minI + 1]
      const d2 = bot.entity.position.distanceSquared(n2)
      const d12 = n1.distanceSquared(n2)
      minI += d12 > d2 || reached ? 1 : 0
    }

    path.splice(0, minI)
  }

  function isPositionNearPath (pos, path) {
    let prevNode = null
    for (const node of path) {
      let comparisonPoint = null
      if (
        prevNode === null ||
        (
          Math.abs(prevNode.x - node.x) <= 2 &&
          Math.abs(prevNode.y - node.y) <= 2 &&
          Math.abs(prevNode.z - node.z) <= 2
        )
      ) {
        // Unoptimized path, or close enough to last point
        // to just check against the current point
        comparisonPoint = node
      } else {
        // Optimized path - the points are far enough apart
        //   that we need to check the space between them too

        // First, a quick check - if point it outside the path
        // segment's AABB, then it isn't near.
        const minBound = prevNode.min(node)
        const maxBound = prevNode.max(node)
        if (
          pos.x - 0.5 < minBound.x - 1 ||
          pos.x - 0.5 > maxBound.x + 1 ||
          pos.y - 0.5 < minBound.y - 2 ||
          pos.y - 0.5 > maxBound.y + 2 ||
          pos.z - 0.5 < minBound.z - 1 ||
          pos.z - 0.5 > maxBound.z + 1
        ) {
          continue
        }

        comparisonPoint = closestPointOnLineSegment(pos, prevNode, node)
      }

      const dx = Math.abs(comparisonPoint.x - pos.x - 0.5)
      const dy = Math.abs(comparisonPoint.y - pos.y - 0.5)
      const dz = Math.abs(comparisonPoint.z - pos.z - 0.5)
      if (dx <= 1 && dy <= 2 && dz <= 1) return true

      prevNode = node
    }

    return false
  }

  function closestPointOnLineSegment (point, segmentStart, segmentEnd) {
    const segmentLength = segmentEnd.minus(segmentStart).norm()

    if (segmentLength === 0) {
      return segmentStart
    }

    // t is like an interpolation from segmentStart to segmentEnd
    //  for the closest point on the line
    let t = (point.minus(segmentStart)).dot(segmentEnd.minus(segmentStart)) / segmentLength

    // bound t to be on the segment
    t = Math.max(0, Math.min(1, t))

    return segmentStart.plus(segmentEnd.minus(segmentStart).scaled(t))
  }

  // Return the average x/z position of the highest standing positions
  // in the block.
  function getPositionOnTopOf (block) {
    if (!block || block.shapes.length === 0) return null
    const p = new Vec3(0.5, 0, 0.5)
    let n = 1
    for (const shape of block.shapes) {
      const h = shape[4]
      if (h === p.y) {
        p.x += (shape[0] + shape[3]) / 2
        p.z += (shape[2] + shape[5]) / 2
        n++
      } else if (h > p.y) {
        n = 2
        p.x = 0.5 + (shape[0] + shape[3]) / 2
        p.y = h
        p.z = 0.5 + (shape[2] + shape[5]) / 2
      }
    }
    p.x /= n
    p.z /= n
    return block.position.plus(p)
  }

  // A composter or cauldron has a low interior floor surrounded by a tall
  // rim. A* correctly binds the safe adjacent landing cell as a drop from the
  // graph node above that rim, but an ordinary drop deliberately withholds
  // jump. Detect the physical enclosure from collision shapes so the native
  // executor can perform the jump a player needs to leave it.
  function mustJumpOutOfEnclosingBlock (position, nextPoint) {
    const block = bot.blockAt(position.floored())
    if (!block || !Array.isArray(block.shapes) || block.shapes.length < 2) return false

    const localX = position.x - block.position.x
    const localY = position.y - block.position.y
    const localZ = position.z - block.position.z
    const epsilon = 0.02
    const standingOnInteriorFloor = block.shapes.some(shape => (
      localX >= shape[0] - epsilon && localX <= shape[3] + epsilon &&
      localZ >= shape[2] - epsilon && localZ <= shape[5] + epsilon &&
      Math.abs(localY - shape[4]) <= 0.08
    ))
    if (!standingOnInteriorFloor) return false

    const dx = nextPoint.x - position.x
    const dz = nextPoint.z - position.z
    if (Math.max(Math.abs(dx), Math.abs(dz)) > 1.75) return false
    const exitsWest = dx < -epsilon && Math.abs(dx) >= Math.abs(dz)
    const exitsEast = dx > epsilon && Math.abs(dx) >= Math.abs(dz)
    const exitsNorth = dz < -epsilon && Math.abs(dz) > Math.abs(dx)
    const exitsSouth = dz > epsilon && Math.abs(dz) > Math.abs(dx)
    if (!exitsWest && !exitsEast && !exitsNorth && !exitsSouth) return false

    return block.shapes.some(shape => {
      if (shape[4] <= localY + 0.5) return false
      if (exitsWest) return shape[0] <= epsilon && shape[3] > epsilon
      if (exitsEast) return shape[3] >= 1 - epsilon && shape[0] < 1 - epsilon
      if (exitsNorth) return shape[2] <= epsilon && shape[5] > epsilon
      return shape[5] >= 1 - epsilon && shape[2] < 1 - epsilon
    })
  }

  /**
   * Stop the bot's movement and recenter to the center off the block when the bot's hitbox is partially beyond the
   * current blocks dimensions.
   */
  function fullStop () {
    bot.clearControlStates()

    // Force horizontal velocity to 0 (otherwise inertia can move us too far)
    // Kind of cheaty, but the server will not tell the difference
    bot.entity.velocity.x = 0
    bot.entity.velocity.z = 0

    const blockX = Math.floor(bot.entity.position.x) + 0.5
    const blockZ = Math.floor(bot.entity.position.z) + 0.5

    // Make sure our bounding box don't collide with neighboring blocks
    // otherwise recenter the position
    if (Math.abs(bot.entity.position.x - blockX) > 0.2) { bot.entity.position.x = blockX }
    if (Math.abs(bot.entity.position.z - blockZ) > 0.2) { bot.entity.position.z = blockZ }
  }

  function openableProgress (pending, position) {
    const dx = pending.destination.x - pending.source.x
    const dz = pending.destination.z - pending.source.z
    return ((position.x - (pending.destination.x + 0.5)) * dx) +
      ((position.z - (pending.destination.z + 0.5)) * dz)
  }

  function failOpenablePath (reason, error) {
    if (error) console.error(error)
    pendingOpenable = null
    placing = false
    placingBlock = null
    path = []
    stateGoal = null
    stopPathing = false
    fullStop()
    bot.emit('path_stop', reason)
  }

  function servicePendingOpenable () {
    const pending = pendingOpenable
    if (!pending) return false

    if (pending.phase === 'failed') {
      const { error } = pending
      pendingOpenable = null
      if (stopPathing) return false
      failOpenablePath('openable_interaction_failed', error)
      return true
    }

    const block = bot.blockAt(pending.position, false)
    if (!block || block.type !== pending.type || block.name !== pending.name) {
      pendingOpenable = null
      return false
    }

    const now = performance.now()
    const isOpen = block._properties?.open === true
    if (pending.phase === 'opening') {
      if (!isOpen) {
        if (now >= pending.stateDeadlineAt) {
          pending.phase = 'failed'
          pending.error = new Error(`Openable ${pending.name} did not report open after activation`)
        }
        fullStop()
        return true
      }
      pending.phase = 'open'
    }

    if (pending.phase === 'closing' || pending.phase === 'confirming') {
      if (!isOpen) {
        const failure = pending.failAfterClose || null
        pendingOpenable = null
        lastNodeTime = now
        if (failure) {
          failOpenablePath('openable_clearance_failed', failure)
          return true
        }
        return false
      }
      if (pending.phase === 'confirming' && now >= pending.stateDeadlineAt) {
        pending.phase = 'failed'
        pending.error = new Error(`Openable ${pending.name} did not report closed after activation`)
      }
      fullStop()
      return true
    }

    if (!isOpen) {
      pendingOpenable = null
      return false
    }

    const progress = openableProgress(pending, bot.entity.position)
    const crossedSafely = progress >= OPENABLE_SAFE_CLEARANCE
    const cancelledSafely = stopPathing && Math.abs(progress) >= OPENABLE_SAFE_CLEARANCE
    let shouldClose = crossedSafely || cancelledSafely
    if (!shouldClose) {
      if (stopPathing) {
        // Stop has priority over leaving the doorway. If the body is still in
        // the collision plane, abandoning this cleanup is safer than moving it
        // after ownership was cancelled or closing the block around it.
        pendingOpenable = null
        return false
      }
      if (now >= pending.clearDeadlineAt) {
        const error = new Error(`Could not clear ${pending.name} far enough to close it safely`)
        if (Math.abs(progress) >= OPENABLE_SAFE_CLEARANCE) {
          pending.failAfterClose = error
          shouldClose = true
        } else {
          pending.phase = 'failed'
          pending.error = error
          fullStop()
          return true
        }
      }
      if (!shouldClose) return false
    }

    if (!lockUseBlock.tryAcquire()) {
      fullStop()
      return true
    }

    pending.phase = 'closing'
    activatingUseBlock = true
    fullStop()
    const generation = pending.generation
    bot.activateBlock(block).then(() => {
      if (pendingOpenable?.generation === generation) {
        pendingOpenable.phase = 'confirming'
        pendingOpenable.stateDeadlineAt = performance.now() + OPENABLE_STATE_TIMEOUT_MS
      }
    }, error => {
      if (pendingOpenable?.generation === generation) {
        pendingOpenable.phase = 'failed'
        pendingOpenable.error = error
      }
    }).then(() => {
      activatingUseBlock = false
      lockUseBlock.release()
    })
    return true
  }

  function moveToEdge (refBlock, edge) {
    // If allowed turn instantly should maybe be a bot option
    const allowInstantTurn = false
    function getViewVector (pitch, yaw) {
      const csPitch = Math.cos(pitch)
      const snPitch = Math.sin(pitch)
      const csYaw = Math.cos(yaw)
      const snYaw = Math.sin(yaw)
      return new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)
    }
    // Target viewing direction while approaching edge
    // The Bot approaches the edge while looking in the opposite direction from where it needs to go
    // The target Pitch angle is roughly the angle the bot has to look down for when it is in the position
    // to place the next block
    const targetBlockPos = refBlock.offset(edge.x + 0.5, edge.y, edge.z + 0.5)
    const targetPosDelta = bot.entity.position.clone().subtract(targetBlockPos)
    const targetYaw = Math.atan2(-targetPosDelta.x, -targetPosDelta.z)
    const targetPitch = -1.421
    const viewVector = getViewVector(targetPitch, targetYaw)
    // While the bot is not in the right position rotate the view and press back while crouching
    if (bot.entity.position.distanceTo(refBlock.clone().offset(edge.x + 0.5, 1, edge.z + 0.5)) > 0.4) {
      bot.lookAt(bot.entity.position.offset(viewVector.x, viewVector.y, viewVector.z), allowInstantTurn)
      bot.setControlState('sneak', true)
      bot.setControlState('back', true)
      return false
    }
    bot.setControlState('back', false)
    return true
  }

  function moveToBlock (pos) {
    // minDistanceSq = Min distance sqrt to the target pos were the bot is centered enough to place blocks around him
    const minDistanceSq = 0.2 * 0.2
    const targetPos = pos.clone().offset(0.5, 0, 0.5)
    if (bot.entity.position.distanceSquared(targetPos) > minDistanceSq) {
      bot.lookAt(targetPos)
      bot.setControlState('forward', true)
      return false
    }
    bot.setControlState('forward', false)
    return true
  }

  function pathSegmentDrifted (nextPoint, position) {
    const locomotion = nextPoint.locomotion
    if (!locomotion?.source || !['walk', 'step_up', 'drop_down'].includes(locomotion.type)) return false

    const sourceX = locomotion.source.x + 0.5
    const sourceZ = locomotion.source.z + 0.5
    const segmentX = nextPoint.x - sourceX
    const segmentZ = nextPoint.z - sourceZ
    const segmentLengthSq = (segmentX * segmentX) + (segmentZ * segmentZ)
    const projection = segmentLengthSq > 0
      ? Math.max(0, Math.min(1, (
          ((position.x - sourceX) * segmentX)
          + ((position.z - sourceZ) * segmentZ)
        ) / segmentLengthSq))
      : 0
    const nearestX = sourceX + (segmentX * projection)
    const nearestZ = sourceZ + (segmentZ * projection)

    // A body inside the source cell is at most sqrt(0.5^2 + 0.5^2)
    // from the segment. A larger gap means the server corrected or displaced
    // the body after this path cursor advanced. Replanning is the native
    // response; continuing to drive a stale node can leave the target several
    // blocks ahead while the bot remains still.
    return Math.hypot(position.x - nearestX, position.z - nearestZ) > 0.85
  }

  function observeNodeConvergence (nextPoint, position, now = performance.now()) {
    const source = nextPoint.locomotion?.source
    const key = `${nextPoint.locomotion?.type || 'legacy'}:${source?.x ?? ''},${source?.y ?? ''},${source?.z ?? ''}->${nextPoint.x},${nextPoint.y},${nextPoint.z}`
    const metric = Math.hypot(
      nextPoint.x - position.x,
      nextPoint.y - position.y,
      nextPoint.z - position.z
    )
    if (!nodeProgress || nodeProgress.key !== key) {
      nodeProgress = { key, bestMetric: metric }
      lastNodeTime = now
      return
    }
    // Long drops and swim-up transitions may legitimately take longer than
    // the fail-fast horizon. Renew it only for monotonic physical convergence,
    // never merely because movement controls remain asserted.
    if (metric <= nodeProgress.bestMetric - NODE_PROGRESS_EPSILON) {
      nodeProgress.bestMetric = metric
      lastNodeTime = now
    }
  }

  function hasSettledStandingSupport (position) {
    const velocityY = Number(bot.entity.velocity?.y) || 0
    if (Math.abs(velocityY) > 0.12) return false

    const sample = new Vec3(position.x, position.y - 0.05, position.z).floored()
    const support = bot.blockAt(sample)
    const standingPosition = getPositionOnTopOf(support)
    return Boolean(
      standingPosition
      && Math.abs(position.y - standingPosition.y) <= 0.125
    )
  }

  function prepareVerticalTransition (nextPoint, position) {
    const locomotion = nextPoint.locomotion
    if (!locomotion?.source || !['step_up', 'drop_down'].includes(locomotion.type)) {
      verticalTransition = null
      return false
    }

    // A liquid-origin step still needs an exact launch cell. Reaching a water
    // node within the ordinary arrival tolerance can leave the body pressed
    // against the bank face, where the server cancels every upward impulse.
    // It cannot use the dry onGround precondition, so it gets a bounded native
    // swim-to-center phase before the ordinary step execution begins.
    const sourceBlock = bot.blockAt(new Vec3(
      locomotion.source.x,
      locomotion.source.y,
      locomotion.source.z
    ))
    const sourceIsLiquid = sourceBlock && (
      sourceBlock.type === waterType || sourceBlock.type === lavaType
    )
    const liquidStep = locomotion.type === 'step_up' && (
      sourceIsLiquid || bot.entity.isInWater || bot.entity.isInLava
    )

    const key = `${locomotion.type}:${locomotion.source.x},${locomotion.source.y},${locomotion.source.z}->${nextPoint.x},${nextPoint.y},${nextPoint.z}`
    if (!verticalTransition || verticalTransition.key !== key) {
      verticalTransition = {
        key,
        type: locomotion.type,
        phase: 'recenter',
        startedAt: performance.now(),
        source: locomotion.source
      }
    }
    if (verticalTransition.phase === 'execute') return false

    if (liquidStep) {
      const centerX = locomotion.source.x + 0.5
      const centerZ = locomotion.source.z + 0.5
      const centerDx = centerX - position.x
      const centerDz = centerZ - position.z
      if (Math.hypot(centerDx, centerDz) <= 0.12) {
        const targetDx = nextPoint.x - position.x
        const targetDz = nextPoint.z - position.z
        bot.look(Math.atan2(-targetDx, -targetDz), 0, true)
        // Preserve the upward impulse while handing the centered body to the
        // bank step. A cleared-control tick here lets gravity pull the player
        // back below the block lip before forward motion can begin.
        bot.setControlState('forward', true)
        bot.setControlState('jump', true)
        bot.setControlState('sprint', false)
        verticalTransition.phase = 'execute'
        lastNodeTime = performance.now()
        return true
      }
      if (performance.now() - verticalTransition.startedAt > 1200) {
        resetPath('stuck')
        return true
      }
      bot.look(Math.atan2(-centerDx, -centerDz), 0, true)
      bot.setControlState('forward', true)
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
      return true
    }

    // Paper can confirm the player is grounded while Mineflayer's local flag
    // remains false between collision ticks. A step-up cannot start in that
    // state because prismarine-physics will ignore jump input. Reconcile only
    // when actual collision geometry proves the body is settled on support.
    if (
      locomotion.type === 'step_up'
      && !bot.entity.onGround
      && hasSettledStandingSupport(position)
    ) {
      bot.entity.onGround = true
    }
    const verticalProgress = locomotion.type === 'step_up'
      ? position.y > locomotion.source.y + 0.25
      : position.y < locomotion.source.y - 0.25
    if (verticalProgress) {
      verticalTransition.phase = 'execute'
      return false
    }
    if (!bot.entity.onGround) {
      // Fractional vertical movement is already part of the planned
      // transition. Paper can report the bot airborne before it clears the
      // fixed vertical-progress threshold (for example at y + 0.15 while
      // entering an ordinary one-block step). Clearing controls here leaves
      // the bot suspended against the step and also bypasses the executor's
      // stall check. Let the native locomotion controls finish the move.
      verticalTransition.phase = 'execute'
      return false
    }

    const centerX = locomotion.source.x + 0.5
    const centerZ = locomotion.source.z + 0.5
    const dx = centerX - position.x
    const dz = centerZ - position.z
    if (Math.hypot(dx, dz) <= 0.12) {
      bot.clearControlStates()
      const targetDx = nextPoint.x - position.x
      const targetDz = nextPoint.z - position.z
      bot.look(Math.atan2(-targetDx, -targetDz), 0, true)
      verticalTransition.phase = 'execute'
      lastNodeTime = performance.now()
      return true
    }
    if (performance.now() - verticalTransition.startedAt > 1200) {
      resetPath('stuck')
      return true
    }

    bot.look(Math.atan2(-dx, -dz), 0, true)
    bot.setControlState('forward', true)
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    return true
  }

  function stop () {
    if (activatingUseBlock || pendingOpenable) {
      stopPathing = true
      fullStop()
      return
    }
    stopPathing = false
    stateGoal = null
    path = []
    bot.emit('path_stop')
    fullStop()
  }

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (!oldBlock || !newBlock) return
    if (isPositionNearPath(oldBlock.position, path) && oldBlock.type !== newBlock.type) {
      resetPath('block_updated', false)
    }
  })

  bot.on('chunkColumnLoad', (chunk) => {
    // Reset only if the new chunk is adjacent to a visited chunk
    if (astarContext) {
      const cx = chunk.x >> 4
      const cz = chunk.z >> 4
      if (astarContext.visitedChunks.has(`${cx - 1},${cz}`) ||
          astarContext.visitedChunks.has(`${cx},${cz - 1}`) ||
          astarContext.visitedChunks.has(`${cx + 1},${cz}`) ||
          astarContext.visitedChunks.has(`${cx},${cz + 1}`)) {
        resetPath('chunk_loaded', false)
      }
    }
  })

  function monitorMovement () {
    if (activatingUseBlock) {
      fullStop()
      return
    }
    if (servicePendingOpenable()) return
    if (stopPathing) {
      stop()
      return
    }

    // Test freemotion
    if (stateMovements && stateMovements.allowFreeMotion && stateGoal && stateGoal.entity) {
      const target = stateGoal.entity
      if (physics.canStraightLine([target.position])) {
        bot.lookAt(target.position.offset(0, 1.6, 0))

        if (target.position.distanceSquared(bot.entity.position) > stateGoal.rangeSq) {
          bot.setControlState('forward', true)
        } else {
          bot.clearControlStates()
        }
        return
      }
    }
    let pathResetForChangedGoal = false
    if (stateGoal) {
      if (!stateGoal.isValid()) {
        stop()
      } else if (stateGoal.hasChanged()) {
        resetPath('goal_moved', false)
        pathResetForChangedGoal = true
      }

      // A dynamic target can enter the accepted radius while an older path is
      // still queued. Continuing that stale path makes followers cross their
      // target, replan behind themselves, and oscillate. Settle immediately but
      // retain the dynamic goal so movement resumes when the target leaves.
      if (stateGoal && dynamicGoal && !pendingOpenable && stateGoal.isEnd(bot.entity.position.floored())) {
        const controlsActive = Object.values(bot.controlState || {}).some(Boolean)
        if (!pathResetForChangedGoal && (path.length > 0 || digging || placing || verticalTransition || controlsActive)) {
          resetPath('dynamic_goal_reached')
        } else {
          bot.clearControlStates()
        }
        if (stateGoal.entity?.position) {
          const height = Math.max(0.75, (Number(stateGoal.entity.height) || 1.8) * 0.85)
          bot.lookAt(stateGoal.entity.position.offset(0, height, 0), true)
        }
        return
      }
    }

    if (astarContext && astartTimedout) {
      const results = astarContext.compute()
      results.path = postProcessPath(results.path)
      pathFromPlayer(results.path)
      bot.emit('path_update', results)
      path = results.path
      astartTimedout = results.status === 'partial'
    }

    if (bot.pathfinder.LOSWhenPlacingBlocks && returningPos) {
      if (!moveToBlock(returningPos)) return
      returningPos = null
    }

    if (path.length === 0) {
      lastNodeTime = performance.now()
      if (stateGoal && stateMovements) {
        if (stateGoal.isEnd(bot.entity.position.floored())) {
          if (pendingOpenable) return
          if (!dynamicGoal) {
            bot.emit('goal_reached', stateGoal)
            stateGoal = null
            statePathOptions = {}
            fullStop()
          }
        } else if (!pathUpdated) {
          const results = bot.pathfinder.getPathTo(stateMovements, stateGoal, statePathOptions)
          bot.emit('path_update', results)
          path = results.path
          astartTimedout = results.status === 'partial'
          pathUpdated = true
        }
      }
    }

    if (path.length === 0) {
      return
    }

    let nextPoint = path[0]
    const p = bot.entity.position

    // Handle digging
    if (digging || nextPoint.toBreak.length > 0) {
      if (!digging && bot.entity.onGround) {
        digging = true
        const b = nextPoint.toBreak.shift()
        const block = bot.blockAt(new Vec3(b.x, b.y, b.z), false)
        const tool = bot.pathfinder.bestHarvestTool(block)
        fullStop()

        const digBlock = () => {
          bot.dig(block, true)
            .catch(_ignoreError => {
              resetPath('dig_error')
            })
            .then(function () {
              lastNodeTime = performance.now()
              digging = false
            })
        }

        if (!tool) {
          digBlock()
        } else {
          bot.equip(tool, 'hand')
            .catch(_ignoreError => {})
            .then(() => digBlock())
        }
      }
      return
    }
    // Handle block placement
    // TODO: sneak when placing or make sure the block is not interactive
    if (placing || nextPoint.toPlace.length > 0) {
      if (!placing) {
        placing = true
        placingBlock = nextPoint.toPlace.shift()
        fullStop()
      }

      // Open gates or doors
      if (placingBlock?.useOne) {
        if (!lockUseBlock.tryAcquire()) return
        const action = placingBlock
        const activeNode = nextPoint
        const usedBlock = bot.blockAt(new Vec3(action.x, action.y, action.z))
        let trackedGeneration = null
        if (action.closeAfterCrossing && usedBlock && usedBlock._properties?.open !== true) {
          trackedGeneration = ++openableGeneration
          const now = performance.now()
          pendingOpenable = {
            generation: trackedGeneration,
            phase: 'opening',
            position: usedBlock.position.clone(),
            type: usedBlock.type,
            name: usedBlock.name,
            source: action.closeAfterCrossing.source,
            destination: action.closeAfterCrossing.destination,
            stateDeadlineAt: now + OPENABLE_STATE_TIMEOUT_MS,
            clearDeadlineAt: now + OPENABLE_CLEAR_TIMEOUT_MS,
            error: null
          }
        }
        activatingUseBlock = true
        bot.activateBlock(usedBlock).then(() => {
          lockUseBlock.release()
          activatingUseBlock = false
          lastNodeTime = performance.now()
          if (stopPathing || path[0] !== activeNode || placingBlock !== action) {
            placingBlock = null
            placing = false
            return
          }
          placingBlock = activeNode.toPlace.shift()
          if (!placingBlock) {
            placing = false
            if (trackedGeneration && path[0] === activeNode) {
              path = postProcessPath(path)
            }
          }
        }, err => {
          lockUseBlock.release()
          activatingUseBlock = false
          placingBlock = null
          placing = false
          if (trackedGeneration && pendingOpenable?.generation === trackedGeneration) {
            pendingOpenable.phase = 'failed'
            pendingOpenable.error = err
          } else {
            console.error(err)
            resetPath('use_block_error')
          }
        })
        return
      }
      const block = stateMovements.getScaffoldingItem()
      if (!block) {
        resetPath('no_scaffolding_blocks')
        return
      }
      if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.y === bot.entity.position.floored().y - 1 && placingBlock.dy === 0) {
        if (!moveToEdge(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z), new Vec3(placingBlock.dx, 0, placingBlock.dz))) return
      }
      let canPlace = true
      if (placingBlock.jump) {
        bot.setControlState('jump', true)
        canPlace = placingBlock.y + 1 < bot.entity.position.y
      }
      if (canPlace) {
        if (!lockEquipItem.tryAcquire()) return
        bot.equip(block, 'hand')
          .then(function () {
            lockEquipItem.release()
            const refBlock = bot.blockAt(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z), false)
            if (!lockPlaceBlock.tryAcquire()) return
            bot.world.setBlockStateId(refBlock.position.offset(placingBlock.dx, placingBlock.dy, placingBlock.dz), 1)
            if (interactableBlocks.includes(refBlock.name)) {
              bot.setControlState('sneak', true)
            }
            bot.placeBlock(refBlock, new Vec3(placingBlock.dx, placingBlock.dy, placingBlock.dz))
              .then(function () {
                // Dont release Sneak if the block placement was not successful
                bot.setControlState('sneak', false)
                bot.setControlState('jump', false)
                if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.returnPos) returningPos = placingBlock.returnPos.clone()
              })
              .catch(_ignoreError => {
                resetPath('place_error')
              })
              .then(() => {
                lockPlaceBlock.release()
                placing = false
                lastNodeTime = performance.now()
              })
          })
          .catch(_ignoreError => {})
      }
      return
    }

    let dx = nextPoint.x - p.x
    let dy = nextPoint.y - p.y
    let dz = nextPoint.z - p.z
    let locomotionType = nextPoint.locomotion?.type || 'legacy'
    const swimDestination = locomotionType === 'swim_up'
      ? bot.blockAt(new Vec3(nextPoint.x, nextPoint.y, nextPoint.z))
      : null
    const swimHead = locomotionType === 'swim_up'
      ? bot.blockAt(p.offset(0, 1, 0))
      : null
    const surfacedIntoAir = Boolean(
      swimDestination
      && swimDestination.type !== waterType
      && swimHead
      && swimHead.type !== waterType
      && p.y >= nextPoint.y - 1
    )
    const reachedNextPoint = locomotionType === 'swim_up'
      ? Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && (
          surfacedIntoAir
          || (swimDestination?.type === waterType && p.y >= nextPoint.y - 0.05)
        ) && p.y < nextPoint.y + 1
      : Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1
    if (reachedNextPoint) {
      // arrived at next point
      verticalTransition = null
      nodeProgress = null
      lastNodeTime = performance.now()
      if (stopPathing) {
        stop()
        return
      }
      path.shift()
      if (path.length === 0) { // done
        if (pendingOpenable) {
          fullStop()
          return
        }
        // If the block the bot is standing on is not a full block only checking for the floored position can fail as
        // the distance to the goal can get greater then 0 when the vector is floored.
        if (!dynamicGoal && stateGoal && (stateGoal.isEnd(p.floored()) || stateGoal.isEnd(p.floored().offset(0, 1, 0)))) {
            bot.emit('goal_reached', stateGoal)
            stateGoal = null
            statePathOptions = {}
        }
        fullStop()
        return
      }
      // not done yet
      nextPoint = path[0]
      if (nextPoint.toBreak.length > 0 || nextPoint.toPlace.length > 0) {
        fullStop()
        return
      }
      dx = nextPoint.x - p.x
      dy = nextPoint.y - p.y
      dz = nextPoint.z - p.z
      locomotionType = nextPoint.locomotion?.type || 'legacy'
    }

    if (pathSegmentDrifted(nextPoint, p)) {
      resetPath('position_corrected')
      return
    }

    observeNodeConvergence(nextPoint, p)
    if (prepareVerticalTransition(nextPoint, p)) return

    bot.look(
      Math.atan2(-dx, -dz),
      0,
      locomotionType !== 'legacy'
    )
    bot.setControlState('forward', true)
    bot.setControlState('jump', false)

    let executionMode
    const feetBlock = bot.blockAt(p.floored())
    // Mineflayer can clear isInWater for a tick at the surface while the
    // physical feet cell is still water. Keep native ascent controls until
    // the body actually crosses into the dry route node.
    const physicallyInWater = bot.entity.isInWater || feetBlock?.type === waterType
    if (physicallyInWater) {
      const ascendingWaterRoute = dy > 0.05 || [
        'step_up',
        'vertical_up',
        'climb_up',
        'swim_up'
      ].includes(locomotionType)
      executionMode = ascendingWaterRoute ? 'water_ascent' : 'water_traverse'
      // Converge tightly on the Y selected by A*. A 0.35-block tolerance let
      // buoyancy settle the body just beneath a surface node: horizontal
      // progress continued while the head stayed underwater. Lift only while
      // below the native node, avoiding both that submerged near-miss and the
      // old unconditional jump that overshot level water routes.
      bot.setControlState('jump', ascendingWaterRoute)
      bot.setControlState('sprint', false)
    } else if (bot.entity.isInLava) {
      executionMode = 'lava_ascent'
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else if (locomotionType === 'step_up') {
      executionMode = 'step_up'
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else if (locomotionType === 'drop_down') {
      const jumpOut = mustJumpOutOfEnclosingBlock(p, nextPoint)
      executionMode = jumpOut ? 'jump_out' : 'drop_down'
      bot.setControlState('jump', jumpOut)
      bot.setControlState('sprint', false)
    } else if (locomotionType === 'fall_down') {
      executionMode = 'fall_down'
      bot.setControlState('forward', false)
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
    } else if (locomotionType === 'vertical_up') {
      executionMode = 'vertical_up'
      bot.setControlState('forward', false)
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else if (locomotionType === 'parkour') {
      executionMode = 'parkour'
      bot.setControlState('jump', true)
      bot.setControlState('sprint', stateMovements.allowSprinting)
    } else if (locomotionType === 'walk' && stateMovements.allowSprinting && physics.canStraightLine(path, true)) {
      executionMode = 'sprint_straight'
      bot.setControlState('jump', false)
      bot.setControlState('sprint', true)
    } else if (locomotionType === 'walk') {
      executionMode = 'walk'
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
    } else if (locomotionType === 'climb_up') {
      executionMode = 'climb_up'
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else if (stateMovements.allowSprinting && physics.canSprintJump(path)) {
      executionMode = 'sprint_jump'
      bot.setControlState('jump', true)
      bot.setControlState('sprint', true)
    } else if (physics.canStraightLine(path)) {
      executionMode = 'walk_straight'
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
    } else if (physics.canWalkJump(path)) {
      executionMode = 'walk_jump'
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else {
      executionMode = 'physics_declined'
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
    }

    // check for futility
    if (performance.now() - lastNodeTime > NODE_EXECUTION_STALL_MS) {
      // should never take this long to go to the next node
      const feet = bot.blockAt(p.floored())
      const support = bot.blockAt(p.floored().offset(0, -1, 0))
      const head = bot.blockAt(p.floored().offset(0, 1, 0))
      lastStuckState = {
        recordedAt: Date.now(),
        executionMode,
        locomotion: nextPoint.locomotion || null,
        pathLength: path.length,
        position: { x: p.x, y: p.y, z: p.z },
        nextPoint: { x: nextPoint.x, y: nextPoint.y, z: nextPoint.z },
        delta: { x: dx, y: dy, z: dz },
        controls: {
          forward: bot.controlState.forward,
          jump: bot.controlState.jump,
          sprint: bot.controlState.sprint
        },
        onGround: bot.entity.onGround,
        isInWater: bot.entity.isInWater,
        blocks: {
          feet: feet?.name || null,
          head: head?.name || null,
          support: support?.name || null
        }
      }
      resetPath('stuck')
    }
  }
}

module.exports = {
  pathfinder: inject,
  Movements: require('./lib/movements'),
  goals: require('./lib/goals')
}
