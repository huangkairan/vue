/* @flow */

import { emptyObject } from 'shared/util'
import { parseFilters } from './parser/filter-parser'

type Range = { start?: number, end?: number };

/* eslint-disable no-unused-vars */
export function baseWarn(msg: string, range?: Range) {
  console.error(`[Vue compiler]: ${msg}`)
}
/* eslint-enable no-unused-vars */

// 从第一个参数中取出函数名字与第二个参数所指定字符串相同的函数，并将它们组成一个数组
export function pluckModuleFunction<F: Function>(
  modules: ?Array<Object>,
  key: string
): Array<F> {
  return modules
    // map 生成新数组 filter 过滤掉undefined
    ? modules.map(m => m[key]).filter(_ => _)
    : []
}

// 处理的是原生DOM上的prop。 el.prop 数组
export function addProp(el: ASTElement, name: string, value: string, range?: Range, dynamic?: boolean) {
  (el.props || (el.props = [])).push(rangeSetItem({ name, value, dynamic }, range))
  el.plain = false
}

export function addAttr(el: ASTElement, name: string, value: any, range?: Range, dynamic?: boolean) {
  const attrs = dynamic
    ? (el.dynamicAttrs || (el.dynamicAttrs = []))
    : (el.attrs || (el.attrs = []))
  attrs.push(rangeSetItem({ name, value, dynamic }, range))
  el.plain = false
}

// add a raw attr (use this in preTransforms)
export function addRawAttr(el: ASTElement, name: string, value: any, range?: Range) {
  el.attrsMap[name] = value
  el.attrsList.push(rangeSetItem({ name, value }, range))
}

export function addDirective(
  el: ASTElement,
  name: string,
  rawName: string,
  value: string,
  arg: ?string,
  isDynamicArg: boolean,
  modifiers: ?ASTModifiers,
  range?: Range
) {
  (el.directives || (el.directives = [])).push(rangeSetItem({
    name,
    rawName,
    value,
    arg,
    isDynamicArg,
    modifiers
  }, range))
  el.plain = false
}

function prependModifierMarker(symbol: string, name: string, dynamic?: boolean): string {
  return dynamic
    ? `_p(${name},"${symbol}")`
    : symbol + name // mark the event as captured
}

//el：当前元素描述对象
//name： 绑定属性的名字，即事件名称
//value：绑定属性的值，这个值有可能是事件回调函数名字，有可能是内联语句，有可能是函数表达式
//modifiers：指令对象
//important：可选参数，是一个布尔值，代表着添加的事件侦听函数的重要级别，如果为 true，则该侦听函数会被添加到该事件侦听函数数组的头部，否则会将其添加到尾部，
//warn：打印警告信息的函数，是一个可选参数
//dynamic：是否是动态
export function addHandler(
  el: ASTElement,
  name: string,
  value: string,
  modifiers: ?ASTModifiers,
  important?: boolean,
  warn?: ?Function,
  range?: Range,
  dynamic?: boolean
) {
  modifiers = modifiers || emptyObject
  // warn prevent and passive modifier
  /* istanbul ignore if */
  // 同时使用prevent和passive 警告
  if (
    process.env.NODE_ENV !== 'production' && warn &&
    modifiers.prevent && modifiers.passive
  ) {
    warn(
      'passive and prevent can\'t be used together. ' +
      'Passive handler can\'t prevent default event.',
      range
    )
  }

  // normalize click.right and click.middle since they don't actually fire
  // this is technically browser-specific, but at least for now browsers are
  // the only target envs that have right/middle clicks.
  // 解决.right和.middle不触发的行为 规范化“右击”事件和点击鼠标中间按钮的事件
  if (modifiers.right) {
    if (dynamic) {
      name = `(${name})==='click'?'contextmenu':(${name})`
    } else if (name === 'click') {
      name = 'contextmenu'
      delete modifiers.right
    }
  } else if (modifiers.middle) {
    if (dynamic) {
      name = `(${name})==='click'?'mouseup':(${name})`
    } else if (name === 'click') {
      name = 'mouseup'
    }
  }

  // check capture modifier
  if (modifiers.capture) {
    // 将capture属性移除，再将name前加一个！
    delete modifiers.capture
    name = prependModifierMarker('!', name, dynamic)
  }
  if (modifiers.once) {
    // 将once属性移除，再将name前加一个～
    delete modifiers.once
    name = prependModifierMarker('~', name, dynamic)
  }
  /* istanbul ignore if */
  if (modifiers.passive) {
    // 将passive属性移除，再将name前加一个&
    delete modifiers.passive
    name = prependModifierMarker('&', name, dynamic)
  }

  let events
  // 处理.native，标识原生事件
  if (modifiers.native) {
    // 删除修饰符并引用el.nativeEvents
    delete modifiers.native
    events = el.nativeEvents || (el.nativeEvents = {})
  } else {
    // 引用el.events
    events = el.events || (el.events = {})
  }

  // 新的handler
  const newHandler: any = rangeSetItem({ value: value.trim(), dynamic }, range)
  // 判断条件检测了修饰符对象 modifiers 是否不等于 emptyObject，
  // 当一个事件没有使用任何修饰符时，修饰符对象 modifiers 会被初始化为 emptyObject
  // 所以如果修饰符对象 modifiers 不等于 emptyObject 则说明事件使用了修饰符
  // 此时会把修饰符对象赋值给 newHandler.modifiers 属性
  if (modifiers !== emptyObject) {
    newHandler.modifiers = modifiers
  }

  // 第一次调用时无论events是el.events的引用还是el.nativeEvents的引用，都将为undefined
  const handlers = events[name]
  /* istanbul ignore if */

  // <div @click.prevent="handleClick1" @click="handleClick2" @click.self="handleClick3">
  // 这种情况，依次处理保证顺序不错乱
  if (Array.isArray(handlers)) {
    important ? handlers.unshift(newHandler) : handlers.push(newHandler)
    // <div @click.prevent="handleClick1" @click="handleClick2"></div>
    // 当第二次处理click时，已经有第一次处理的
    //el.events = {
    //click: {
    //  value: 'handleClick1',
    //  modifiers: { prevent: true }
    //}
    //
    // 所以此时会走elseif，处理完后：
    // el.events = {
    //   click: [
    //     {
    //       value: 'handleClick1',
    //       modifiers: { prevent: true }
    //     },
    //     {
    //       value: 'handleClick2'
    //     }
    //   ]
    // }
  } else if (handlers) {
    events[name] = important ? [newHandler, handlers] : [handlers, newHandler]
  } else {
    // 第一次调用走else
    // <div @click.once="handleClick"></div>
    // 处理后：
    //el.events = {
    //'~click': {
    //  value: 'handleClick',
    //  modifiers: {}
    //}
  }
  events[name] = newHandler
}
//如果一个标签存在事件侦听，无论如何都不会认为这个元素是“纯”的，所以这里直接将 el.plain 设置为 false
el.plain = false
}

export function getRawBindingAttr(
  el: ASTElement,
  name: string
) {
  return el.rawAttrsMap[':' + name] ||
    el.rawAttrsMap['v-bind:' + name] ||
    el.rawAttrsMap[name]
}


// 获取绑定的属性值
export function getBindingAttr(
  el: ASTElement,
  name: string,
  getStatic?: boolean
): ?string {
  const dynamicValue =
    getAndRemoveAttr(el, ':' + name) ||
    getAndRemoveAttr(el, 'v-bind:' + name)
  if (dynamicValue != null) {
    // 绑定的属性值可以居然可以使用filter，但为什么不直接用computed呢
    return parseFilters(dynamicValue)
  } else if (getStatic !== false) {
    const staticValue = getAndRemoveAttr(el, name)
    if (staticValue != null) {
      // 不被绑定的值会被处理成字符串
      return JSON.stringify(staticValue)
    }
  }
}

// note: this only removes the attr from the Array (attrsList) so that it
// doesn't get processed by processAttrs.
// By default it does NOT remove it from the map (attrsMap) because the map is
// needed during codegen.
// 除了获取给定属性的值之外，还会将该属性从 attrsList 数组中移除，并可以选择性地将该属性从 attrsMap 对象中移除
export function getAndRemoveAttr(
  el: ASTElement,
  name: string,
  removeFromMap?: boolean
): ?string {
  let val
  if ((val = el.attrsMap[name]) != null) {
    const list = el.attrsList
    for (let i = 0, l = list.length; i < l; i++) {
      if (list[i].name === name) {
        list.splice(i, 1)
        break
      }
    }
  }
  if (removeFromMap) {
    delete el.attrsMap[name]
  }
  return val
}

export function getAndRemoveAttrByRegex(
  el: ASTElement,
  name: RegExp
) {
  const list = el.attrsList
  for (let i = 0, l = list.length; i < l; i++) {
    const attr = list[i]
    if (name.test(attr.name)) {
      list.splice(i, 1)
      return attr
    }
  }
}

function rangeSetItem(
  item: any,
  range?: { start?: number, end?: number }
) {
  if (range) {
    if (range.start != null) {
      item.start = range.start
    }
    if (range.end != null) {
      item.end = range.end
    }
  }
  return item
}
