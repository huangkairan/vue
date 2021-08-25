import Vue from './instance/index'
import { initGlobalAPI } from './global-api/index'
import { isServerRendering } from 'core/util/env'
import { FunctionalRenderContext } from 'core/vdom/create-functional-component'

// 将Vue作为参数传入，作用是在Vue原型上添加一些全局api
initGlobalAPI(Vue)

// 添加$isServer 
Object.defineProperty(Vue.prototype, '$isServer', {
  get: isServerRendering
})

// 添加$ssrContext 
Object.defineProperty(Vue.prototype, '$ssrContext', {
  get() {
    /* istanbul ignore next */
    return this.$vnode && this.$vnode.ssrContext
  }
})

// 添加$FunctionalRenderContext
// expose FunctionalRenderContext for ssr runtime helper installation
Object.defineProperty(Vue, 'FunctionalRenderContext', {
  value: FunctionalRenderContext
})

// 这个__VERSION__会在scripts/config.js中的genConfig方法中根据Vue的版本号动态定义
Vue.version = '__VERSION__'

export default Vue
