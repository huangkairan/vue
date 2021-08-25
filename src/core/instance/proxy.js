/* not type checking this file because flow doesn't play well with Proxy */

import config from 'core/config'
import { warn, makeMap, isNative } from '../util/index'

// 初始化
let initProxy

if (process.env.NODE_ENV !== 'production') {
  // 判断给定的 key 是否出现在上面字符串中定义的关键字中的。这些关键字都是在 js 中可以全局访问的。
  const allowedGlobals = makeMap(
    'Infinity,undefined,NaN,isFinite,isNaN,' +
    'parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,' +
    'Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,BigInt,' +
    'require' // for Webpack/Browserify
  )

  // 警告信息提示“在渲染的时候引用了 key，但是在实例对象上并没有定义 key 这个属性或方法”
  const warnNonPresent = (target, key) => {
    warn(
      `Property or method "${key}" is not defined on the instance but ` +
      'referenced during render. Make sure that this property is reactive, ' +
      'either in the data option, or for class-based components, by ' +
      'initializing the property. ' +
      'See: https://vuejs.org/v2/guide/reactivity.html#Declaring-Reactive-Properties.',
      target
    )
  }

  const warnReservedPrefix = (target, key) => {
    warn(
      `Property "${key}" must be accessed with "$data.${key}" because ` +
      'properties starting with "$" or "_" are not proxied in the Vue instance to ' +
      'prevent conflicts with Vue internals. ' +
      'See: https://vuejs.org/v2/api/#data',
      target
    )
  }

  // 判断浏览器上支不支持Proxy
  const hasProxy =
    typeof Proxy !== 'undefined' && isNative(Proxy)

  // 如果支持Proxy
  if (hasProxy) {
    // isBuiltInModifier 函数用来检测是否是内置的修饰符
    const isBuiltInModifier = makeMap('stop,prevent,self,ctrl,shift,alt,meta,exact')
    // 为 config.keyCodes 设置 set 代理，防止内置修饰符被覆盖
    config.keyCodes = new Proxy(config.keyCodes, {
      set(target, key, value) {
        if (isBuiltInModifier(key)) {
          warn(`Avoid overwriting built-in modifier in config.keyCodes: .${key}`)
          return false
        } else {
          target[key] = value
          return true
        }
      }
    })
  }

  const hasHandler = {
    has(target, key) {
      // has 常量是真实经过 in 运算符得来的结果
      const has = key in target
      // 如果 key 在 allowedGlobals 之内（一些全局api如Math.isNaN等），或者 key 是以下划线 _ 开头的字符串，则为true
      const isAllowed = allowedGlobals(key) ||
        (typeof key === 'string' && key.charAt(0) === '_' && !(key in target.$data))

      // 如果 has 和 isAllowed 都为false，警告
      if (!has && !isAllowed) {
        // 如果key在$data中存在，警告
        if (key in target.$data) warnReservedPrefix(target, key)
        else warnNonPresent(target, key)
      }
      return has || !isAllowed
    }
  }

  //检测到访问的属性不存在就给你一个警告
  //只有当 render 函数的 _withStripped 为真的时候，才会给出警告
  // 但是 render._withStripped 又只有写测试的时候出现过
  // 也就是说需要我们手动设置其为 true 才会得到提示，否则是得不到的
  // 在使用 webpack 配合 vue-loader 的环境中，
  // vue-loader 会借助 vuejs@component-compiler-utils 将 template 编译为不使用 with 语句包裹的遵循严格模式的 JavaScript
  // 并为编译后的 render 方法设置 render._withStripped = true
  // 在不使用 with 语句的 render 方法中，模板内的变量都是通过属性访问操作 vm['a'] 或 vm.a 的形式访问的
  // Proxy 的 has 无法拦截属性访问操作，所以这里需要使用 Proxy 中可以拦截到属性访问的 get
  // 同时也省去了 has 中的全局变量检查(全局变量的访问不会被 get 拦截)。
  const getHandler = {
    get(target, key) {
      if (typeof key === 'string' && !(key in target)) {
        if (key in target.$data) warnReservedPrefix(target, key)
        else warnNonPresent(target, key)
      }
      return target[key]
    }
  }

  // 给initProxy赋值
  initProxy = function initProxy(vm) {
    // 如果支持原生Proxy vm._renderProxy = 用handlers对vm做了一个a代理
    // 否则直接赋值vm
    if (hasProxy) {
      // determine which proxy handler to use
      // 引用
      const options = vm.$options
      // handlers 可能是 getHandler 也可能是 hasHandler
      // options.render._withStripped通常为false，所以这里用hasHandler做代理的配置
      const handlers = options.render && options.render._withStripped
        ? getHandler
        : hasHandler
      // 
      vm._renderProxy = new Proxy(vm, handlers)
    } else {
      vm._renderProxy = vm
    }
  }
}

export { initProxy }
