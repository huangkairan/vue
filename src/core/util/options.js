/* @flow */

import config from '../config'
import { warn } from './debug'
import { set } from '../observer/index'
import { unicodeRegExp } from './lang'
import { nativeWatch, hasSymbol } from './env'

import {
  ASSET_TYPES,
  LIFECYCLE_HOOKS
} from 'shared/constants'

import {
  extend,
  hasOwn,
  camelize,
  toRawType,
  capitalize,
  isBuiltInTag,
  isPlainObject
} from 'shared/util'

/**
 * Option overwriting strategies are functions that handle
 * how to merge a parent option value and a child option
 * value into the final value.
 */
// 全局配置对象，此时还是空对象
// 选项覆盖策略是处理如何将父选项值和子选项值合并到最终值的函数。也就是说，不同的选项会使用不同的策略合并
// 在开发中，我们如果自定义一个options.customOption，会走默认的defaultStrat合并
// 如果我们想自定义合并策略，可以自己写Vue.config.optionMergeStrategies.customOption = function(parentVal,childVal){ return parentVal ? parentVal + childVal : childVal }
const strats = config.optionMergeStrategies

/**
 * Options with restrictions
 */

// el和propsData只有在非生产环境才有
if (process.env.NODE_ENV !== 'production') {
  strats.el = strats.propsData = function (parent, child, vm, key) {
    // 这里的vm为 mergeOptions中传来的vm（第三个参数），但如果是通过Vue.extends调用的mergeOptions，则这里为false（子组件的情况）
    if (!vm) {
      warn(
        `option "${key}" can only be used during instance ` +
        'creation with the `new` keyword.'
      )
    }
    // 如果children为空，返回parent，否则返回child
    return defaultStrat(parent, child)
  }
}

/**
 * Helper that recursively merges two data objects together.
 */
// 总之，mergeData会接受两个对象，将from的对象的属性merge到to对象中，也可以说是把parentVal对象的熟悉merge到childVal对象中
function mergeData(to: Object, from: ?Object): Object {
  // 没from，直接返回to
  if (!from) return to
  let key, toVal, fromVal

  const keys = hasSymbol
    ? Reflect.ownKeys(from)
    : Object.keys(from)
  // 遍历from的key
  for (let i = 0; i < keys.length; i++) {
    key = keys[i]
    // in case the object is already observed...
    if (key === '__ob__') continue
    toVal = to[key]
    fromVal = from[key]
    // 如果 from 对象中的 key 不在 to 对象中，则使用 set 函数为 to 对象设置 key 及相应的值
    if (!hasOwn(to, key)) {
      set(to, key, fromVal)
      // 如果 from 对象中的 key 也在 to 对象中，且这两个属性的值都是纯对象则递归进行深度合并
    } else if (
      toVal !== fromVal &&
      isPlainObject(toVal) &&
      isPlainObject(fromVal)
    ) {
      mergeData(toVal, fromVal)
    }
  }
  //最后返回to对象
  return to
}

/**
 * Data
 */
// 永远返回一个函数 mergedDataFn 或 mergedInstanceDataFn
export function mergeDataOrFn(
  parentVal: any,
  childVal: any,
  vm?: Component
): ?Function {
  // vm=false，为子组件
  if (!vm) {
    // in a Vue.extend merge, both should be functions
    // 当拿不到vm的时候，说明是在Vue.extend()中处理的，此时parentVal和childVal都是fn
    // 没传child，返回parent
    if (!childVal) {
      return parentVal
    }
    // 没传parent，返回child
    if (!parentVal) {
      return childVal
    }
    // when parentVal & childVal are both present,
    // we need to return a function that returns the
    // merged result of both functions... no need to
    // check if parentVal is a function here because
    // it has to be a function to pass previous merges.
    //当parent和child同时存在，返回mergedDataFn，mergedDataFn内部调用了mergeData
    return function mergedDataFn() {
      return mergeData(
        typeof childVal === 'function' ? childVal.call(this, this) : childVal,
        typeof parentVal === 'function' ? parentVal.call(this, this) : parentVal
      )
    }
  } else {
    // 如果是有vm的情况，直接返回mergedInstanceDataFn函数
    return function mergedInstanceDataFn() {
      // instance merge
      const instanceData = typeof childVal === 'function'
        ? childVal.call(vm, vm)
        : childVal
      const defaultData = typeof parentVal === 'function'
        ? parentVal.call(vm, vm)
        : parentVal
      if (instanceData) {
        return mergeData(instanceData, defaultData)
      } else {
        return defaultData
      }
    }
  }
}

// 处理data策略，由于mergeDataOrFn永远会返回一个fn，这里strats.data的值也永远是个fn
// 处理成函数的原因是为了保证每个组件实例中的数据都唯一，不互相污染
// 此处不直接执行的原因是，Vue初始化时，inject和props的处理时优先于data，这就保证了使用props初始化data的数据
strats.data = function (
  parentVal: any,
  childVal: any,
  vm?: Component
): ?Function {
  // 先判断是否传入vm，是否是子组件（子组件为false）
  if (!vm) {
    // 如果childVal不是function，警告；因为子组件中的data必须是一个返回对象的函数，并返回parentVal
    if (childVal && typeof childVal !== 'function') {
      process.env.NODE_ENV !== 'production' && warn(
        'The "data" option should be a function ' +
        'that returns a per-instance value in component ' +
        'definitions.',
        vm
      )

      return parentVal
    }
    // 如果childVal是函数，则返回执行mergeDataOrFn的结果，并不会传入vm
    return mergeDataOrFn(parentVal, childVal)
  }

  // 此处，如果传入了vm，说明此处不是子组件，是个用new创建的实例，则直接返回一个mergeDataOrFn的结果，同时会传入vm
  return mergeDataOrFn(parentVal, childVal, vm)
}

/**
 * Hooks and props are merged as arrays.
 */

// 生命周期的合并策略 parentVal一定是数组

/**
 * 
 * return (是否有 childVal，即判断组件的选项中是否有对应名字的生命周期钩子函数)
  ? 如果有 childVal 则判断是否有 parentVal
    ? 如果有 parentVal 则使用 concat 方法将二者合并为一个数组
    : 如果没有 parentVal 则判断 childVal 是不是一个数组
      ? 如果 childVal 是一个数组则直接返回
      : 否则将其作为数组的元素，然后返回数组
  : 如果没有 childVal 则直接返回 parentVal
 */
function mergeHook(
  parentVal: ?Array<Function>,
  childVal: ?Function | ?Array<Function>
): ?Array<Function> {
  const res = childVal
    ? parentVal
      ? parentVal.concat(childVal)
      // 这里这个判断childVal是否为数组，意味着其实生命周期hook里时可以写数组的，虽然没试过
      : Array.isArray(childVal)
        ? childVal
        : [childVal]
    : parentVal
  return res
    ? dedupeHooks(res)
    : res
}

function dedupeHooks(hooks) {
  const res = []
  for (let i = 0; i < hooks.length; i++) {
    if (res.indexOf(hooks[i]) === -1) {
      res.push(hooks[i])
    }
  }
  return res
}

// 遍历生命周期，将合并生命周期fn挂在strats[生命周期hook]上
LIFECYCLE_HOOKS.forEach(hook => {
  strats[hook] = mergeHook
})

/**
 * Assets
 *
 * When a vm is present (instance creation), we need to do
 * a three-way merge between constructor options, instance
 * options and parent options.
 */
// 资源合并策略，在Vue中，directives，filter，components都被认为是资源
// 整体与生命周期hook的合并策略几乎一致
function mergeAssets(
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): Object {
  // 以parentVal为原型创建对象
  const res = Object.create(parentVal || null)
  // 如果有childVal，使用extend，将childVal上的属性merge到res上，否则直接返回
  // 这里注意到，使用中组件如keep-alive，transition组件无需在components中声明（filters，directives也是一样）
  // 是因为Vue在初始化的时候，将KeepAlive，Transition，TransitionGroup、v-model、v-bind等注册在了Vue.options.components、filters、directives上
  if (childVal) {

    // 非生产环境下，检测childVal是不是一个纯对象
    process.env.NODE_ENV !== 'production' && assertObjectType(key, childVal, vm)
    return extend(res, childVal)
  } else {
    return res
  }
}

// 遍历资源，将合并策略fn存在strats[资源]中
ASSET_TYPES.forEach(function (type) {
  strats[type + 's'] = mergeAssets
})

/**
 * Watchers.
 *
 * Watchers hashes should not overwrite one
 * another, so we merge them as arrays.
 */
// watch的合并策略
strats.watch = function (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): ?Object {
  // work around Firefox's Object.prototype.watch...
  // firefox的object原型上有watch，所以做一个判断避免冲突
  if (parentVal === nativeWatch) parentVal = undefined
  if (childVal === nativeWatch) childVal = undefined
  /* istanbul ignore if */
  // 检测了是否有 childVal，即组件选项是否有 watch 选项，如果没有的话，直接以 parentVal 为原型创建对象并返回(如果有 parentVal 的话)。
  if (!childVal) return Object.create(parentVal || null)
  // 非生产 检测是否纯对象
  if (process.env.NODE_ENV !== 'production') {
    assertObjectType(key, childVal, vm)
  }
  // 执行到此处，childVal一定存在，继续判断
  // 如果没有parentVal，返回childVal
  if (!parentVal) return childVal

  // 执行到此处，parentVal和childVal都存在，进行合并处理
  const ret = {}
  // 先将parentVal的属性merge到ret上
  extend(ret, parentVal)

  // 遍历childVal
  for (const key in childVal) {
    // 由于这里遍历的是childVal的key，又用这个key去parentVal上拿值，所以parent不一定会有值
    let parent = ret[key]
    // 这里的child必定有值
    const child = childVal[key]
    // 如果parent有值，并且parent不是数组，将parent放入数组中
    if (parent && !Array.isArray(parent)) {
      parent = [parent]
    }
    // 如果parent存在，此时parent已经被转为数组，将child 合并进去返回
    // 如过parent不存在，则判断child是否为数组，如果不是 就转换为数组返回
    ret[key] = parent
      ? parent.concat(child)
      : Array.isArray(child) ? child : [child]
  }
  // 最后返回新的合并后的对象
  return ret
}

/**
 * Other object hashes.
 */
// props,methods,inject,computed的合并策略
// 为什么能一起处理，因为这几个属性都是纯对象
strats.props =
  strats.methods =
  strats.inject =
  strats.computed = function (
    parentVal: ?Object,
    childVal: ?Object,
    vm?: Component,
    key: string
  ): ?Object {
    // 开始先来判断个是否为对象
    if (childVal && process.env.NODE_ENV !== 'production') {
      assertObjectType(key, childVal, vm)
    }
    // 如果没parentVal，返回childVal
    if (!parentVal) return childVal
    // 创建空对象
    const ret = Object.create(null)
    // 执行到此处，parentVal必存在，将parentVal合并到ret
    extend(ret, parentVal)
    // 如果childVal存在，将childVal合并至ret
    if (childVal) extend(ret, childVal)
    // 返回ret
    return ret
  }

// provide合并策略， 与处理data一样
strats.provide = mergeDataOrFn

/**
 * Default strategy.
 */
// 默认策略： 如果children为空，返回parent，否则返回child
const defaultStrat = function (parentVal: any, childVal: any): any {
  return childVal === undefined
    ? parentVal
    : childVal
}

/**
 * Validate component names
 */
function checkComponents(options: Object) {
  for (const key in options.components) {
    validateComponentName(key)
  }
}

export function validateComponentName(name: string) {
  if (!new RegExp(`^[a-zA-Z][\\-\\.0-9_${unicodeRegExp.source}]*$`).test(name)) {
    warn(
      'Invalid component name: "' + name + '". Component names ' +
      'should conform to valid custom element name in html5 specification.'
    )
  }

  // 判断是否是内置关键字 isBuiltInTag:slot,component;isReservedTag:key,ref,slot,slot-scope,is
  if (isBuiltInTag(name) || config.isReservedTag(name)) {
    warn(
      'Do not use built-in or reserved HTML elements as component ' +
      'id: ' + name
    )
  }
}

/**
 * Ensure all props option syntax are normalized into the
 * Object-based format.
 */
// 将props规范为对象
function normalizeProps(options: Object, vm: ?Component) {
  // 非空判断
  const props = options.props
  if (!props) return
  const res = {}
  let i, val, name
  // props两种写法，对象或数组，如果是数组写法，type会被规范为null
  if (Array.isArray(props)) {
    i = props.length
    while (i--) {
      val = props[i]
      if (typeof val === 'string') {
        name = camelize(val)
        res[name] = { type: null }
      } else if (process.env.NODE_ENV !== 'production') {
        warn('props must be strings when using array syntax.')
      }
    }
    //props为对象
  } else if (isPlainObject(props)) {
    for (const key in props) {
      val = props[key]
      name = camelize(key)
      res[name] = isPlainObject(val)
        ? val
        : { type: val }
    }
    // 既不是数组，也不是对象，非生产环境警告
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
      `but got ${toRawType(props)}.`,
      vm
    )
  }
  // 用处理后的props覆盖处理前的props
  options.props = res
}

/**
 * Normalize all injections into Object-based format
 */
// 规范inject
function normalizeInject(options: Object, vm: ?Component) {
  // 缓存options.inject
  const inject = options.inject
  // 非空处理
  if (!inject) return
  // 重写optoins.inject，重写定义一个变量
  const normalized = options.inject = {}
  // 同样判断是数组还是对象写法，分别处理
  if (Array.isArray(inject)) {
    for (let i = 0; i < inject.length; i++) {
      normalized[inject[i]] = { from: inject[i] }
    }
  } else if (isPlainObject(inject)) {
    for (const key in inject) {
      const val = inject[key]
      normalized[key] = isPlainObject(val)
        ? extend({ from: key }, val)
        : { from: val }
    }
    // 警告
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "inject": expected an Array or an Object, ` +
      `but got ${toRawType(inject)}.`,
      vm
    )
  }
  // 这里不用重新赋值是因为上面 const normalized = options.inject = {}；normalized和options.inject引用相同
}

/**
 * Normalize raw function directives into object format.
 */
// 规范directive指令
function normalizeDirectives(options: Object) {
  // 缓存
  const dirs = options.directives
  // 非空处理
  if (dirs) {
    for (const key in dirs) {
      const def = dirs[key]
      // 这里也是判断directives的写法，可能是对象或函数写法
      if (typeof def === 'function') {
        dirs[key] = { bind: def, update: def }
      }
    }
  }
}

function assertObjectType(name: string, value: any, vm: ?Component) {
  if (!isPlainObject(value)) {
    warn(
      `Invalid value for option "${name}": expected an Object, ` +
      `but got ${toRawType(value)}.`,
      vm
    )
  }
}

/**
 * Merge two option objects into a new one.
 * Core utility used in both instantiation and inheritance.
 */
// 作用：将传入的两个options合并
// 三个参数：父节点，子节点，vue实例
export function mergeOptions(
  parent: Object,
  child: Object,
  vm?: Component
): Object {
  // 如果是非生产环境，会传入child调用，遍历校验每个子组件的名字是否规范
  if (process.env.NODE_ENV !== 'production') {
    checkComponents(child)
  }

  // child还可以是函数，获取函数的options
  if (typeof child === 'function') {
    child = child.options
  }

  // 规范props
  normalizeProps(child, vm)
  // 规范注入
  normalizeInject(child, vm)
  // 规范指令
  normalizeDirectives(child)

  // Apply extends and mixins on the child options,
  // but only if it is a raw options object that isn't
  // the result of another mergeOptions call.
  // Only merged options has the _base property.
  // 处理extends和mixins。同样规范化，只是入参不同
  // 先处理extends，后处理mixins，每次处理后parent会被规范化的对象覆盖
  if (!child._base) {
    if (child.extends) {
      parent = mergeOptions(parent, child.extends, vm)
    }
    // mixinx是数组，所以遍历merge
    if (child.mixins) {
      for (let i = 0, l = child.mixins.length; i < l; i++) {
        // 递归合并options，将child的mixin都merge到parent中，生成一个新的parent
        parent = mergeOptions(parent, child.mixins[i], vm)
      }
    }
  }

  const options = {}
  let key
  // 遍历parent
  for (key in parent) {
    mergeField(key)
  }
  // 遍历child
  for (key in child) {
    // hasOwnProperty
    if (!hasOwn(parent, key)) {
      mergeField(key)
    }
  }
  // 当一个选项没对应的策略函数时，使用默认策略
  function mergeField(key) {
    const strat = strats[key] || defaultStrat
    options[key] = strat(parent[key], child[key], vm, key)
  }
  return options
}

/**
 * Resolve an asset.
 * This function is used because child instances need access
 * to assets defined in its ancestor chain.
 */
export function resolveAsset(
  options: Object,
  type: string,
  id: string,
  warnMissing?: boolean
): any {
  /* istanbul ignore if */
  if (typeof id !== 'string') {
    return
  }
  const assets = options[type]
  // check local registration variations first
  if (hasOwn(assets, id)) return assets[id]
  const camelizedId = camelize(id)
  if (hasOwn(assets, camelizedId)) return assets[camelizedId]
  const PascalCaseId = capitalize(camelizedId)
  if (hasOwn(assets, PascalCaseId)) return assets[PascalCaseId]
  // fallback to prototype chain
  const res = assets[id] || assets[camelizedId] || assets[PascalCaseId]
  if (process.env.NODE_ENV !== 'production' && warnMissing && !res) {
    warn(
      'Failed to resolve ' + type.slice(0, -1) + ': ' + id,
      options
    )
  }
  return res
}
