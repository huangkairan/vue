/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = []
let pending = false

function flushCallbacks() {
  // 首先将penidng重置为false
  pending = false
  // 前拷贝一份
  const copies = callbacks.slice(0)
  // 清空原callbacks数组
  callbacks.length = 0
  // 遍历执行回调
  for (let i = 0; i < copies.length; i++) {
    copies[i]()
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
// 首先检测当前宿主环境是否支持原生的 Promise，如果支持则优先使用 Promise 注册 microtask
// 做法：首先定义常量 p 它的值是一个立即 resolve 的 Promise 实例对象，接着将变量 timerFunc 定义为一个函数
// 这个函数的执行将会把 flushCallbacks 函数注册为 microtask
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  const p = Promise.resolve()
  timerFunc = () => {
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    // 解决怪异问题的变通方法，在一些 UIWebViews 中存在很奇怪的问题，即 microtask 没有被刷新
    // 对于这个问题的解决方案就是让浏览器做一些其他的事情比如注册一个 (macro)task 即使这个 (macro)task 什么都不做，这样就能够间接触发 microtask 的刷新。
    if (isIOS) setTimeout(noop)
  }
  // 标记使用微任务
  isUsingMicroTask = true
  // 使用 Promise 是最理想的方案，但是如果宿主环境不支持 Promise，我们就需要降级处理，使用MutationObserver来注册microtask
  // 这就是 else 语句块内代码所做的事情：使用MutationObserver来注册microtask
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
  timerFunc = () => {
    counter = (counter + 1) % 2
    textNode.data = String(counter)
  }
  isUsingMicroTask = true
  // 走到这里，说明无法注册成微任务，只能将其注册成性能稍差的(marco)task了，先使用setImmediate

  // 这里我记得以前用了meassageChannel做(macro)task的，现在没了
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
  // 如果还不支持，只能用最后的备选方案setTimeout注册(marco)task了
} else {
  // Fallback to setTimeout.
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

// 接受回调函数和context。但$nextTick是只接受callback的，context指定了this（调用时的组件）
export function nextTick(cb?: Function, ctx?: Object) {
  let _resolve
  // 向callbacks push一个函数，这个函数内部会执行传递进来的cb（如果有的话），调用时将其作用域设为了传进来的ctx
  // 但此时cb也还没执行，只是push进了callbacks
  callbacks.push(() => {
    if (cb) {
      try {
        cb.call(ctx)
      } catch (e) {
        handleError(e, ctx, 'nextTick')
      }
      // 如果没有传递 cb 参数，则直接调用 _resolve 函数，这个函数就是返回的 Promise 实例对象的 resolve 函数。这样就实现了 Promise 方式的 $nextTick 方法。
    } else if (_resolve) {
      _resolve(ctx)
    }
  })
  // 如果false，代表不需要等待刷新，这里就会等待当前执行栈清空后执行flushCallbacks函数
  if (!pending) {
    pending = true
    timerFunc()
  }
  // $flow-disable-line
  // 如果没传cb，并且支持Promise，返回一个Promise对象
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
