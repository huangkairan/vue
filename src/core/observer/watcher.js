/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  // 非生产环境下该属性的值为表达式(expOrFn)的字符串表示，在生产环境下其值为空字符串，用于非生产环境
  expression: string;
  // 值修改后的回调
  cb: Function;
  // 观察者实例的唯一标识
  id: number;
  // 是否是深度观测
  deep: boolean;
  // 标识当前观察者实例对象是 开发者定义的 还是 内部定义的
  // 除了内部定义的观察者(如：渲染函数的观察者、计算属性的观察者等)之外，所有观察者都被认为是开发者定义的，这时 options.user 会自动被设置为 true。
  user: boolean;
  lazy: boolean;
  // 告诉观察者当数据变化时是否同步求值并执行回调
  sync: boolean;
  // 属性的值与 this.computed 属性的值相同，也就是说只有计算属性的观察者实例对象的 this.dirty 属性的值才会为真，因为计算属性是惰性求值
  dirty: boolean;
  // 标识着该观察者实例对象是否是激活状态
  active: boolean;

  // 这四个属性实现避免收集重复依赖，且移除无用依赖的功能也依赖于它们
  // 上一次求值过程中所收集到的 Dep 实例对象。
  deps: Array<Dep>;
  // 本次求值中收集来的依赖，避免本次求值依赖重复收集
  newDeps: Array<Dep>;
  // depIds用来避免在多次求值中的依赖重复收集
  // 上一次求值过程中所收集到的 Dep 实例对象。
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  // 可以理解为 Watcher 实例的钩子，当数据变化之后，触发更新之前，调用在创建渲染函数的观察者实例对象时传递的 before 选项。
  before: ?Function;
  getter: Function;
  // 保存了被观察目标的值
  value: any;
  //创建 Watcher 实例时可以传递五个参数分别是：组件实例对象 vm、要观察的表达式 expOrFn、当被观察的表达式的值变化时的回调函数 cb、一些传递给当前观察者对象的选项 options 以及一个布尔值 isRenderWatcher 用来标识该观察者实例是否是渲染函数的观察者。
  // Watcher 的原理是通过对“被观测目标”的求值，触发数据属性的 get 拦截器函数从而收集依赖
  // 至于“被观测目标”到底是表达式还是函数或者是其他形式的内容都不重要
  // 重要的是“被观测目标”能否触发数据属性的 get 拦截器函数，很显然函数是具备这个能力的
  constructor(
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    // 将当前组件实例对象 vm 赋值给该观察者实例的 this.vm 属性
    // 也就是说每一个观察者实例对象都有一个 vm 实例属性，该属性指明了这个观察者是属于哪一个组件的
    this.vm = vm
    // 如果是为渲染函数new观察者，（在mountComponent阶段）将当前观察者实例赋值给 vm._watcher 属性（组件的_watcher），也就是说组件实例的 _watcher 属性的值引用着该组件的渲染函数观察者
    if (isRenderWatcher) {
      vm._watcher = this
    }
    // 将当前观察者实例对象 push 到 vm._watchers 数组中
    // 也就是说属于该组件实例的观察者都会被添加到该组件实例对象的 vm._watchers 数组中
    // 包括渲染函数的观察者和非渲染函数的观察者
    vm._watchers.push(this)
    // options
    // 初始化deep，uesr，lazy，sync，before。如果有options，则用options中的值替换，否则为false
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    // 初始化为Set对象
    this.depIds = new Set()
    // newDepIds用来避免在一次求值中的依赖重复收集
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    // 如果expOrFn是fn，则赋值给getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      // 如果expOrFn是'obj.a'这种形式，解析，遍历访问到指定的属性，触发get拦截器，将返回的新的函数作为getter的值
      this.getter = parsePath(expOrFn)
      // 此时，getter肯定为一个函数，否则就是上面parsePath解析失败了
      if (!this.getter) {
        // 将getter赋值为空函数
        this.getter = noop
        // 根据警告可以看出，最好还是传一个函数
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // lazy = false时 赋值undefined，否则赋值this.get()的返回值
    this.value = this.lazy
      ? undefined
      // this.get最后会将值返回，赋值给this.value，说明this.value保存了被观察目标的值
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  // 主要作用：求值
  // 目的 1：触发get拦截器函数 2：获得被观察目标的值
  // get时依赖被收集的关键

  get() {
    // 以当前观察者实例为参数，调用pushTarget，将这个观察者实例对象保存至Dep.target
    pushTarget(this)
    let value
    const vm = this.vm
    // 给value求值，this.getter是一个函数；并在最后将value返回
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        // 归地读取被观察属性的所有子属性的值，这样被观察属性的所有子属性都将会收集到观察者，从而达到深度观测的目的
        traverse(value)
      }
      popTarget()
      // 在get的最后，求值完毕后会使用 depIds 属性和 deps 属性保存 newDepIds 属性和 newDeps 属性的值，然后再清空 newDepIds 属性和 newDeps 属性的值
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  // 接受一个Dep对象
  addDep(dep: Dep) {
    // 定义一个常量，Dep实例的id
    const id = dep.id
    // 这个id配合newDepIds和newDeps，来避免重复收集依赖
    // 这里的避免重复收集依赖原因：
    // 如果组件内有了多个{{name}}，将触发name的getter多次，导致dep.depend也将触发多次，最后导致dep.addSub执行多次，且参数一样
    // 就会导致一个观察者被Dep多次收集的情况

    // newDepIds用来避免在一次求值中的依赖重复收集
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      // depIds用来避免在多次求值中的依赖重复收集
      if (!this.depIds.has(id)) {
        // 将Watcher实例传入，添加至Dep实例的subs数组
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps() {
    //使用 depIds 属性和 deps 属性保存 newDepIds 属性和 newDeps 属性的值，然后再清空 newDepIds 属性和 newDeps 属性的值
    let i = this.deps.length

    // 移除废弃的观察者
    while (i--) {
      const dep = this.deps[i]
      // 如果本次新的dep中，没有上次的dep了，说明该Dep实例对象已经和这个观察者没关系了，调用removeSub将其从移除
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  // 
  update() {
    /* istanbul ignore else */
    // 如果是计算属性，将dirty的值同步为true
    if (this.lazy) {
      this.dirty = true
      // 如果是同步更新变化
    } else if (this.sync) {
      this.run()
      // 如果是异步，则放入一个异步更新的队列中，这个队列会在调用栈被清空之后按照一定的顺序执行
      // 在渲染函数中，就是异步的
    } else {
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run() {
    // 如果为活跃状态
    if (this.active) {
      // 对于渲染函数的观察者来说，重新求值 = 重新渲染，最终结果是重新生成一个vnode，并根据vnode生成真实dom
      const value = this.get()
      // 对于渲染函数的观察者来讲并不会执行这个 if 语句块
      // 因为this.get 方法的返回值其实就等价于 updateComponent 函数的返回值
      // 这个值将永远都是 undefined，因为updateComponent的作用是根据虚拟DOM渲染出真实DOM，并没有返回值

      // 而对于非渲染函数的观察者，就会继续往下走了
      // 比较两次新旧求值的结果，如果不同；或值相等的情况下，value是个对象，两次值的引用相同（因为都是data.xxx），或深度观察时
      // 执行回调
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        // 缓存旧值
        const oldValue = this.value
        // 保存新值
        this.value = value
        // 如果这个观察者是开发者定义的 如通过watch api 或$watch时，回调可能是无法预计的，使用错误处理包裹，调用
        if (this.user) {
          // 出错时的错误信息
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
          //如果是Vue内部的观察者，直接调用回调
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate() {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend() {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  // 解除当前观察者对属性的观察
  teardown() {
    // 如果当前状态为活跃 为假则说明该观察者已经不处于激活状态，什么都不需要做
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.

      // 如果当前组件实例没有被销毁，将当前观察者实例从组件实例对象的 vm._watchers 数组中移除
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      // 一个属性成为响应式数据后，Watcher实例对象会将Dep实例对象收集，同时，Dep实例对象也将收集Watcher实例对象。这是一个双向的过程
      // 并且一个观察者可以同时观察多个属性，这些属性的 Dep 实例对象都会被收集到该观察者实例对象的 this.deps 数组中
      // 所以将当前观察者实例对象从所有的 Dep 实例对象中移除
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      // 最后，将当前观察者实例设为非活跃
      this.active = false
    }
  }
}
