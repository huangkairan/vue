/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor() {
    this.id = uid++
    this.subs = []
  }

  // 将Watcher实例添加至subs数组
  // 收集观察者
  addSub(sub: Watcher) {
    this.subs.push(sub)
  }

  // 将观察者对象从subs数组中移除
  removeSub(sub: Watcher) {
    remove(this.subs, sub)
  }

  depend() {
    // Dep.target保存了一个观察者对象，这个对象就是即将要收集的目标，判断是否存在。
    if (Dep.target) {
      // 如果存在，调用Watcher的addDep方法
      Dep.target.addDep(this)
    }
  }

  // 遍历当前Dep对象的subs中所有观察者对象，调用观察者对象的update方法，触发响应
  notify() {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    // 判断是否同步执行观察者，由于subs是无序的，所以如果要同步，则排序，依次执行
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    // 如果不是同步执行，遍历update
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.
Dep.target = null
const targetStack = []
// 为 Dep.target 属性赋值，target是调用该函数的观察者对象，所以Dep.target保存了一个观察者对象，这个对象就是即将要收集的目标
export function pushTarget(target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}

export function popTarget() {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
