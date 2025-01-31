/* @flow */

import VNode, { createTextVNode } from 'core/vdom/vnode'
import { isFalse, isTrue, isDef, isUndef, isPrimitive } from 'shared/util'

// The template compiler attempts to minimize the need for normalization by
// statically analyzing the template at compile time.
//
// For plain HTML markup, normalization can be completely skipped because the
// generated render function is guaranteed to return Array<VNode>. There are
// two cases where extra normalization is needed:

// 1. When the children contains components - because a functional component
// may return an Array instead of a single root. In this case, just a simple
// normalization is needed - if any child is an Array, we flatten the whole
// thing with Array.prototype.concat. It is guaranteed to be only 1-level deep
// because functional components already normalize their own children.
// 调用场景：render函数为编译生成的，
export function simpleNormalizeChildren (children: any) {
  for (let i = 0; i < children.length; i++) {
    // 如果是array，说明是funtion component，返回的是数组，用concat扁平成一层。
    if (Array.isArray(children[i])) {
      return Array.prototype.concat.apply([], children)
    }
  }
  return children
}

// 2. When the children contains constructs that always generated nested Arrays,
// e.g. <template>, <slot>, v-for, or when the children is provided by user
// with hand-written render functions / JSX. In such cases a full normalization
// is needed to cater to all possible types of children values.
// 调用场景：render函数为用户手写的；或编译slot、v-for时有嵌套数组存在时
export function normalizeChildren (children: any): ?Array<VNode> {
  // 如果是原始类型，当成文本处理，放到数组中
  return isPrimitive(children)
    ? [createTextVNode(children)]
    // 如果是array，则是编译slot或v-for时的情况，出现了潜逃数组，调用normalizeArrayChildren
    : Array.isArray(children)
      ? normalizeArrayChildren(children)
      : undefined
}

function isTextNode (node): boolean {
  return isDef(node) && isDef(node.text) && isFalse(node.isComment)
}

// 经过处理后，children变成了一个VNode类型的数组
function normalizeArrayChildren (children: any, nestedIndex?: string): Array<VNode> {
  const res = []
  let i, c, lastIndex, last
  // 遍历children
  for (i = 0; i < children.length; i++) {
    // 获取节点 c
    c = children[i]
    // 对c的类型判断
    if (isUndef(c) || typeof c === 'boolean') continue
    lastIndex = res.length - 1
    last = res[lastIndex]
    //  nested

    // 如果是数组，递归调用normalizeArrayChildren
    if (Array.isArray(c)) {
      if (c.length > 0) {
        c = normalizeArrayChildren(c, `${nestedIndex || ''}_${i}`)
        // merge adjacent text nodes
        // 对文本节点的优化，如果是连着的文本节点，会被合并成一个
        if (isTextNode(c[0]) && isTextNode(last)) {
          res[lastIndex] = createTextVNode(last.text + (c[0]: any).text)
          c.shift()
        }
        res.push.apply(res, c)
      }
      // 如果是基础类型，通过createTextVNode创建成文本类型VNode
    } else if (isPrimitive(c)) {
      // 文本节点的优化
      if (isTextNode(last)) {
        // merge adjacent text nodes
        // this is necessary for SSR hydration because text nodes are
        // essentially merged when rendered to HTML strings
        res[lastIndex] = createTextVNode(last.text + c)
      } else if (c !== '') {
        // convert primitive to vnode
        res.push(createTextVNode(c))
      }

      // 否则已经是VNode了
    } else {
      // 连续的文本类型，优化
      if (isTextNode(c) && isTextNode(last)) {
        // merge adjacent text nodes
        res[lastIndex] = createTextVNode(last.text + c.text)
      } else {
        // default key for nested array children (likely generated by v-for)
        // 如果children是列表的情况，根据nestedIndex更新key
        if (isTrue(children._isVList) &&
          isDef(c.tag) &&
          isUndef(c.key) &&
          isDef(nestedIndex)) {
          c.key = `__vlist${nestedIndex}_${i}__`
        }
        res.push(c)
      }
    }
  }
  return res
}
