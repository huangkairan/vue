/* @flow */

import { hasOwn } from 'shared/util'
import { warn, hasSymbol } from '../util/index'
import { defineReactive, toggleObserving } from '../observer/index'

// 初始化provide
export function initProvide(vm: Component) {
  // 拿到provide
  const provide = vm.$options.provide
  // 如果存在
  if (provide) {
    // 是函数的话调用，否则直接赋值，添加到实例的_provided上
    vm._provided = typeof provide === 'function'
      ? provide.call(vm)
      : provide
  }
}

// 初始化inject
export function initInjections(vm: Component) {
  // 根据当前组件的 inject 选项去父代组件中寻找注入的数据，并将最终的数据返回
  const result = resolveInject(vm.$options.inject, vm)
  // 如果有值，找到了provide的数据
  if (result) {
    // 设置不需要观察
    toggleObserving(false)
    // 遍历result的key，设置为响应式数据
    Object.keys(result).forEach(key => {
      /* istanbul ignore else */
      // 非生产，尝试修改注入的数据时会警告
      if (process.env.NODE_ENV !== 'production') {
        defineReactive(vm, key, result[key], () => {
          warn(
            `Avoid mutating an injected value directly since the changes will be ` +
            `overwritten whenever the provided component re-renders. ` +
            `injection being mutated: "${key}"`,
            vm
          )
        })
      } else {
        defineReactive(vm, key, result[key])
      }
    })
    // 设置需要观察
    // provide 和 inject 绑定并不是可响应的。这是刻意为之的。然而，如果你传入了一个可监听的对象，那么其对象的属性还是可响应的
    toggleObserving(true)
  }
}

// 根据当前组件的 inject 选项去父代组件中寻找注入的数据，并将最终的数据返回
export function resolveInject(inject: any, vm: Component): ?Object {
  /// 如果传了inject
  if (inject) {
    // inject is :any because flow is not smart enough to figure out cached
    // 创建空对象保存结果
    const result = Object.create(null)
    // 如果说支持Symbol，用Reflect拿keys，否则用Object拿keys
    const keys = hasSymbol
      ? Reflect.ownKeys(inject)
      : Object.keys(inject)

    // 遍历keys
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      // #6574 in case the inject object is observed...
      // 解决inject被观察的特殊情况
      if (key === '__ob__') continue
      // 此处inject经过merge，已经被处理成对象形式，直接拿from的值
      const provideKey = inject[key].from
      // 引用实例
      let source = vm
      // 遍历赋值给result
      while (source) {
        if (source._provided && hasOwn(source._provided, provideKey)) {
          result[key] = source._provided[provideKey]
          break
        }
        // 如果if条件为假，在当前组件实例上没找到_provided，则将source指向当前实例的父组件
        source = source.$parent
      }
      // 执行到这说明已经找完了，因为根组件的$parent = null
      // 如果source为空，则说明没有注入，去找default，还没有就警告未注入数据
      if (!source) {
        if ('default' in inject[key]) {
          const provideDefault = inject[key].default
          result[key] = typeof provideDefault === 'function'
            ? provideDefault.call(vm)
            : provideDefault
        } else if (process.env.NODE_ENV !== 'production') {
          warn(`Injection "${key}" not found`, vm)
        }
      }
    }
    // 返回新的inject
    return result
  }
}
