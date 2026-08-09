function error (name, message) {
  const err = new Error(message)
  err.name = name
  return err
}

/**
   * Adds a easy-to-use API wrapper for quickly executing a goal and running
   * a callback when that goal is reached. This function serves to remove a
   * lot of boilerplate code for quickly executing a goal.
   *
   * @param {Bot} bot - The bot.
   * @param {Goal} goal - The goal to execute.
   * @returns {Promise} - resolves on success, rejects on error
   */
function goto (bot, goal, options = {}) {
  return new Promise((resolve, reject) => {
    function goalReached () {
      cleanup()
    }

    function noPathListener (results) {
      if (results.status === 'noPath') {
        cleanup(error('NoPath', 'No path to the goal!'))
      } else if (results.status === 'timeout') {
        cleanup(error('Timeout', 'Took to long to decide path to goal!'))
      } else if (results.status === 'partial') {
        // An empty partial result only means this A* compute slice has not
        // reached a useful node yet. The same search context continues on the
        // next physics tick; resolving here falsely reports arrival without
        // moving and abandons the in-progress route.
        return
      } else if (results.path.length === 0) {
        const position = bot.entity?.position?.floored?.()
        if (position && goal.isEnd(position)) cleanup()
        else cleanup(error('NoPath', 'Pathfinder returned an empty path before reaching the goal!'))
      }
    }

    function goalChangedListener (newGoal) {
      if (newGoal !== goal) {
        cleanup(error('GoalChanged', 'The goal was changed before it could be completed!'))
      }
    }

    function pathStopped () {
      cleanup(error('PathStopped', 'Path was stopped before it could be completed! Thus, the desired goal was not reached.'))
    }

    function cleanup (err) {
      bot.removeListener('goal_reached', goalReached)
      bot.removeListener('path_update', noPathListener)
      bot.removeListener('goal_updated', goalChangedListener)
      bot.removeListener('path_stop', pathStopped)

      // Run callback on next event stack to let pathfinder properly cleanup,
      // otherwise chaining waypoints does not work properly.
      setTimeout(() => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }, 0)
    }

    bot.on('path_stop', pathStopped)
    bot.on('goal_reached', goalReached)
    bot.on('path_update', noPathListener)
    bot.on('goal_updated', goalChangedListener)
    bot.pathfinder.setGoal(goal, false, options)
  })
}

module.exports = goto
