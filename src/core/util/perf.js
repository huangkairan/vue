import { inBrowser } from './env'

export let mark
export let measure

// 通过startTag和endTag来进行性能计算
// 必须支持window.performance
// 其实就是对window.performance进行了封装
// mark:打标记
// measure：传入两个标记，计算标记间代码的性能
if (process.env.NODE_ENV !== 'production') {
  const perf = inBrowser && window.performance
  /* istanbul ignore if */
  if (
    perf &&
    perf.mark &&
    perf.measure &&
    perf.clearMarks &&
    perf.clearMeasures
  ) {
    mark = tag => perf.mark(tag)
    measure = (name, startTag, endTag) => {
      perf.measure(name, startTag, endTag)
      perf.clearMarks(startTag)
      perf.clearMarks(endTag)
      // perf.clearMeasures(name)
    }
  }
}
