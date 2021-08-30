/* @flow */

import { noop, extend } from 'shared/util'
import { warn as baseWarn, tip } from 'core/util/debug'
import { generateCodeFrame } from './codeframe'

type CompiledFunctionResult = {
  render: Function;
  staticRenderFns: Array<Function>;
};

//接收两个参数，第一个参数 code 为函数体字符串，该字符串将通过 new Function(code) 的方式创建为函数。
// 第二个参数 errors 是一个数组，作用是当采用 new Function(code) 创建函数发生错误时用来收集错误的。
function createFunction(code, errors) {
  try {
    return new Function(code)
  } catch (err) {
    errors.push({ err, code })
    return noop
  }
}

export function createCompileToFunctionFn(compile: Function): Function {
  // 缓存delimiters，作用是防止重复编译
  const cache = Object.create(null)

  // 闭包
  return function compileToFunctions(
    template: string,
    options?: CompilerOptions,
    vm?: Component
  ): CompiledFunctionResult {
    // 使用 extend 函数将 options 的属性混合到新的对象中并重新赋值 options
    options = extend({}, options)
    // 检查选项参数中是否包含 warn，如果没有则使用 baseWarn
    const warn = options.warn || baseWarn
    // 将options.warn删除
    delete options.warn

    /* istanbul ignore if */
    // 非生产时，通过try-catch new Function来检查安全策略
    // 如果有错误发生且错误的内容中包含诸如 'unsafe-eval' 或者 'CSP' 这些字样的信息时就会给出一个警告
    // 如果策略严格，将会有警告，因为将模板字符串编译成渲染函数依赖 new Function()
    // 此时策略有两个：放宽CSP策略或预编译
    // 总之这段代码的作用就是检测 new Function() 是否可用，并在某些情况下给你一个有用的提示。
    if (process.env.NODE_ENV !== 'production') {
      // detect possible CSP restriction
      try {
        new Function('return 1')
      } catch (e) {
        if (e.toString().match(/unsafe-eval|CSP/)) {
          warn(
            'It seems you are using the standalone build of Vue.js in an ' +
            'environment with Content Security Policy that prohibits unsafe-eval. ' +
            'The template compiler cannot work in this environment. Consider ' +
            'relaxing the policy to allow unsafe-eval or pre-compiling your ' +
            'templates into render functions.'
          )
        }
      }
    }

    // check cache
    // delimiters如果存在，将这个数组转成字符串并和template拼接，保存至key
    const key = options.delimiters
      ? String(options.delimiters) + template
      : template
    // 如果缓存中有这个key，直接返回这个key的值
    if (cache[key]) {
      return cache[key]
    }

    // compile
    // 将template和options为参数，调用传入的形参compile，返回的值赋予compiled
    const compiled = compile(template, options)

    // check compilation errors/tips
    // 非生产时，检查返回的compiled对象中有没有errors和tips字段，如果有，遍历打印出来
    if (process.env.NODE_ENV !== 'production') {
      if (compiled.errors && compiled.errors.length) {
        if (options.outputSourceRange) {
          compiled.errors.forEach(e => {
            warn(
              `Error compiling template:\n\n${e.msg}\n\n` +
              generateCodeFrame(template, e.start, e.end),
              vm
            )
          })
        } else {
          warn(
            `Error compiling template:\n\n${template}\n\n` +
            compiled.errors.map(e => `- ${e}`).join('\n') + '\n',
            vm
          )
        }
      }
      if (compiled.tips && compiled.tips.length) {
        if (options.outputSourceRange) {
          compiled.tips.forEach(e => tip(e.msg, vm))
        } else {
          compiled.tips.forEach(msg => tip(msg, vm))
        }
      }
    }

    // turn code into functions
    // 定义了两个常量，res就是最后要返回的值
    const res = {}
    // 用来保存创建函数时发生的错误
    const fnGenErrors = []
    // 定义了rens.render，通过createFunction函数可知道，compiled.render是一个函数体字符串
    // 第二个参数，创建函数时发生的错误会push进去
    res.render = createFunction(compiled.render, fnGenErrors)
    // 定义了res.staticRenderFns，是个函数体数组，遍历了compiled.staticRenderFns，并将每个item创建函数
    // compiled.staticRenderFns主要作用是渲染的优化
    res.staticRenderFns = compiled.staticRenderFns.map(code => {
      return createFunction(code, fnGenErrors)
    })

    // check function generation errors.
    // this should only happen if there is a bug in the compiler itself.
    // mostly for codegen development use
    /* istanbul ignore if */
    // 非生产时，打印fnGenErrors中的错误
    if (process.env.NODE_ENV !== 'production') {
      if ((!compiled.errors || !compiled.errors.length) && fnGenErrors.length) {
        warn(
          `Failed to generate render function:\n\n` +
          fnGenErrors.map(({ err, code }) => `${err.toString()} in\n\n${code}\n`).join('\n'),
          vm
        )
      }
    }
    // 这句代码在返回编译结果的同时，将结果缓存
    // 这样下一次发现如果 cache 中存在相同的 key 则不需要再次编译，直接使用缓存的结果就可以了
    return (cache[key] = res)
  }
}
