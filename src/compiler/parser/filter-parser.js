/* @flow */

const validDivisionCharRE = /[\w).+\-_$\]]/

//标签的属性 key 是非绑定属性，所以会将它的值作为普通字符串处理
//标签的属性 key 是绑定属性，所以会将它的值作为表达式处理，而非普通字符串
//标签的属性 key 是绑定属性，并且应用了过滤器，所以会将它的值与过滤器整合在一起产生一个新的表达式
export function parseFilters(exp: string): string {
  //inSingle 变量的作用是用来标识当前读取的字符是否在由单引号包裹的字符串中。同样的：
  //inDouble 变量是用来标识当前读取的字符是否在由 双引号 包裹的字符串中。
  //inTemplateString 变量是用来标识当前读取的字符是否在 模板字符串 中。
  //inRegex 变量是用来标识当前读取的字符是否在 正则表达式 中。
  let inSingle = false
  let inDouble = false
  let inTemplateString = false
  let inRegex = false
  //在解析绑定的属性值时，每遇到一个左花括号({)，则 curly 变量的值就会加一，每遇到一个右花括号(})，则 curly 变量的值就会减一。
  //在解析绑定的属性值时，每遇到一个左方括号([)，则 square 变量的值就会加一，每遇到一个右方括号(])，则 square 变量的值就会减一。
  //在解析绑定的属性值时，每遇到一个左圆括号(()，则 paren 变量的值就会加一，每遇到一个右圆括号())，则 paren 变量的值就会减一。
  let curly = 0
  let square = 0
  let paren = 0
  //字符串中字符的索引
  let lastFilterIndex = 0
  //c 就是当前读入字符所对应的 ASCII 码。变量 prev 保存的则是当前字符的前一个字符所对应的 ASCII 码。变量 i 为当前读入字符的位置索引。变量 expression 将是 parseFilters 函数的返回值。变量 filters 将来会是一个数组，它保存着所有过滤器函数名。
  let c, prev, i, expression, filters

  for (i = 0; i < exp.length; i++) {
    prev = c
    c = exp.charCodeAt(i)
    if (inSingle) {
      if (c === 0x27 && prev !== 0x5C) inSingle = false
    } else if (inDouble) {
      if (c === 0x22 && prev !== 0x5C) inDouble = false
    } else if (inTemplateString) {
      if (c === 0x60 && prev !== 0x5C) inTemplateString = false
    } else if (inRegex) {
      if (c === 0x2f && prev !== 0x5C) inRegex = false
    } else if (
      c === 0x7C && // pipe
      exp.charCodeAt(i + 1) !== 0x7C &&
      exp.charCodeAt(i - 1) !== 0x7C &&
      !curly && !square && !paren
    ) {
      if (expression === undefined) {
        // first filter, end of expression
        lastFilterIndex = i + 1
        expression = exp.slice(0, i).trim()
      } else {
        pushFilter()
      }
    } else {
      switch (c) {
        case 0x22: inDouble = true; break         // "
        case 0x27: inSingle = true; break         // '
        case 0x60: inTemplateString = true; break // `
        case 0x28: paren++; break                 // (
        case 0x29: paren--; break                 // )
        case 0x5B: square++; break                // [
        case 0x5D: square--; break                // ]
        case 0x7B: curly++; break                 // {
        case 0x7D: curly--; break                 // }
      }
      if (c === 0x2f) { // /
        let j = i - 1
        let p
        // find first non-whitespace prev char
        for (; j >= 0; j--) {
          p = exp.charAt(j)
          if (p !== ' ') break
        }
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true
        }
      }
    }
  }

  if (expression === undefined) {
    expression = exp.slice(0, i).trim()
  } else if (lastFilterIndex !== 0) {
    pushFilter()
  }

  function pushFilter() {
    (filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim())
    lastFilterIndex = i + 1
  }

  if (filters) {
    for (i = 0; i < filters.length; i++) {
      expression = wrapFilter(expression, filters[i])
    }
  }

  return expression
}

function wrapFilter(exp: string, filter: string): string {
  const i = filter.indexOf('(')
  if (i < 0) {
    // _f: resolveFilter
    return `_f("${filter}")(${exp})`
  } else {
    const name = filter.slice(0, i)
    const args = filter.slice(i + 1)
    return `_f("${name}")(${exp}${args !== ')' ? ',' + args : args}`
  }
}
