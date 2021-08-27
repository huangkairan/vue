/* @flow */

import config from 'core/config'
import { warn, cached } from 'core/util/index'
import { mark, measure } from 'core/util/perf'

import Vue from './runtime/index'
import { query } from './util/index'
import { compileToFunctions } from './compiler/index'
import { shouldDecodeNewlines, shouldDecodeNewlinesForHref } from './util/compat'

// 获取拥有传入id的元素的innerHTML
const idToTemplate = cached(id => {
  const el = query(id)
  return el && el.innerHTML
})

// 缓存Vue.prototype.$mount
const mount = Vue.prototype.$mount

// 重写Vue.prototype.$mount
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  // 查找挂载的dom元素
  el = el && query(el)

  /* istanbul ignore if */
  // 警告不能挂载document.body或html上，因为挂载的dom会被组件给替换掉
  if (el === document.body || el === document.documentElement) {
    process.env.NODE_ENV !== 'production' && warn(
      `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
    )
    return this
  }

  // 缓存$optinos
  const options = this.$options
  // resolve template/el and convert to render function
  // 如果render函数存在，则什么都不会做；否则根据template 或 el 选项构建渲染函数
  if (!options.render) {
    // 获取template
    let template = options.template
    // 获取合适的内容作为模板
    if (template) {
      //template是字符串，以#开头，去找对应的dom，取其innerHtml
      if (typeof template === 'string') {
        if (template.charAt(0) === '#') {
          template = idToTemplate(template)
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== 'production' && !template) {
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            )
          }
        }
        // template的nodeType存在，用template的innerHtml
      } else if (template.nodeType) {
        template = template.innerHTML
      } else {
        // 既不是字符串也不是node节点，警告
        if (process.env.NODE_ENV !== 'production') {
          warn('invalid template option:' + template, this)
        }
        return this
      }
      // template不存在，使用el的outerHtml
    } else if (el) {
      template = getOuterHTML(el)
    }
    // template被处理成模版字符串，也有空的可能；如果存在，执行compileToFunctions，将字符串编译成render函数
    if (template) {
      /* istanbul ignore if */
      // 计算性能
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile')
      }

      const { render, staticRenderFns } = compileToFunctions(template, {
        outputSourceRange: process.env.NODE_ENV !== 'production',
        shouldDecodeNewlines,
        shouldDecodeNewlinesForHref,
        delimiters: options.delimiters,
        comments: options.comments
      }, this)
      // 将render函数添加到options上
      options.render = render
      options.staticRenderFns = staticRenderFns

      /* istanbul ignore if */
      // 计算性能
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile end')
        measure(`vue ${this._name} compile`, 'compile', 'compile end')
      }
    }
  }
  return mount.call(this, el, hydrating)
}

/**
 * Get outerHTML of elements, taking care
 * of SVG elements in IE as well.
 */
// 获取元素的outerHTML
function getOuterHTML(el: Element): string {
  if (el.outerHTML) {
    return el.outerHTML
  } else {
    const container = document.createElement('div')
    container.appendChild(el.cloneNode(true))
    return container.innerHTML
  }
}

// 在Vue上添加compile 其值为上面导入进来的 compileToFunctions
Vue.compile = compileToFunctions

export default Vue
