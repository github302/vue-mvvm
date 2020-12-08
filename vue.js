const isObject = (obj) => Object.prototype.toString.call(obj) === '[object Object]';
class Compile {
  constructor(vm, el) {
    this.vm = vm;
    this.$el = typeof el === 'string' ? document.querySelector(el) : el;

    // 只有当传入了el才开始编译模板
    if (this.$el) {
      this.$fragment = this.node2fragment(this.$el);
      
      // 开始编译模板
      this.init();

      // 将编译好的模板重新添加到 el 节点下
      this.$el.appendChild(this.$fragment);
    }
  }
  node2fragment(el) {
    const fragment = document.createDocumentFragment();
    let child;
    while(child = el.firstChild) {
      // 当使用 appendChild 去添加一个已存在的节点时，会先将该节点从原来的位置移除，然后再追加过来，如果不希望移除，仅仅是复制可以使用clone
      fragment.appendChild(child);
    }
    return fragment;
  }
  
  init() {
    this.compile(this.$fragment);  
  }

  // 遍历节点的所有子节点，一点点解析v-指令，并将对应的数据设置到文本中
  compile(el) {
    const childNodes = el.childNodes;
    
    [].slice.call(childNodes).forEach((node) => {
      // 判断节点是否为元素节点
      if (this.isElementNode(node)) {
        // 如果是元素节点，我们需要判断当前是否有 v-bind:xxx, v-on:click, v-model指令，有的话需要处理不同指令

        this.compileElement(node);
      } else if (this.isTextNode(node)) {
        // 判断节点是否为文本节点,如果是文本节点，我们需要判断是否有 {{ xxx }} 这样的模板，有的话需要替换为对应的数据
        this.compileText(node);
      }

      // 当需要处理的部分处理完之后，我们需要继续遍历该节点的子节点
      if (node.childNodes && node.childNodes.length > 0) {
        this.compile(node);
      }
    })
  }

  compileElement(node) {
    // 我们需要读取元素的属性，判断是否有指令
    const attrs = node.attributes;
    [].slice.call(attrs).forEach((attr) => {
      const attrName = attr.name; // 获取属性值
      if (this.isDirective(attrName)) {
        // 如果是指令，就需要针对不同指令做不同处理
        
        const directiveName = attrName.substring(2); // 去掉v-，剩余部分就是指令的名称了
        const exp = attr.value;
        if (this.isEventDirective(directiveName)) {
          // v-on:click 事件指令
          compileUtils.eventHandler(this.vm, node, exp, directiveName);
        } else if (this.isBindDirective(directiveName)) {
          // v-bind 指令
          compileUtils.bind(this.vm, node, exp, directiveName);
        } else {
          // v-model 指令
          compileUtils[directiveName](this.vm, node, exp, directiveName);
        }
        // 当所有属性指令解析完之后，需要将该属性移除
        node.removeAttribute(attrName);
      }
    })
  }

  compileText(node) {
    // 解析文本内容，即替换 {{ xxx }} 的内容
    const reg = /\{\{(.*)\}\}/;
    const text = node.textContent;
    if (text && reg.test(text)) {
      const exp = RegExp.$1.trim();
      compileUtils.text(this.vm, node, exp);
    }
  }

  isDirective(attr) {
    // 指令是以 v- 开头的属性
    return attr.indexOf("v-") === 0;
  }

  isEventDirective(directiveName) {
    // v-on:click
    return directiveName.indexOf("on") === 0;
  }

  isBindDirective(directiveName) {
    // v-bind:title
    return directiveName.indexOf('bind') === 0;
  }

  isElementNode(node) {
    return node.nodeType === 1;
  }

  isTextNode(node) {
    return node.nodeType === 3;
  }
}

const compileUtils = {
  eventHandler(vm, node, exp, directiveName) {
    // 如果是事件，我们需要给node绑定事件

    const eventType = directiveName.split(":")[1];
    const fn = vm.$options.methods[exp];
    if (eventType && fn) {
      node.addEventListener(eventType, fn.bind(vm), false);
    }
  },
  text(vm, node, exp) {
    this.watcher(vm, node, exp, '', 'text');
  },
  bind(vm, node, exp, directiveName) {
    // 如果是v-bind:title，我们需要将属性值替换为对应的data
    // 1. 获取属性名称
    // 2. 得到属性值，获取属性值其实就是get data 的过程，此时我们需要给data创建一个watcher，去帮忙收集依赖，当数据变化后，我们可以同步更新
    const attrName = directiveName.split(":")[1];
    this.watcher(vm, node, exp, attrName, 'bind');
  },
  model(vm, node, exp, directiveName) {
    // 先执行数据更新，然后再给node绑定input事件，当数据变化的时候，同时设置data的值
    this.watcher(vm, node, exp, '', 'model');
    
    const value = this._getVMVal(vm, exp);

    node.addEventListener('input', (event) => {
      const newValue = event.target.value;
      if (value !== newValue) {
        this._setVMVal(vm, exp, newValue);
      }
    })

  },
  watcher(vm, node, exp, attrName, type) {
    const value = this._getVMVal(vm, exp);
    const updateFn = updateUtils[type];
    
    updateFn && updateFn.call(vm, node, attrName, value);

    new Watcher(vm, exp, (value, oldValue) => {
      updateFn(node, attrName, value, oldValue)
    });
  },
  _getVMVal(vm, exp) {
    const exps = exp.split(".");
    let obj = vm;
    for (let i = 0; i < exps.length; i++) {
      if (!obj) return '';
      obj = obj[exps[i]];
    }
    return obj;
  },
  _setVMVal(vm, exp, value) {
    const exps = exp.split(".");
    let obj = vm;
    exps.forEach((key, i) => {
      if (i === exps.length - 1) {
        obj[key] = value;
      } else {
        obj = obj[key];
      }
    })
  }
}

const updateUtils = {
  bind(node, attrName, value, oldValue) {
    if (value !== oldValue) {
      value = typeof value === 'undefined' ? '' : value;
      node.setAttribute(attrName, value);
    }
  },
  model(node,attrName, value, oldValue) {
    if (value !== oldValue) {
      value = typeof value === 'undefined' ? '' : value;
      node.value = value;
    } 
  },
  text(node, attrName, value, oldValue) {
    if (value === oldValue) return;
    value = typeof value === 'undefined' ? '' : value;
    node.textContent = value;
  }
}
class Watcher {
  constructor(vm, expOrFn, cb) {
    this.vm = vm;
    this.expOrFn = expOrFn;
    this.cb = cb;

    if (typeof expOrFn === 'function') {
      this.getter = expOrFn;
    } else {
      this.getter = this.parseGetter(expOrFn);
    }

    this.value = this.get();
  }
  get() {
    // 读取数据，设置依赖
    Dep.target = this;
    const value = this.getter.call(this.vm, this.vm);
    Dep.target = null;
    return value;
  }

  parseGetter(exp) {
    // a.b.c.d
    if (/[^\w.$]/.test(exp)) return ;
    const exps = exp.split(".");

    return function getter(obj) {
      for (let i = 0; i < exps.length; i++) {
        if (!obj) return '';
        obj = obj[exps[i]];
      }
      return obj;
    }
  }

  update() {
    // 当数据更新后，通知依赖更新，此时会执行依赖的回调函数，并传入新旧的data值
    const oldValue = this.value;
    const value = this.get();
    if (value !== oldValue) {
      this.value = value;
      this.cb && this.cb.call(this.vm, value, oldValue)
    }
  }
}

class Dep {
  constructor() {
    this.subs = []; // 存放当前的依赖列表
  }

  addSub(sub) {
    if (sub && this.subs.indexOf(sub) === -1) {
      this.subs.push(sub);
    }
  }

  notify() {
    // 通知所有的依赖去执行它的更新方法
    this.subs.forEach((sub) => {
      sub.update && sub.update();
    })
  }
}
Dep.target = null;

class Observer {
  constructor(data) {
    this.data = data;

    this.walk(this.data);
  }

  walk(data) {
    Object.keys(data).forEach((key) => {
      this.defineReactive(data, key, data[key]);
    })
  }
  defineReactive(data, key, val) {
    const dep = new Dep();
    // 如果 val 也是一个Object的话，那我们需要继续递归将其变为响应式
    observe(val);

    Object.defineProperty(data, key, {
      enumerable: true,
      configurable: true,
      get() {
        // 收集依赖, 将依赖存放在Dep.target上
        dep.addSub(Dep.target);
        return val;
      },
      set(newVal) {
        if (val !== newVal) {
          // 当新设置的newVal也为对象，我们也需要继续递归变量其所有属性将其转换为响应式
          observe(newVal);
          val = newVal;
          // 通知依赖数据更新了
          dep.notify();
        }
      }
    })
  }
}

function observe(data) {
  if (!data || !isObject(data)) return ;
  new Observer(data);
}

class Vue {
  constructor(options) {
    this.$options = options;
    this.$el = options.el || document.body;
    this.$data = options.data;

    // 把this.$data.xxx 代理到 this.xxx 上，这样后续读取data数据的时候可以直接在this上读取
    Object.keys(this.$data).forEach((key) => {
      this._proxyData(key);
    })

    // 将 this.$data 转换为响应式
    observe(this.$data);

    // 编译模板，创建依赖
    this.$compile = new Compile(this, this.$el);
  }

  _proxyData(key) {
    Object.defineProperty(this, key, {
      enumerable: true,
      configurable: false,
      get() {
        return this.$data[key];
      },
      set(newData) {
        this.$data[key] = newData;
      }
    })
  }
}