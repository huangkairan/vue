/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling
} from '../util/index'

// defineProperty 第三个参数的一些共享配置
const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

// 通过defineProperty 对每个key代理到Vue实例上
export function proxy(target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter() {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter(val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState(vm: Component) {
  // 初始化_watchers，用来存储所有该组件实例的watcher对象
  vm._watchers = []
  // 引用
  const opts = vm.$options
  // 初始化props
  if (opts.props) initProps(vm, opts.props)
  // 初始化methods
  if (opts.methods) initMethods(vm, opts.methods)
  // 如果data有值，初始化data，否则给data赋值为{}，并观察
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  // 初始化computed
  if (opts.computed) initComputed(vm, opts.computed)
  // 初始化watch，这边再次检查 避免watch是火狐浏览器上Object原型链上的watch
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}

function initProps(vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  // 通过判断vm.$parent是否存在来判断是否是根节点
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData(vm: Component) {
  let data = vm.$options.data
  // $options.data在mergeOptions时被处理成了fn，这里再次判断是因为
  // 在mergeOptions和initState之间call了beforeCreate
  // 如果用户在beforeCreate修改了this.$options.data，就不再是fn
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  // 如果data返回不是一个对象，初始化data为空
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  // 拿所有key
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    //依次获取每个key
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    // 检查这个key在props上是否有定义
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
      // 检查key是否不以$或_开头，这俩开头意味着是Vue的内部属性
    } else if (!isReserved(key)) {
      // 代理
      proxy(vm, `_data`, key)
    }
  }
  // 将对象转换成响应式对象
  observe(data, true /* asRootData */)
}

// 调用data函数并返回
export function getData(data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  // 还是防止重复触发依赖getter
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

// computed默认是惰性的
const computedWatcherOptions = { lazy: true }

// 接收两个参数，第一个参数是组件对象实例，第二个参数是对应的选项
function initComputed(vm: Component, computed: Object) {
  // $flow-disable-line
  // 相同引用一个空对象
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  // 判断是否是服务端渲染
  const isSSR = isServerRendering()

  // 遍历computed对象
  for (const key in computed) {
    // 计算属性对象中相应的属性值
    const userDef = computed[key]

    // cmoputed也有两种写法，函数或对象
    // 如果是函数的话，直接赋值给getter；如果是对象，则取其get
    // 总之getter会是一个函数
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    // getter不能为null
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    // 非服务端渲染，创建了一个观察者实例对象，我们称之为计算属性的观察者，同时会把计算属性的观察者添加到 watchers 常量对象中
    // watchers 常量与 vm._computedWatchers 属性具有相同的引用
    // 所以对 watchers 常量的修改相当于对 vm._computedWatchers 属性的修改
    // vm._computedWatchers 对象是用来存储计算属性观察者的。
    if (!isSSR) {
      // create internal watcher for the computed property.

      // 第四个参数是options，可以包括deep immediate等，这里传了个lazy：true标识是computed的观察者
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.

    // 首先检查计算属性的名字是否已经存在于组件实例对象中，在初始化计算属性之前已经初始化了 props、methods 和 data 选项，
    // 并且这些选项数据都会定义在组件实例对象上，由于计算属性也需要定义在组件实例对象上
    // 所以需要使用计算属性的名字检查组件实例对象上是否已经有了同名的定义
    // 如果该名字已经定义在组件实例对象上，那么有可能是 data 数据或 props 数据或 methods 数据之一
    // 对于 data 和 props 来讲他们是不允许被 computed 选项中的同名属性覆盖的
    // 所以在非生产环境中还要检查计算属性中是否存在与 data 和 props 选项同名的属性
    // 如果有则会打印警告信息。如果没有则调用 defineComputed 定义计算属性。
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      } else if (vm.$options.methods && key in vm.$options.methods) {
        warn(`The computed property "${key}" is already defined as a method.`, vm)
      }
    }
  }
}

// 通过 Object.defineProperty 函数在组件实例对象上定义与计算属性同名的组件实例属性
export function defineComputed(
  target: any,
  key: string,
  userDef: Object | Function
) {
  // 非服务端渲染，缓存
  const shouldCache = !isServerRendering()
  // 如果是定义的computed是函数，cache情况，将函数名传入调用createComputedGetter，将返回值作为sharedPropertyDefinition.get
  // 服务端渲染情况，将这个函数作为值传入createGetterInvoker，返回追赋予sharedPropertyDefinition.get
  if (typeof userDef === 'function') {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
    // 如果computed是对象，基本同上
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    sharedPropertyDefinition.set = userDef.set || noop
  }
  //非生产环境下如果发现 sharedPropertyDefinition.set 的值是一个空函数
  // 那么说明开发者并没有为计算属性定义相应的 set 拦截器函数
  // 这时会重写 sharedPropertyDefinition.set 函数
  // 这样当你在代码中尝试修改一个没有指定 set 拦截器函数的计算属性的值时，就会得到一个警告信息
  if (process.env.NODE_ENV !== 'production' &&
    sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

// 返回一个getter拦截器函数
function createComputedGetter(key) {
  return function computedGetter() {
    // 拿到watcher实例
    const watcher = this._computedWatchers && this._computedWatchers[key]
    // 实例存在的情况下
    if (watcher) {
      // computed情况，手动求值
      if (watcher.dirty) {
        watcher.evaluate()
      }
      // 如果此时Dep.target存在，则是渲染函数的观察者对象。
      if (Dep.target) {
        watcher.depend()
      }
      return watcher.value
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter() {
    return fn.call(this, this)
  }
}

function initMethods(vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

function initWatch(vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key]
    // handler居然可以传数组，给一个数据添加多个观察者（有啥用吗）
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

// 主要的作用还是将传来的cb对象规范一下，然后将规范后的参数传入$watch方法调用
function createWatcher(
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
  // 判断handler是否是对象；这边虽然在定义Vue.property.$watch时判断了handler是否为对象
  // 此处再判断一次是因为，这个方法还会用于watch option。
  // 如果 handler 是一个纯对象，那么就将变量 handler（对象：{handler:()=>{},immediate:boolean,deep:boolean}）
  // 的值赋给 options 变量，然后用 handler.handler 的值（函数）重写 handler 变量的值
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  // 这里标识handler还能是个string，读取组件实例对象的 handler 属性的值并用该值重写 handler 的值。然后再通过调用 $watch 方法创建观察者
  // 这里的目的是，我们知道methods的定义会添加到Vue原型上，此处会将methods里的同名方法定义给handler
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  return vm.$watch(expOrFn, handler, options)
}

// 在Vue的原型上添加$data,$props,$set,$delete,$watch方法
export function stateMixin(Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  // 如果是非生产环境，告诉开发者别想修改$data和$props，也就是说 $data和$props都是只读属性
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  // $data其实代理的是_data这个实例属性
  // $props其实代理的是_props这个实例属性
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  // 观察数据对象的某个属性，当属性变化时执行回调
  // 第二个参数既可以是一个回调函数，也可以是一个纯对象，这个对象中可以包含 handler 属性，该属性的值将作为回调函数.同时该对象还可以包含其他属性作为选项参数，如 immediate 或 deep。
  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    // 当前组件实例对象
    const vm: Component = this
    // 如果cb是对象
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    // 走到这，说明cb是个fn
    // options如果没传，赋值一个空对象
    options = options || {}
    // 标识是用户创建的user
    options.user = true
    // 创建一个Watcher实例
    const watcher = new Watcher(vm, expOrFn, cb, options)
    // 这tm？ 回溯？ 刚开始看，挖个坑 后面再详看
    // 判断是否立刻执行，如果立刻则直接执行回调函数，不过此时的回调函数只有旧的值
    if (options.immediate) {
      const info = `callback for immediate watcher "${watcher.expression}"`
      pushTarget()
      // 这里看到，旧的值是通过之前创建的watcher实例对象的value属性拿的
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info)
      popTarget()
    }
    // 如果callback是函数，则返回一个取消watch的方法
    return function unwatchFn() {
      watcher.teardown()
    }
  }
}
