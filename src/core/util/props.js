/* @flow */

import { warn } from './debug'
import { observe, toggleObserving, shouldObserve } from '../observer/index'
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject
} from 'shared/util'

type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function
};

export function validateProp(
  key: string,
  propOptions: Object,
  propsData: Object,
  vm?: Component
): any {
  // key 的 props 的定义 如 {type:String}
  const prop = propOptions[key]
  // 对应的 prop 在 propsData 上是否有数据，为true标识没传；false传了
  const absent = !hasOwn(propsData, key)
  // prop key的值
  let value = propsData[key]
  // boolean casting
  // 查找第一个参数所指定的类型构造函数是否存在于第二个参数所指定的类型构造函数数组中，第二个参数可能是一个数组
  const booleanIndex = getTypeIndex(Boolean, prop.type)
  // 如果大于-1,标识是boolean类型
  if (booleanIndex > -1) {
    // 如果prop没数据，给一个默认值false
    if (absent && !hasOwn(prop, 'default')) {
      value = false
      // absent = false，标识外界传了prop的值
      // 这条if标识要么是一个空字符串，要么就是一个名字由驼峰转连字符后与值为相同字符串的 prop
    } else if (value === '' || value === hyphenate(key)) {
      // only cast empty string / same name to boolean if
      // boolean has higher priority
      const stringIndex = getTypeIndex(String, prop.type)
      // 1.没有设置成string类型
      // 2.虽然定义了 String 类型，但是 String 类型的优先级没有 Boolean 高（数组情况，在前面的优先级高）
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true
      }
    }
  }
  // check default value
  // 处理默认值
  if (value === undefined) {
    value = getPropDefaultValue(vm, prop, key)
    // since the default value is a fresh copy,
    // make sure to observe it.

    // 先保存了之前的shouldObserve状态
    const prevShouldObserve = shouldObserve
    // 设置需要观察
    toggleObserving(true)
    // 观察值
    observe(value)
    // 恢复到之前的状态
    toggleObserving(prevShouldObserve)
  }
  // 对props的类型做校验
  if (
    process.env.NODE_ENV !== 'production' &&
    // skip validation for weex recycle-list child component props
    !(__WEEX__ && isObject(value) && ('@binding' in value))
  ) {
    assertProp(prop, key, value, vm, absent)
  }
  return value
}

/**
 * Get the default value of a prop.
 */
// 拿prop的默认值
function getPropDefaultValue(vm: ?Component, prop: PropOptions, key: string): any {
  // no default, return undefined
  // 如果没默认值，返回undefined
  if (!hasOwn(prop, 'default')) {
    return undefined
  }
  const def = prop.default
  // warn against non-factory defaults for Object & Array
  // 非生产，且默认值为对象，警告如果是对象或数组，需要用工厂函数返回值
  // 这么做的目的和data option一样，防止多个组件实例共享一份数据所造成的问题。
  if (process.env.NODE_ENV !== 'production' && isObject(def)) {
    warn(
      'Invalid default value for prop "' + key + '": ' +
      'Props with type Object/Array must use a factory function ' +
      'to return the default value.',
      vm
    )
  }
  // the raw prop value was also undefined from previous render,
  // return previous default value to avoid unnecessary watcher trigger
  // 针对组件更新时的处理。
  // 当组件更新时如下代码中的 vm.$options.propsData 是上一次组件更新或创建时的数据
  //1、当前组件处于更新状态，且没有传递该 prop 数据给组件
  //2、上一次更新或创建时外界也没有向组件传递该 prop 数据
  //3、上一次组件更新或创建时该 prop 拥有一个不为 undefined 的默认值
  // 这样的目的是避免触发无意义的响应，因为default是个函数，每次返回的肯定不相等
  if (vm && vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    // 返回之前的prop值
    return vm._props[key]
  }
  // call factory function for non-Function types
  // a value is Function if its prototype is function even across different execution context
  // 如果prop的默认值是函数，则获取函数的返回值；否则直接拿值
  return typeof def === 'function' && getType(prop.type) !== 'Function'
    ? def.call(vm)
    : def
}

/**
 * Assert whether a prop is valid.
 */
function assertProp(
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean
) {
  // 如果prop是必须的，又没传值，则警告后返回
  if (prop.required && absent) {
    warn(
      'Missing required prop: "' + name + '"',
      vm
    )
    return
  }
  // 如果值为null或undefined且prop不是必须的，返回
  if (value == null && !prop.required) {
    return
  }
  // 判断外界传递的 prop 值的类型与期望的类型是否相符
  // 拿类型
  let type = prop.type
  // 标识类型校验成功与否。！type：没做类型限制
  let valid = !type || type === true
  // 保存类型的数组
  const expectedTypes = []
  // 如果设置 类型
  if (type) {
    // 非数组情况，直接保存
    if (!Array.isArray(type)) {
      type = [type]
    }
    // 数组情况，遍历每个类型，调用props类型检测函数assertType。
    for (let i = 0; i < type.length && !valid; i++) {
      const assertedType = assertType(value, type[i], vm)
      expectedTypes.push(assertedType.expectedType || '')
      valid = assertedType.valid
    }
  }

  // 判断是否是期待的类型，校验是否通过
  const haveExpectedTypes = expectedTypes.some(t => t)
  //校验没通过，警告
  if (!valid && haveExpectedTypes) {
    warn(
      getInvalidTypeMessage(name, value, expectedTypes),
      vm
    )
    return
  }
  // 走到这说明类型校验通过了
  const validator = prop.validator
  // 如果用户定义了验证器，则将value传入执行判断真假
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      )
    }
  }
}

const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol|BigInt)$/

function assertType(value: any, type: Function, vm: ?Component): {
  valid: boolean;
  expectedType: string;
} {
  let valid
  const expectedType = getType(type)
  if (simpleCheckRE.test(expectedType)) {
    const t = typeof value
    valid = t === expectedType.toLowerCase()
    // for primitive wrapper objects
    if (!valid && t === 'object') {
      valid = value instanceof type
    }
  } else if (expectedType === 'Object') {
    valid = isPlainObject(value)
  } else if (expectedType === 'Array') {
    valid = Array.isArray(value)
  } else {
    try {
      valid = value instanceof type
    } catch (e) {
      warn('Invalid prop type: "' + String(type) + '" is not a constructor', vm);
      valid = false;
    }
  }
  return {
    valid,
    expectedType
  }
}

const functionTypeCheckRE = /^\s*function (\w+)/

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 */
// 简单的类型之间直接比较在不同的 iframes / vms 之间是不管用的
// 如：不同 iframes 之间的 Array 构造函数本身都是不相等的
// 这样操作在做类型比较的时候本质上是做字符串之间的比较
function getType(fn) {
  const match = fn && fn.toString().match(functionTypeCheckRE)
  return match ? match[1] : ''
}

function isSameType(a, b) {
  return getType(a) === getType(b)
}

//  查找第一个参数所指定的类型构造函数是否存在于第二个参数所指定的类型构造函数数组中，第二个参数可能是一个数组
function getTypeIndex(type, expectedTypes): number {
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1
  }
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i
    }
  }
  return -1
}

function getInvalidTypeMessage(name, value, expectedTypes) {
  let message = `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(', ')}`
  const expectedType = expectedTypes[0]
  const receivedType = toRawType(value)
  // check if we need to specify expected value
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    isExplicable(typeof value) &&
    !isBoolean(expectedType, receivedType)
  ) {
    message += ` with value ${styleValue(value, expectedType)}`
  }
  message += `, got ${receivedType} `
  // check if we need to specify received value
  if (isExplicable(receivedType)) {
    message += `with value ${styleValue(value, receivedType)}.`
  }
  return message
}

function styleValue(value, type) {
  if (type === 'String') {
    return `"${value}"`
  } else if (type === 'Number') {
    return `${Number(value)}`
  } else {
    return `${value}`
  }
}

const EXPLICABLE_TYPES = ['string', 'number', 'boolean']
function isExplicable(value) {
  return EXPLICABLE_TYPES.some(elem => value.toLowerCase() === elem)
}

function isBoolean(...args) {
  return args.some(elem => elem.toLowerCase() === 'boolean')
}
