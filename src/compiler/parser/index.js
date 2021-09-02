/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'

// 匹配以字符 @ 或 v-on: 开头的字符串
export const onRE = /^@|^v-on:/
// 匹配以字符 v- 或 @ 或 : 开头的字符串
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/
// 匹配 v-for 属性的值，并捕获 in 或 of 前后的字符串
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
// 匹配 forAliasRE 第一个捕获组所捕获到的字符串
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
// 捕获要么以字符 ( 开头，要么以字符 ) 结尾的字符串，或者两者都满足
const stripParensRE = /^\(|\)$/g
// 匹配.*
const dynamicArgRE = /^\[.*\]$/
// 匹配指令中的参数
const argRE = /:(.*)$/
//匹配以字符 : 或字符串 v-bind: 开头的字符串 
export const bindRE = /^:|^\.|^v-bind:/
// 匹配以.开头的字符串
const propBindRE = /^\./
// 匹配修饰符
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g

// 匹配以v-slot开头的字符串
const slotRE = /^v-slot(:|$)|^#/
// 匹配换行符
const lineBreakRE = /[\r\n]/
// 匹配空格
const whitespaceRE = /[ \f\t\r\n]+/g

// 匹配不应该出现的属性
const invalidAttributeRE = /[\s"'<>\/=]/

const decodeHTMLCached = cached(he.decode)

export const emptySlotScopeToken = `_empty_`

// configurable state
// 初始化平台化的变量
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace
let maybeComponent

// 创建一个元素的描述对象
export function createASTElement(
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    rawAttrsMap: {},
    parent,
    children: []
  }
}

/**
 * Convert HTML string to AST.
 */
export function parse(
  template: string,
  options: CompilerOptions
): ASTElement | void {
  // 用于打印警告信息
  warn = options.warn || baseWarn
  // 根据options里的传参赋值
  //通过给定的标签名字判断该标签是否是 pre 标签
  platformIsPreTag = options.isPreTag || no
  // 检测一个属性在标签中是否要使用元素对象原生的 prop 进行绑定
  platformMustUseProp = options.mustUseProp || no
  // 获取元素(标签)的命名空间
  platformGetTagNamespace = options.getTagNamespace || no
  const isReservedTag = options.isReservedTag || no
  maybeComponent = (el: ASTElement) => !!(
    el.component ||
    el.attrsMap[':is'] ||
    el.attrsMap['v-bind:is'] ||
    !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
  )
  // pluckModuleFunction的作用：从第一个参数中取出函数名字与第二个参数所指定字符串相同的函数，并将它们组成一个数组
  // 拿出transformNode，组成新数组
  transforms = pluckModuleFunction(options.modules, 'transformNode')
  // 拿出preTransformNode，组成新数组
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  // 拿出postTransformNode，组成新数组。这里执行完后会是空数组
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')

  //数组
  delimiters = options.delimiters

  // 保存回退的currentParent，用来修正当前正在解析元素的父级
  const stack = []
  // 编译 html 字符串时是否放弃标签之间的空格
  const preserveWhitespace = options.preserveWhitespace !== false
  const whitespaceOption = options.whitespace
  // 最终要返回的AST
  let root
  // 每遇到一个非一元标签，都会将该标签的描述对象作为 currentParent 的值
  let currentParent
  let inVPre = false
  let inPre = false
  let warned = false

  // 只会打印一次警告信息
  function warnOnce(msg, range) {
    if (!warned) {
      warned = true
      warn(msg, range)
    }
  }


  //每当遇到一个标签的结束标签时，或遇到一元标签时都会调用该方法“闭合”标签
  function closeElement(element) {
    trimEndingWhitespace(element)
    if (!inVPre && !element.processed) {
      element = processElement(element, options)
    }
    // tree management
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(element)
        }
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    if (currentParent && !element.forbidden) {
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent)
      } else {
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"'
            ; (currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        currentParent.children.push(element)
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    trimEndingWhitespace(element)

    // check pre state
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  function trimEndingWhitespace(el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === ' '
      ) {
        el.children.pop()
      }
    }
  }

  //检测模板根元素是否符合要求。 跟元素不能为slot和template（必须有且仅有一个根元素），不能有v-for属性
  function checkRootConstraints(el) {
    if (el.tag === 'slot' || el.tag === 'template') {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    //start 钩子函数，在解析 html 字符串时每次遇到 开始标签 时就会调用该函数
    start(tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      // 获取标签的命名空间。
      //首先检测 currentParent 是否存在，currentParent为当前元素的父级元素描述对象，
      // 如果当前元素存在父级并且父级元素存在命名空间，则使用父级的命名空间作为当前元素的命名空间。
      // 如果父级元素不存在或父级元素没有命名空间，那么会通过调用 platformGetTagNamespace(tag) 函数获取当前元素的命名空间
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      // 解决ie bug： 渲染svg多余的属性
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 为当前元素创建了描述对象
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      // 检查当前元素是否存在命名空间 ns，如果存在则在元素对象上添加 ns 属性，其值为命名空间的值
      if (ns) {
        element.ns = ns
      }

      if (process.env.NODE_ENV !== 'production') {
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        attrs.forEach(attr => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length
              }
            )
          }
        })
      }

      //判断非服务端渲染情况下，当前元素是否是禁止在模板中使用的标签
      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms，每个元素都是函数
      // 遍历 preTransforms 数组。调用每个函数，并将元素和option传入
      // 这些函数的作用与我们之前见到过的 process* 系列的函数没什么区别，都是用来对当前元素描述对象做进一步处理
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      // 对当前元素描述对象做额外的处理，使得该元素描述对象能更好的描述一个标签。简单点说就是在元素描述对象上添加各种各样的具有标识作用的属性
      if (!inVPre) {
        // 除了获取给定属性的值之外，还会将该属性从 attrsList 数组中移除，并可以选择性地将该属性从 attrsMap 对象中移除
        // 这时会将 inVPre 变量的值也设置为 true。当 inVPre 变量为真时，意味着 后续的所有解析工作都处于 v-pre 环境下，编译器会跳过拥有 v-pre 指令元素以及其子元素的编译过程，所以后续的编译逻辑需要 inVPre 变量作为标识才行
        processPre(element)
        if (element.pre) {
          inVPre = true
        }
      }
      //platformIsPreTag 函数判断当前元素是否是 <pre> 标签
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }
      if (inVPre) {
        //将该元素所有属性全部作为原生的属性(attr)处理
        processRawAttrs(element)
      } else if (!element.processed) {
        // structural directives
        // 处理v-for
        processFor(element)
        //处理v-if
        processIf(element)
        // 处理v-once
        processOnce(element)
      }
      // 如果root为空，则是根节点，直接赋值
      if (!root) {
        root = element
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(root)
        }
      }

      // 
      if (!unary) {
        currentParent = element
        stack.push(element)
      } else {
        closeElement(element)
      }
    },

    //end 钩子函数，在解析 html 字符串时每次遇到 结束标签 时就会调用该函数
    end(tag, start, end) {
      const element = stack[stack.length - 1]
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      closeElement(element)
    },

    //chars 钩子函数，在解析 html 字符串时每次遇到 纯文本 时就会调用该函数
    chars(text: string, start: number, end: number) {
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`,
              { start }
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      if (inPre || text.trim()) {
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      } else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        text = ''
      } else if (whitespaceOption) {
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          text = ' '
        }
      } else {
        text = preserveWhitespace ? ' ' : ''
      }
      if (text) {
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ?ASTNode
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          child = {
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          child = {
            type: 3,
            text
          }
        }
        if (child) {
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          children.push(child)
        }
      }
    },
    //comment 钩子函数，在解析 html 字符串时每次遇到 注释节点 时就会调用该函数
    comment(text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        currentParent.children.push(child)
      }
    }
  })
  return root
}
function processPre(el) {
  // 获获取给定元素 v-pre 属性的值，如果 v-pre 属性的值不等于 null 则会在元素描述对象上添加 .pre 属性，并将其值设置为 true
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

function processRawAttrs(el) {
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = el.attrs = new Array(len)
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

//其他一系列 process* 函数的集合
export function processElement(
  element: ASTElement,
  options: CompilerOptions
) {
  // 处理key
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  // 只有当标签没有使用 key 属性，没用使用slot属性，并且标签只使用了结构化指令的情况下才被认为是“纯”的
  element.plain = (
    !element.key &&
    !element.scopedSlots &&
    !element.attrsList.length
  )

  // 处理ref
  processRef(element)
  // 处理插槽
  processSlotContent(element)
  processSlotOutlet(element)
  // 处理is和inline-template
  processComponent(element)
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  // 走到这时，上面处理过的属性如v-if for, slot...等等都已经从attrList中移除了。
  // 但可能元素上还存在其他的属性，这时处理
  processAttrs(element)
  return element
}

//  1、key 属性不能被应用到 <template> 标签。
//  2、使用了 key 属性的标签，其元素描述对象的 el.key 属性保存着 key 属性的值。
//  3、不要使用v-for的index作key。在transition-group内
function processKey(el) {
  // 从el中获取绑定的key属性
  const exp = getBindingAttr(el, 'key')
  // 如果存在，设置元素的key属性。
  // 此外，通过警告可以得知，1. template元素不能设置key，因为template会被转换
  // 2. 不要使用v-for的index作key。在transition-group内
  if (exp) {
    if (process.env.NODE_ENV !== 'production') {
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (iterator && iterator === exp && parent && parent.tag === 'transition-group') {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    el.key = exp
  }
}

//如果一个标签使用了 ref 属性，则：
//1、该标签的元素描述对象会被添加 el.ref 属性，该属性为解析后生成的表达式字符串，与 el.key 类似。
//2、该标签的元素描述对象会被添加 el.refInFor 属性，它是一个布尔值，用来标识当前元素的 ref 属性是否在 v-for 指令之内使用。
function processRef(el) {
  // 获取绑定元素ref，如果存在则在属性上赋值
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    // 如果在v-for指令包围内，则添加refInFor属性 = true 否则false
    el.refInFor = checkInFor(el)
  }
}

export function processFor(el: ASTElement) {
  let exp
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    if (res) {
      //如果 parseFor 函数对 v-for 指令的值解析成功，则会将解析结果保存在 res 常量中，并使用 extend 函数将 res 常量中的属性混入当前元素的描述对象中
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

// 1、如果 v-for 指令的值为字符串 'obj in list'，则 parseFor 函数的返回值为：
// {
//   for: 'list',
//   alias: 'obj'
// }
// 2、如果 v-for 指令的值为字符串 '(obj, index) in list'，则 parseFor 函数的返回值为：
// {
//   for: 'list',
//   alias: 'obj',
//   iterator1: 'index'
// }
// 3、如果 v-for 指令的值为字符串 '(obj, key, index) in list'，则 parseFor 函数的返回值为：
// {
//   for: 'list',
//   alias: 'obj',
//   iterator1: 'key',
//   iterator2: 'index'
// }
export function parseFor(exp: string): ?ForParseResult {
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  res.for = inMatch[2].trim()
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '').trim()
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}

//  1、如果标签使用了 v-if 指令，则该标签的元素描述对象的 el.if 属性存储着 v-if 指令的属性值
//  2、如果标签使用了 v-else 指令，则该标签的元素描述对象的 el.else 属性值为 true
//  3、如果标签使用了 v-else-if 指令，则该标签的元素描述对象的 el.elseif 属性存储着 v-else-if 指令的属性值
//  4、如果标签使用了 v-if 指令，则该标签的元素描述对象的 ifConditions 数组中包含“自己”
//  5、如果标签使用了 v-else 或 v-else-if 指令，则该标签的元素描述对象会被添加到与之相符的带有 v-if 指令的元素描述对象的 ifConditions 数组中。
function processIf(el) {
  const exp = getAndRemoveAttr(el, 'v-if')
  // 当一个元素使用了 v-else-if 或 v-else 指令时，它们是不会作为父级元素子节点的
  // 只要v-if的值没传，就当作没这个属性。不然这个元素永远都被不会渲染
  // 如果获取到了v-if,把自身作为一个 条件对象 添加到自身元素描述对象的 ifConditions 数组中
  if (exp) {
    el.if = exp
    addIfCondition(el, {
      exp: exp,
      block: el
    })
    // 如果没有获取到v-if，则尝试获取v-else
    // 如果获取到了，为该元素添加else 属性
  } else {
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    // 获取v-else-if，添加elseif属性
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

function processIfConditions(el, parent) {
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}

// 找到父级元素描述对象的最后一个元素节点
function findPrevElement(children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      children.pop()
    }
  }
}

export function addIfCondition(el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}

function processOnce(el) {
  // 获取v-once，如果有，添加once属性
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
//1、对于 <slot> 标签，会为其元素描述对象添加 el.slotName 属性，属性值为该标签 name 属性的值，并且 name 属性可以是绑定的。
//2、对于 <template> 标签，会优先获取并使用该标签 scope 属性的值，如果获取不到则会获取 slot-scope 属性的值，并将获取到的值赋值给元素描述对象的 el.slotScope 属性，注意 scope 属性和 slot-scope 属性不能是绑定的。
//3、对于其他标签，会尝试获取 slot-scope 属性的值，并将获取到的值赋值给元素描述对象的 el.slotScope 属性。
//4、对于非 <slot> 标签，会尝试获取该标签的 slot 属性，并将获取到的值赋值给元素描述对象的 el.slotTarget 属性。如果一个标签使用了 slot 属性但却没有给定相应的值，则该标签元素描述对象的 el.slotTarget 属性值为字符串 '"default"'。
function processSlotContent(el) {
  let slotScope
  // 如果是template，则会给template的slotScope属性赋值，值为scope或slot-scope的值
  if (el.tag === 'template') {
    slotScope = getAndRemoveAttr(el, 'scope')
    /* istanbul ignore if */
    //由警告可知，v2.5以后 scope属性被移除，要是用slot-scope属性。因为后者不受限于template标签
    if (process.env.NODE_ENV !== 'production' && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    // 并且scope和slot-scope属性不能是绑定属性
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    /* istanbul ignore if */
    // 警告得知，当slot-scope和V-for一起使用时，v-for的作用域会是父级的，因为v-for优先级更高。
    // 建议在外层使用template + slotscope
    if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    // 使用了slotScope，则添加属性
    el.slotScope = slotScope
  }

  // slot="xxx"
  // 处理标签的slot内容
  const slotTarget = getBindingAttr(el, 'slot')
  if (slotTarget) {
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    el.slotTargetDynamic = !!(el.attrsMap[':slot'] || el.attrsMap['v-bind:slot'])
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    if (el.tag !== 'template' && !el.slotScope) {
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === 'template') {
      // v-slot on <template>
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (el.slotTarget || el.slotScope) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        const { name, dynamic } = getSlotName(slotBinding)
        el.slotTarget = name
        el.slotTargetDynamic = dynamic
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf
      }
    } else {
      // v-slot on component, denotes default slot
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          if (el.slotScope || el.slotTarget) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        const slots = el.scopedSlots || (el.scopedSlots = {})
        const { name, dynamic } = getSlotName(slotBinding)
        const slotContainer = slots[name] = createASTElement('template', [], el)
        slotContainer.slotTarget = name
        slotContainer.slotTargetDynamic = dynamic
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        el.children = []
        // mark el non-plain so data gets generated
        el.plain = false
      }
    }
  }
}

function getSlotName(binding) {
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
  return dynamicArgRE.test(name)
    // dynamic [name]
    ? { name: name.slice(1, -1), dynamic: true }
    // static name
    : { name: `"${name}"`, dynamic: false }
}

// handle <slot/> outlets
function processSlotOutlet(el) {
  // 如果元素的标签是slot，则获取slot的name
  if (el.tag === 'slot') {
    el.slotName = getBindingAttr(el, 'name')
    //由警告可只，插槽不能给key属性，因为slot和template一样，都是抽象组件，要么不渲染真实DOM，要么会被别的DOM替代
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

function processComponent(el) {
  let binding
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

function processAttrs(el) {
  const list = el.attrsList
  // 属性名，属性值，
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  // 依旧是一样的思路，遍历取值解析
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    // 判断是不是指令
    if (dirRE.test(name)) {
      // mark element as dynamic
      // 标记是动态
      el.hasBindings = true
      // 保存将指令删除后的 （如v-..@..:..）的name
      // modifiers 匹配修饰符，解析，处理完后是个对象{sync:true}或undefined
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      // 匹配以.开头的语法（没懂干啥的）
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      // 匹配v-bind，处理
      //1、任何绑定的属性，最终要么会被添加到元素描述对象的 el.attrs 数组中，要么就被添加到元素描述对象的 el.props 数组中。
      //2、对于使用了 .sync 修饰符的绑定属性，还会在元素描述对象的 el.events 对象中添加名字为 'update:${驼峰化的属性名}' 的事件。
      if (bindRE.test(name)) { // v-bind
        // 将name中的指令删除
        name = name.replace(bindRE, '')
        // 用filter处理value
        value = parseFilters(value)
        // 判断是否是动态
        isDynamic = dynamicArgRE.test(name)
        // 动态则把.或*删除
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        // 非生产的判空警告
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        // 如果有值（是个对象）说明有修饰符，则处理
        if (modifiers) {
          // 如果有prop属性，说明是dom属性
          if (modifiers.prop && !isDynamic) {
            name = camelize(name)
            // innerHTML特殊处理
            if (name === 'innerHtml') name = 'innerHTML'
          }
          // 驼峰处理
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          // 处理sync修饰符语法糖
          if (modifiers.sync) {
            // :some-prop.sync <==等价于==> :some-prop + @update:someProp

            // 事件发生的回调
            syncGen = genAssignmentCode(value, `$event`)
            if (!isDynamic) {
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              )
            }
          }
        }
        // 如果是原生的prop，添加
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          // 处理的是原生DOM的prop。el.prop保存的是原生DOM的数组。
          addProp(el, name, value, list[i], isDynamic)
        } else {
          // 添加到el.attrs数组中
          addAttr(el, name, value, list[i], isDynamic)
        }

        // 处理v-on
      } else if (onRE.test(name)) { // v-on
        // 首先将@或v-on删除
        name = name.replace(onRE, '')
        // 然后判断是否是动态属性
        isDynamic = dynamicArgRE.test(name)
        // 如果是，将.删除
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
        // 处理其他属性
      } else { // normal directives
        // 首先去除掉v-..：..@.. 重新赋值name，为属性名
        name = name.replace(dirRE, '')
        // parse arg
        //使用 argRE 正则匹配变量 name，并将匹配结果保存在 argMatch 常量中
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        // 如果arg存在 将参数字符串从 name 字符串中移除掉
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        // 添加指令到el.directives
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        //如果指令的名字为 model，则会调用 checkForAliasModel 函数，并将元素描述对象和 v-model 属性值作为参数传递
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
      // 处理非指令
    } else {
      // literal attribute
      if (process.env.NODE_ENV !== 'production') {

        // 非指令还使用动态的字面量表达式，警告，建议变成动态属性
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      // 将value处理成字符串，加入el.attrs数组中
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      // 修复火狐数据不响应的问题
      if (!el.component &&
        name === 'muted' &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

// 判断是否在v-for指令包围内
function checkInFor(el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function parseModifiers(name: string): Object | void {
  const match = name.match(modifierRE)
  // 处理，如：.sync 处理后会变成{sync: true}，.stop处理后会变成{stop: true}
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

// 将标签的属性数组转换成名值对一一对应的对象
function makeAttrsMap(attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag(el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

// style，script标签不被允许。除了script type='text/javascript'
function isForbiddenTag(el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug(attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

// 从使用了 v-model 指令的标签开始，逐层向上遍历父级标签的元素描述对象，直到根元素为止。
// 并且在遍历的过程中一旦发现这些标签的元素描述对象中存在满足条件：_el.for && _el.alias === value 的情况
// 就会打印警告信息

// 如 在v-for中 直接v-model绑定每个item，此时v-model的行为失效。
// 如果想要这种实现，可以v-model 绑定每个对象中元素 v-for="obj in arr" v-model="obj.name"
function checkForAliasModel(el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
