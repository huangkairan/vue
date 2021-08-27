/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

// 保证了arrayMethods.__proto__ === Array.prototype
const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

// 拦截的数组方法都是会直接修改原数据的
const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */

//循环在 arrayMethods 对象上定义了与数组变异方法同名的函数，并在这些函数内调用了真正数组原型上的相应方法。
methodsToPatch.forEach(function (method) {
  // cache original method
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator(...args) {
    const result = original.apply(this, args)
    // 拿到数组实例的__ob__
    const ob = this.__ob__
    // inserted 用来保存新添加的数据，因为新加的数据不是响应式的
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        // splice 函数从第三个参数开始到最后一个参数都是数组的新增元素，所以直接使用 args.slice(2) 作为 inserted 的值
        inserted = args.slice(2)
        break
    }
    // 将插入的新数据观察，成为相应式数据
    if (inserted) ob.observeArray(inserted)
    // notify change
    // 由于拦截的数组方法都是会直接修改原数据的，所以当调用方法时notify，将数组的依赖拿出来执行
    ob.dep.notify()
    return result
  })
})
