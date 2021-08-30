/* @flow */

import { extend } from 'shared/util'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'

// 传入一个函数，返回一个createCompiler函数，这个函数就是编译器的创建者
// 可以发现 createCompiler 函数的返回值就是一个包含 compileToFunctions 属性的对象
// 不同平台给定不同的baseCompile函数，就实现了Vue的多平台编译。
export function createCompilerCreator(baseCompile: Function): Function {
  return function createCompiler(baseOptions: CompilerOptions) {
    // 定义需要返回的compile函数
    // 传入template和options
    // compile函数的作用有三个1、生成最终编译器选项 finalOptions 2、对错误的收集 3、调用 baseCompile 编译模板
    // compile 函数与 最后返回的compileToFunctions 函数的区别就在于 compile 函数生成的是字符串形式的代码
    // 而 compileToFunctions 生成的才是真正可执行的代码
    function compile(
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      const finalOptions = Object.create(baseOptions)
      // 保存error和tip的数组
      const errors = []
      const tips = []
      // 定义warn函数
      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg)
      }
      // 如果传了options
      // 这里的 options 就是使用编译器编译模板时传递的选项参数
      // 或者可以简单理解为调用 compileToFunctions 函数时传递的选项参数
      // 我们可以将上面的baseOptions理解为编译所必须的选项
      // 而传来的options则为扩展选项
      // 这段的作用是将 options 对象混合到 finalOptions 中
      if (options) {
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length

          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg }
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength
              }
            }
            (tip ? tips : errors).push(data)
          }
        }
        // merge custom modules
        // modules是数组，直接concat
        if (options.modules) {
          finalOptions.modules =
            (baseOptions.modules || []).concat(options.modules)
        }
        // merge custom directives
        // directives是对象，调用extend混入
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        // 别的选项直接复制
        for (const key in options) {
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key]
          }
        }
      }
      // 将warn混入
      finalOptions.warn = warn
      // 将字符串函数首位去空格和合并后的finalOptions传入调用baseCompile
      const compiled = baseCompile(template.trim(), finalOptions)
      // 非生产时
      // compiled 是 baseCompile 对模板的编译结果，该结果中包含了模板编译后的抽象语法树(AST)
      // 可以通过 compiled.ast 访问该语法树
      // 所以上面这段代码的作用是用来通过抽象语法树来检查模板中是否存在错误表达式的
      // 通过 detectErrors 函数实现，将 compiled.ast 作为参数传递给 detectErrors 函数
      // 该函数最终返回一个数组，该数组中包含了所有错误的收集，最终通过这句代码将错误添加到 errors 数组中
      if (process.env.NODE_ENV !== 'production') {
        detectErrors(compiled.ast, warn)
      }
      // 将收集到的错误(errors)和提示(tips)添加到 compiled 上并返回
      compiled.errors = errors
      compiled.tips = tips
      return compiled
    }

    // 可以发现 createCompiler 函数的返回值就是一个包含 compileToFunctions 属性的对象
    // 返回的compileToFunctions 又将compile这个函数作为参数，调用了createCompileToFunctionFn。
    return {
      compile,
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}
