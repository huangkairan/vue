/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

// 缓存传入的genStaticKeys（如果有的话）
const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
export function optimize(root: ?ASTElement, options: CompilerOptions) {
  // 如果没传root，结束
  if (!root) return
  //这里的staticKeys时根据编译器选项的 modules 选项生成一个静态键字符串，包括了klass,style,model。进行缓存
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  markStatic(root)
  // second pass: mark static roots.
  markStaticRoots(root, false)
}

function genStaticKeys(keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
    (keys ? ',' + keys : '')
  )
}

// 标记静态节点
function markStatic(node: ASTNode) {
  // 判断是否是静态节点
  node.static = isStatic(node)
  // 如果这个节点是一个普通元素
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 遍历它的所有 children，递归执行 markStatic。
    // 因为所有的 elseif 和 else 节点都不在 children 中，
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      if (!child.static) {
        node.static = false
      }
    }
    // 如果节点的 ifConditions 不为空，则遍历 ifConditions 拿到所有条件中的 block
    // 也就是它们对应的 AST 节点，递归执行 markStatic。在这些递归过程中，一旦子节点有不是 static 的情况，则它的父节点的 static 均变成 false。
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block
        markStatic(block)
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

function markStaticRoots(node: ASTNode, isInFor: boolean) {
  // 如果是普通节点
  if (node.type === 1) {
    // 对于已经是静态的，或是v-once的节点，staticInfor的值为传入的isInfor的值
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // 要被标记成静态根节点，除了自己本身要是根节点，还必须有children，并且children本身不能是文本节点， 不然标记成静态根节点意义就不大了
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    // 接下来和标记静态节点的逻辑一样，遍历 children 以及 ifConditions，递归执行 markStaticRoots。
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

// 判断是否是静态节点
function isStatic(node: ASTNode): boolean {
  // 如果是表达式，则不是静态节点
  if (node.type === 2) { // expression
    return false
  }
  // 如果是文本，静态
  if (node.type === 3) { // text
    return true
  }
  //对于一个普通元素，如果有 pre 属性，那么它使用了 v-pre 指令，是静态
  //否则要同时满足以下条件：没有使用 v-if、v-for，
  //没有使用其它指令（不包括 v-once），非内置组件，是平台保留的标签，
  // 非带有 v-for 的 template 标签的直接子节点，节点的所有属性的 key 都满足静态 key；这些都满足则这个 AST 节点是一个静态节点。
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in
    isPlatformReservedTag(node.tag) && // not a component
    !isDirectChildOfTemplateFor(node) &&
    Object.keys(node).every(isStaticKey)
  ))
}

function isDirectChildOfTemplateFor(node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
