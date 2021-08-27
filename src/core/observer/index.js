/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
// 为true表示需要观察，为false：不需要观察，通过下方toggleObserving来控制。
export let shouldObserve: boolean = true

// 控制是否需要观察
export function toggleObserving(value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor(value: any) {
    // 引用传进来的数据
    this.value = value
    // dep new了一个Dep实例，作用是收集依赖
    this.dep = new Dep()
    // 初始化vmCount
    this.vmCount = 0
    // 为value定义一个__ob__属性，值是当前的Observer实例
    def(value, '__ob__', this)
    // data={a:1}经过def处理后：
    // data = {
    //a: 1,
    // __ob__ 是不可枚举的属性
    //__ob__: {
    //value: data, // value 属性指向 data 数据对象本身，这是一个循环引用
    //dep: dep实例对象, // new Dep()
    //vmCount: 0
    //}
    // 区分传来的是数组还是对象，两者的处理方式不同
    // 数组原生有很多方法 如pop push shift ....
    if (Array.isArray(value)) {
      // 如果环境支持__proto__
      // 这里不管是走if或else，都是为了将数组的__proto__指向由变异数组方法组成的对象
      if (hasProto) {
        // 将value的__proto__指向由变异数组方法组成的对象，代理
        protoAugment(value, arrayMethods)
      } else {
        // 如果环境不支持__proto__，做一些polyfill
        copyAugment(value, arrayMethods, arrayKeys)
      }
      // 递归观察数组中的值，observeArray方法中又会对依赖依次new Observer，这样保证了数组/对象内嵌套数组/对象的情况。
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  //使用 Object.keys(obj) 获取对象所有可枚举的属性
  //然后使用 for 循环遍历这些属性，同时为每个属性调用了 defineReactive 函数。
  walk(obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray(items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment(target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment(target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
// 接受两个参数，第一个为观察的数据，第二个为是否是根数据的布尔
export function observe(value: any, asRootData: ?boolean): Observer | void {
  // 如果观察的数据不是对象， 或观察的数据是VNode的实例，则结束
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  // 定义ob 来保存Observer实例
  let ob: Observer | void
  // 如果观察的对象里有__ob__属性（意味着已经被观察了） 并且__ob__是Observer的实例；直接赋值__ob__的引用，避免呢重复观察
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
    // 走到这里意味着对象未被观察
  } else if (
    // 需要观察
    shouldObserve &&
    // 不是服务端渲染
    !isServerRendering() &&
    // 只有当数据是数组或纯对象
    (Array.isArray(value) || isPlainObject(value)) &&
    // 对象是可扩展的（普通对象都是可扩展的，除非用Object.preventExtensions()、Object.freeze() 以及 Object.seal()）
    Object.isExtensible(value) &&
    // Vue实例有_isVue属性，这里用来避免Vue实例对象被观察
    !value._isVue
  ) {
    // new一个Observer实例
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 */
export function defineReactive(
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // new 一个Dep实例
  const dep = new Dep()

  // 拿到对象的描述对象
  const property = Object.getOwnPropertyDescriptor(obj, key)
  // 如果对象是不可配置的，结束
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  // 拿到数据的描述对象中的get和set
  const getter = property && property.get
  const setter = property && property.set
  //如果。。。 并且只传了两个参数（只传了obj和key）直接赋值；否则val还是undefined
  // 见issue 7302
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  // 没传shallow参数，深度观察，规避val是个对象的情况
  // 之前的$attrs和$listener时，shallow都传了true，只会做浅层的观察
  let childOb = !shallow && observe(val)
  // 
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter() {
      // 如果属性原来的getter存在，调用getter；否则返回val（在get最后）
      const value = getter ? getter.call(obj) : val
      //Dep.target 中保存的值就是要被收集的依赖(观察者)；如果有 说明这个依赖要被收集
      if (Dep.target) {
        // 闭包引用了上面的dep实例，依赖被收集了
        dep.depend()
        // 如果childOb存在
        // 作用：除了要将依赖收集到属性自己这里之外，还要将同样的依赖收集到 data.属性.__ob__.dep 里
        // 因为defineProperty没法拦截到给对象添加新属性的操作
        // 收集到自己这的依赖当属性值被set时就会触发
        // 而收集到data.属性.__ob__.dep中的依赖会在使用 $set 或 Vue.set 给数据对象添加新属性时触发
        if (childOb) {
          childOb.dep.depend()
          // 如果value是个数组，则遍历收集依赖
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter(newVal) {
      // 重新拿一次getter后的值（如果有getter的话）
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 将新value和旧value对比，如果相同就结束
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      // 非生产，自己定义了customSetter，则执行；这里在initRender里有传，作用是setter时log了一些信息
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      // 还是一样，如果属性原来就有setter，调用setter；否则直接赋值
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      // 避免childOb
      childOb = !shallow && observe(newVal)
      // 闭包引用了上面的dep实例，当set时，触发所有在get时收集到的依赖
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */

// Vue.$set
export function set(target: Array<any> | Object, key: any, val: any): any {
  // 非生产，如果是undefined、null、原始类型，警告。因为set只能set数组或对象
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  // 校验target和key是否合法
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    // 将指定位置元素的值替换为新值，调用了变异splice
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  // 走到这里，说明target是个对象，如果对象里已经有这个key，且key不在Object的原型上，直接修改值
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  // 走到这里，说明在给对象添加一个新属性。
  const ob = (target: any).__ob__
  // 判断不是在Vue的实例上添加属性，避免覆盖了Vue的属性
  //  (ob && ob.vmCount) 不允许给根数据（data对象，因为data对象本身不是响应式的）添加响应式对象
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  // 如果没有ob，说明不是响应式的对象，直接赋值即可
  if (!ob) {
    target[key] = val
    return val
  }
  // 观察新属性，给新属性设置相应式
  defineReactive(ob.value, key, val)
  // target上的依赖更新，触发响应
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del(target: Array<any> | Object, key: any) {
  // 检测 target 是否是 undefined 或 null 或者是原始类型值
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  // 如果是array且index合法，调用变异splice删除
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  // 走到这说明是对象
  const ob = (target: any).__ob__
  // 排除是Vue上的属性和根数据（data）
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  // 如果对象上没这个key，返回
  if (!hasOwn(target, key)) {
    return
  }
  // 走到这步说明对象上有这个key
  delete target[key]
  // 如果没__ob__，说明是个普通对象非响应式对象，返回
  if (!ob) {
    return
  }
  // 依赖变更，触发响应
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
// 递归使得数组内的所有数据都收集依赖
function dependArray(value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    // 如果该数据有__ob__和__ob__.dep，说明该数据也是数组（因为数组通过索引改值无法触发响应），则递归收集依赖
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
