'use strict'

import invariant from 'invariant'

import * as ext from './extensions'
import * as u from './util'
import { updateUnitMeta, unitMeta } from './unit'

export default function System(def) {
  if (unitMeta(def).subsystem != null) return def()

  return Subsystem(def)()
}

export function Subsystem(def) {
  u.conformSubsystemDef(def)

  const subsystem = function(deps = {}) {
    return flow(
      typeof def === 'function' ? def(deps) : def,
      objEntries,
      map(unitDef),
      toposort,
      instantiate,
      toSystemObject
    )
  }

  updateUnitMeta(meta => (meta.subsystem = true), subsystem)

  return subsystem
}

export function using(deps, def) {
  invariant(
    Array.isArray(deps) || typeof deps === 'object',
    'You must provide a dependency map (object or array)'
  )

  invariant(
    typeof def === 'function',
    'The unit aregument (def) must be a function'
  )

  return {
    type: 'unit',
    def,
    deps: Array.isArray(deps)
      ? flow(deps, map(d => [d, d]), entriesToObj)
      : deps,
  }
}

export function contributions(slot) {
  const id = ext.idOf(slot)

  invariant(
    id != null,
    'You must provide an extension slot for which the contributions ought to be collected'
  )

  return {
    type: 'contrib',
    slot,
  }
}
// an alias
export const after = using

// todo: use Object.entries; contributions() flexible wrt. unit / unit instance

const unitDef = ([name, def]) =>
  typeof def === 'function'
    ? { type: 'unit', def, name, deps: {} }
    : def && def.type === 'unit'
      ? { ...def, name }
      : { type: 'unit', def: () => def, name, deps: {} }

const instantiate = defs => {
  let instantiated = {}

  const collectContibs = depDef =>
    flow(
      defs,
      map(u.partial(u.prop, 'def')),
      map(u.partial(ext.collect, depDef.slot)),
      u.partial(u.reject, u.isNil)
    )

  const collectDeps = def => {
    let deps = { ...def.deps }

    for (const name in deps) {
      const depDef = deps[name]

      let depValue
      if (depDef.type && depDef.type === 'contrib') {
        depValue = collectContibs(depDef)
      } else if (typeof depDef === 'string') {
        depValue = instantiated[deps[name]]
      } else if (Array.isArray(depDef)) {
        depValue = u.path(depDef, instantiated)
      } else {
        depValue = depDef
      }

      deps[name] = depValue
    }

    return deps
  }

  return defs.map(def => {
    const instance = def.def(collectDeps(def))
    instantiated[def.name] = instance

    return {
      ...def,
      instance,
    }
  })
}

// Utilities

const objEntries = obj => {
  if (Array.isArray(obj)) return obj

  const ownProps = Object.keys(obj)
  let i = ownProps.length
  const resArray = new Array(i)
  while (i--) resArray[i] = [ownProps[i], obj[ownProps[i]]]

  return resArray
}

const toSystemObject = defs => {
  let system = {}

  defs.forEach(({ name, instance }) => {
    Object.defineProperty(system, name, {
      value: instance,
      enumerable: true,
      writeble: false,
    })
  })

  return system
}

const toObj = entries => {
  let result = {}
  entries.forEach(en => {
    result[en.name] = en
  })

  return result
}

const entriesToObj = entries => {
  let result = {}

  entries.forEach(([name, value]) => {
    result[name] = value
  })

  return result
}

const flow = (value, ...fns) => {
  let v = value
  fns.forEach(f => {
    v = f(v)
  })
  return v
}

const map = f => col => col.map(f)

const toposort = defs => {
  let sorted = new Array(defs.length)
  let cursor = 0
  let visited = u.newSet()
  let defMap = toObj(defs)

  const depsOf = node => objEntries(node.deps)

  const visit = (node, dependents) => {
    if (dependents.indexOf(node) >= 0) {
      throw new Error(
        `Circular dependency (->: depends on): ${[...dependents, node]
          .map(d => d.name)
          .join(' -> ')}`
      )
    }
    if (u.containedInSet(node, visited)) return
    visited = u.addToSet(node, visited)

    depsOf(node).forEach(([internal, dep]) => {
      let nextNode
      let skip = true

      if (typeof dep === 'string') {
        nextNode = defMap[dep]
        skip = false
      } else if (Array.isArray(dep)) {
        nextNode = defMap[dep[0]]
        skip = false
      }

      if (!skip && nextNode == null) {
        throw new Error(
          `Unsatisfied dependency '${internal}' of unit '${
            node.name
          }'. Unit '${dep}' not found.`
        )
      }

      if (!skip) visit(nextNode, [...dependents, node])
    })

    sorted[cursor++] = node
  }

  defs.forEach(dep => visit(dep, []))

  return sorted
}
