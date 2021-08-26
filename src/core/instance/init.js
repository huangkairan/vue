/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'

let uid = 0

// 在Vue的原型上挂载_init方法，一个初始化的方法
export function initMixin(Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    // 实例唯一id
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    // 非生产环境，并且设置了config.performance（可以追踪性能，详见：core/config.js），标记
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag) // 标记计算代码性能的开始，到结束之间的代码会被计算性能
    }

    // a flag to avoid this being observed
    // 标识是Vue，避免被响应式系统观察
    vm._isVue = true
    // merge options
    // 如果是Vue组件 优化内部组件实例化，因为动态选项合并非常慢，而且没有一个内部组件选项需要特殊处理。
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options)
    } else {
      // 往实例上添加$options，mergeOptions的作用主要是将两个options合并，同时规范化props,inject,directives
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    // 非生产环境，执行initProxy，否则在实例上添加 _renderProxy 实例属性，该属性的值就是当前实例
    if (process.env.NODE_ENV !== 'production') {
      //作用也是在实例对象 vm 上添加 _renderProxy 属性，区别在于会在支持Proxy的环境下用Proxy做代理
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    // 执行一系列init，暴露beforeCreate和created生命周期

    // _self 指向实例本身，和上面_renderProxy不同，_renderPeoxy可能是一个Proxy实例
    vm._self = vm

    // 初始化生命周期
    initLifecycle(vm)

    // 初始化事件
    initEvents(vm)

    // 初始化render
    initRender(vm)
    callHook(vm, 'beforeCreate')
    initInjections(vm) // resolve injections before data/props
    initState(vm)
    initProvide(vm) // resolve provide after data/props
    callHook(vm, 'created')

    /* istanbul ignore if */
    // 标记计算代码性能的结束
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }

    // 挂载节点
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
}

// 优化内部组件实例化，因为动态的选项merge很慢，内部组件需要特殊处理
export function initInternalComponent(vm: Component, options: InternalComponentOptions) {
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  const parentVnode = options._parentVnode
  opts.parent = options.parent
  opts._parentVnode = parentVnode

  const vnodeComponentOptions = parentVnode.componentOptions
  opts.propsData = vnodeComponentOptions.propsData
  opts._parentListeners = vnodeComponentOptions.listeners
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

// 作用：用来获取当前实例构造者的 options 属性
export function resolveConstructorOptions(Ctor: Class<Component>) {
  // Ctor:传进来的vm.constructor
  // 如果使用Vue.extend()创建一个Vue的子类，并用子类创造实例，则这玩意会是子类的constructor
  let options = Ctor.options
  // 此处，super是只有子类才有的属性，如果传入的不是组件，则原封不动返回options
  if (Ctor.super) {
    // 递归处理
    const superOptions = resolveConstructorOptions(Ctor.super)
    // 缓存父类的options
    const cachedSuperOptions = Ctor.superOptions
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      // 解决了使用vue-hot-reload-api或vue-loader时产生的一个bug
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions)
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions(Ctor: Class<Component>): ?Object {
  let modified
  const latest = Ctor.options
  const sealed = Ctor.sealedOptions
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      modified[key] = latest[key]
    }
  }
  return modified
}
