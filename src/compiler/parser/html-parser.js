/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
// 匹配HTML标签的属性：双引号，单引号，没引号，直接的属性名
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// 匹配动态标签如:v-... 或@...或:...或#...
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// 匹配不包含冒号(:)的 XML 名称
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
// 匹配合法的XML标签：<前缀:标签名称>
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
// 匹配开始标签的一部分 < 以及后面的 标签名称。捕获组
const startTagOpen = new RegExp(`^<${qnameCapture}`)
// 捕获开始标签结束部分的斜杠：/
const startTagClose = /^\s*(\/?)>/
// 匹配结束标签 捕获组
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
// 来匹配文档的 DOCTYPE 标签
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being passed as HTML comment when inlined in page
// 匹配注释节点
const comment = /^<!\--/
// 匹配条件注释节点
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
// 匹配一些特殊的元素：能包含任何东西
export const isPlainTextElement = makeMap('script,style,textarea', true)
// 缓存
const reCache = {}

// 这三个常量用来对html实体进行解码
const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
// 这两句代码的作用是用来解决一个问题，该问题是由于历史原因造成的，即一些元素会受到额外的限制，比如 <pre> 标签和 <textarea> 会忽略其内容的第一个换行符
// 检测给定的标签是否是 <pre> 标签或者 <textarea> 标签
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
// 检测是否应该忽略元素内容的第一个换行符
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

// 用来解码 html 实体。
// 它的原理是利用前面我们讲过的正则 encodedAttrWithNewLines 和 encodedAttr 以及 html 实体与字符一一对应的 decodingMap 对象来实现将 html 实体转为对应的字符
function decodeAttr(value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

export function parseHTML(html, options) {
  // 定义了一些常量及变量
  // 栈，用于检测html标签是否缺少闭合标签
  const stack = []
  // 以下三个常量都是调用parse时初始化的
  // 值被初始化为 options.expectHTML
  const expectHTML = options.expectHTML
  // 检测一个标签是否是一元标签
  const isUnaryTag = options.isUnaryTag || no
  //检测一个标签是否是可以省略闭合标签的非一元标签
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // 当前字符流的读入位置
  let index = 0
  // last存储剩余还未 parse 的 html 字符串，lastTag 则始终存储着位于 stack 栈顶的元素
  let last, lastTag
  // 开启一个 while 循环，循环结束的条件是 html 为空，即 html 被 parse 完毕
  while (html) {

    // 在每次循环开始时将 html 的值赋给变量 last
    last = html
    // Make sure we're not in a plaintext content element like script/style
    // 确保即将 parse 的内容不是在纯文本标签里 (script,style,textarea)
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // html 字符串中左尖括号(<)第一次出现的位置
      let textEnd = html.indexOf('<')
      // textEnd = 0时，<出现在开头
      if (textEnd === 0) {
        // 用正则匹配分别处理，分别可能是注释，条件注释，doctype，闭合标签，开始标签
        // Comment:
        if (comment.test(html)) {
          // 不仅要以<!-- 开头，还要以 --> 结尾
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            if (options.shouldKeepComment) {
              // 获取注释内容，作为参数传递
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            //这样一个注释节点就 parse 完毕了，调用advance函数将已经 parse 完毕的字符串剔除
            advance(commentEnd + 3)
            // 跳过本次循环
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // 条件注释语句
        if (conditionalComment.test(html)) {
          // 同样的，条件注释节点除了要以 <![ 开头还必须以 ]>
          const conditionalEnd = html.indexOf(']>')
          // 如果>=0标识匹配到了结尾，则将其删除，跳过本次循环 （Vue 模板永远都不会保留条件注释节点的内容）
          if (conditionalEnd >= 0) {
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        // 如果是doctype，删除后继续
        // 原则上 Vue 在编译的时候根本不会遇到 Doctype 标签。
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        // parse 结束标签
        // <div></div>会被转换成
        // endTagMatch = [
        // '</div>',
        // 'div'
        // ]
        // 第一个元素是整个匹配到的结束标签字符串，第二个元素是对应的标签名字
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          //缓存当前的index
          const curIndex = index
          // 删除
          advance(endTagMatch[0].length)
          // parse结束标签
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        // 执行函数，拿返回值，匹配成功是个对象，失败是undefined
        const startTagMatch = parseStartTag()
        // 如果存在说明开始标签解析成功
        if (startTagMatch) {
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      let text, rest, next
      if (textEnd >= 0) {
        rest = html.slice(textEnd)
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf('<', 1)
          if (next < 0) break
          textEnd += next
          rest = html.slice(textEnd)
        }
        text = html.substring(0, textEnd)
      }

      if (textEnd < 0) {
        text = html
      }

      if (text) {
        advance(text.length)
      }

      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
      // 即将 parse 的内容是在纯文本标签里 (script,style,textarea)
    } else {
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    // 将整个字符串作为文本对待

    // 在 while 循环即将结束的时候，有一个对 last 和 html 这两个变量的比较

    // 如果两者相等，则说明字符串 html 在经历循环体的代码之后没有任何改变，此时会把 html 字符串作为纯文本对待
    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  // 调用 parseEndTag 函数
  parseEndTag()

  // 已经 parse 完毕的部分要从 html 字符串中剔除
  function advance(n) {
    index += n
    html = html.substring(n)
  }

  // parseStartTag 函数用来 parse 开始标签
  function parseStartTag() {
    // 正则匹配，如果为null就匹配失败
    const start = html.match(startTagOpen)
    if (start) {
      const match = {
        tagName: start[1], // 标签名称
        attrs: [], // 存储将来被匹配到的属性
        start: index // 当前字符流读入位置在整个 html 字符串中的相对位置
      }
      // 匹配完成，将其移除
      advance(start[0].length)
      let end, attr
      // 没有匹配到开始标签的结束部分，并且匹配到了开始标签中的属性
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        // 如果匹配到了，保存当前字符流读入位置在整个 html 字符串中的相对位置
        attr.start = index
        // 将整个attr 如：v-for="v in map" 其移出
        advance(attr[0].length)
        // 移除后，保存结束为止
        attr.end = index
        // 将attr保存
        match.attrs.push(attr)
      }
      // 当变量 end 存在，即匹配到了开始标签的 结束部分 时，说明这是一个完整的开始标签
      if (end) {
        // 如果end[1]不存在，说明是一元标签
        match.unarySlash = end[1]
        // 移除
        advance(end[0].length)
        // 保存位置
        match.end = index
        // 返回match
        return match
      }
    }
  }

  // handleStartTag 函数用来处理 parseStartTag 的结果
  function handleStartTag(match) {
    const tagName = match.tagName // 标签名
    const unarySlash = match.unarySlash // undefined 或 / 

    if (expectHTML) {
      // 栈顶的元素，最近一次遇到的开始标签时p，且正在解析的开始标签必须不能是 段落式内容模型
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      // 当前正在解析的标签是一个可以省略结束标签的标签，并且与上一次解析到的开始标签相同
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }
    // true：一元标签，否则是二元标签
    const unary = isUnaryTag(tagName) || !!unarySlash

    // 标签属性的数量
    const l = match.attrs.length
    // 创建一个与l长度相等的数组
    const attrs = new Array(l)
    // 遍历match.attrs数组
    for (let i = 0; i < l; i++) {
      // 拿到当前args
      const args = match.attrs[i]
      //[
      //' v-if="isSucceed"',
      //'v-if',
      //'=',
      //'isSucceed',
      //undefined,
      //undefined
      //]
      // 拿到属性值
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1], // 属性名
        value: decodeAttr(value, shouldDecodeNewlines) // 属性值
      }
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }
    // 非一元标签，入栈，并将 lastTag 的值设置为该标签名
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }
    //parser 选项中包含 options.start 函数，则调用
    // 并将开始标签的名字(tagName)，格式化后的属性数组(attrs)
    // 是否为一元标签(unary)，以及开始标签在原 html 中的开始和结束位置(match.start 和 match.end) 作为参数传递
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  // parseEndTag 函数用来 parse 结束标签
  // 1.检测是否缺少闭合标签
  // 2.处理 stack 栈中剩余的标签
  // 3.解析 </br> 与 </p> 标签，与浏览器的行为相同
  // 该函数在htmlParser中有三种用法
  // 1.处理普通标签：三个参数都传
  // 2.xx：只传一个参数
  // 3.处理 stack 栈剩余未处理的标签：什么参数都不传 
  function parseEndTag(tagName, start, end) {
    // pos：判断 html 字符串是否缺少结束标签
    // lowerCasedTagName：存储 tagName 的小写版
    let pos, lowerCasedTagName
    // start 和 end 不存在时，将这两个变量的值设置为当前字符流的读入位置
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    if (tagName) {
      // 转为小写
      // 从后向前遍历stack，直到找到相应的位置，并且该位置索引会保存到 pos 变量中，如果 tagName 不存在，则直接将 pos 设置为 0。
      // 当 tagName 没有在 stack 栈中找到对应的开始标签时，pos为-1
      lowerCasedTagName = tagName.toLowerCase()
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    // pos找到了，
    if (pos >= 0) {
      // Close all the open elements, up the stack
      // 如果stack里存的索引大于pos，说明少了闭合标签
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        // 接着将其闭合
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      stack.length = pos
      lastTag = pos && stack[pos - 1].tag
      // 这俩的意思是 如果写了</br> 或 </p>，浏览器会做处理，所以Vue也要做处理，与浏览器保持一致
    } else if (lowerCasedTagName === 'br') {
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
