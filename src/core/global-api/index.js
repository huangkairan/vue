/* @flow */

import config from '../config'
import { initUse } from './use'
import { initMixin } from './mixin'
import { initExtend } from './extend'
import { initAssetRegisters } from './assets'
import { set, del } from '../observer/index'
import { ASSET_TYPES } from 'shared/constants'
import builtInComponents from '../components/index'
import { observe } from 'core/observer/index'

import {
  warn,
  extend,
  nextTick,
  mergeOptions,
  defineReactive
} from '../util/index'

// 在Vue原型添加一些全局api：config，util，set，delete，nextTick，options，observable
export function initGlobalAPI(Vue: GlobalAPI) {
  // config，也是只读属性，代理了core/config.js中的导出成员
  const configDef = {}
  configDef.get = () => config
  if (process.env.NODE_ENV !== 'production') {
    configDef.set = () => {
      warn(
        'Do not replace the Vue.config object, set individual fields instead.'
      )
    }
  }
  Object.defineProperty(Vue, 'config', configDef)

  // exposed util methods.
  // NOTE: these are not considered part of the public API - avoid relying on
  // them unless you are aware of the risk.

  // Vue官网没介绍这些api，Vue也不建议使用
  Vue.util = {
    warn,
    extend,
    mergeOptions,
    defineReactive
  }

  Vue.set = set
  Vue.delete = del
  Vue.nextTick = nextTick

  // 2.6 explicit observable API
  Vue.observable = <T>(obj: T): T => {
    observe(obj)
    return obj
  }

    Vue.options = Object.create(null)
  // ASSET_TYPES 来自shared/constants.js 是一个数组，值为'component','directive','filter'
  ASSET_TYPES.forEach(type => {
      Vue.options[type + 's'] = Object.create(null)
    })

    // this is used to identify the "base" constructor to extend all plain-object
    // components with in Weex's multi-instance scenarios.
    Vue.options._base = Vue
    // 将 builtInComponents 的属性混合到 Vue.options.components 中，其中 builtInComponents 来自于 core/components/index.js 文件，该文件导出了KeepAlive
    extend(Vue.options.components, builtInComponents)

    // 调用了4个init方法
    // 在Vue上添加use方法，用来注册插件
    initUse(Vue)
    // 在Vue上添加mixin api
    initMixin(Vue)
    // 在Vue上添加cid属性，extend方法
    initExtend(Vue)
    // 遍历ASSET_TYPE，在Vue上添加component,directive,filter方法
    initAssetRegisters(Vue)
}
