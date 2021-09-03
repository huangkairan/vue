/* @flow */

import { cached } from 'shared/util'
import { parseFilters } from './filter-parser'

// 匹配{{}} 内的内容
const defaultTagRE = /\{\{((?:.|\r?\n)+?)\}\}/g
// 在正则中有特殊意义的字符
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g

// 用户可以通过修改options.delimiters来自定义字面量表达式的分隔符.通过传入的自定义分隔符来重新生成一个正则
const buildRegex = cached(delimiters => {
  const open = delimiters[0].replace(regexEscapeRE, '\\$&')
  const close = delimiters[1].replace(regexEscapeRE, '\\$&')
  return new RegExp(open + '((?:.|\\n)+?)' + close, 'g')
})

type TextParseResult = {
  expression: string,
  tokens: Array<string | { '@binding': string }>
}

// 解析这段包含了字面量表达式的文本，如果解析成功则说明该文本节点的内容确实包含字面量表达式
export function parseText(
  text: string,
  delimiters?: [string, string]
): TextParseResult | void {
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE
  if (!tagRE.test(text)) {
    return
  }
  // 一些变量
  const tokens = []
  const rawTokens = []
  let lastIndex = tagRE.lastIndex = 0
  let match, index, tokenValue

  // 当macth有值(正则匹配上{{}}或用户自定义的分隔符时)
  while ((match = tagRE.exec(text))) {
    // 拿到index,第一个{的下标
    index = match.index
    // push text token
    // 只要match.index>0即可
    if (index > lastIndex) {
      // 将{{前的字符取出来
      rawTokens.push(tokenValue = text.slice(lastIndex, index))
      tokens.push(JSON.stringify(tokenValue))
    }
    // tag token
    // 对filter做处理
    const exp = parseFilters(match[1].trim())
    tokens.push(`_s(${exp})`)
    rawTokens.push({ '@binding': exp })
    // 更新 lastIndex 变量的值, 本次循环结束
    lastIndex = index + match[0].length
  }

  // 如果lastindex<文本长度,则截取剩余的普通文本并将其添加到 rawTokens 和 tokens 数组中
  if (lastIndex < text.length) {
    rawTokens.push(tokenValue = text.slice(lastIndex))
    tokens.push(JSON.stringify(tokenValue))
  }
  // abc{{name}}def
  // 处理后
  // {
  //   expression: "'abc'+_s(name)+'def'",
  //   tokens: [
  //     'abc',
  //     {
  //       '@binding': '_s(name)'
  //     },
  //     'def'
  //   ]
  // }
  return {
    expression: tokens.join('+'),
    tokens: rawTokens
  }
}
