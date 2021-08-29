/* @flow */

import { _Set as Set, isObject } from '../util/index'
import type { SimpleSet } from '../util/index'
import VNode from '../vdom/vnode'

const seenObjects = new Set()

/**
 * Recursively traverse an object to evoke all converted
 * getters, so that every nested property inside the object
 * is collected as a "deep" dependency.
 */
export function traverse(val: any) {
  _traverse(val, seenObjects)
  seenObjects.clear()
}

// val：被观察对象的值 seen：存已经遍历过的数据，用来避免死循环
function _traverse(val: any, seen: SimpleSet) {
  let i, keys
  const isA = Array.isArray(val)
  // 判断val必须为数组或对象，且不能被冻结，也不是VNode；否则直接返回
  if ((!isA && !isObject(val)) || Object.isFrozen(val) || val instanceof VNode) {
    return
  }
  // 如果val有__ob__这个属性，说明val已经被观察了，则拿到depId，判断是否存在于seen，没有则添加；是则跳过当前item
  // 解决了循环引用的问题
  if (val.__ob__) {
    const depId = val.__ob__.dep.id
    if (seen.has(depId)) {
      return
    }
    seen.add(depId)
  }
  // 如果是数组，遍历item并递归调用_traverse
  if (isA) {
    i = val.length
    while (i--) _traverse(val[i], seen)
    // else 说明是对象，遍历key并递归调用_traverse
  } else {
    keys = Object.keys(val)
    i = keys.length
    while (i--) _traverse(val[keys[i]], seen)
  }
}
