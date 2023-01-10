const {SyncHook} = require('tapable');
const path = require('path')


function toUnixPath (filePath) {
  return filePath.replace(/\\/g, "/");
}

const baseDir = toUnixPath(process.cwd());

class Compiler {
  constructor(webpackOptions){
    this.options = webpackOptions; //存储配置信息
    this.hooks = { // 内部提供了许多钩子
      run: new SyncHook(),  //开始编译的时候执行此钩子
      done: new SyncHook(), //编译完成后执行此钩子
    }
  }

  compile(callback){
    const compilation = new Compilation(this.options);
    compilation.build(callback);
  }

  run(callback){
    //执行run方法开始编译
    this.hooks.run.call(); //调用开始编译钩子
    const build = new Compilation(this.options);
    build.build(()=>{
      console.log('compilation完成');
    });
    const onCompiled = (err, stats, fileDependencies) => {
      //先判断存不存在
      if(fs.existsSync(this.options.output.path)){
        fs.rmdir(this.options.output.path, ()=>{
          console.log(`删除${this.options.output.path}成功`);
        })
      }
      //根据配置的输出路径和文件名，将文件内容写入到文件系统
      for(let filename in stats.assets){
        const filePath = path.join(this.options.output.path, filename);
        console.log({filePath});
        fs.writeFileSync(filePath, stats.assets[filename], 'utf-8');
      }
      callback(err, {
        toJson: ()=>stats
      })
      this.hooks.done.call();
    }
    this.compile(onCompiled);
  }
}

const parser = require('@babel/parser');
const types = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const fs = require('node:fs');
//获取文件路径
function tryExtensions (modulePath, extensions) {
  if(fs.existsSync(modulePath)){
    return modulePath;
  }
  for(let i=0;i<extensions.length;i++){
    let filePath = modulePath + extensions[i];
    if(fs.existsSync(filePath)){
      return filePath
    }
  }
  throw new Error(`无法找到${modulePath}`)
}

function getSource(chunk){
  return `
    (()=>{
      var modules = {
        ${chunk.modules.map(module=>`"${module.id}": (module)=>{${module._source}}`)}
      };
      var cache = {};
      function require(moduleId){
        var cacheModule = cache[moduleId];
        if(cacheModule!==undefined){
          return cacheModule.exports;
        }
        var module = (cache[moduleId] = {exports: {}});
        modules[moduleId](module, module.exports,require);
        return module.exports;
      }
      var exports = {};
      ${chunk.entryModule._source}
    })();
  `;
}

class Compilation {
  constructor(webpackOptions){
    this.options = webpackOptions;
    this.assets = [];
    this.modules = [];
    this.chunks = [];
    this.fileDependencies = [];
  }

  //编译模块，name：这个模块是属于哪个chunk的， modulePath：模块的绝对路径
  buildModule(name, modulePath){
    //读取模块内容，获取源代码
    let sourceCode = fs.readFileSync(modulePath, 'utf-8');
    //模块ID：从根目录出发，找到与该模块的相对路径
    const moduleId = "./" + path.posix.relative(baseDir, modulePath);
    //创建模块对象
    const module = {
      id: moduleId,
      names: [name], //这里使用数组是因为一个模块可能属于多个代码块
      dependencies: [],
      _source: ''
    }
    //找到loader对源代码进行处理
    let loaders = [];
    let {rules = []} = this.options.module;
    rules.forEach(rule => {
      let {test} = rule;
      if(modulePath.match(test)){
        loaders.push(...rule.use);
      }
    })
    //自右向左对模块进行转译
    sourceCode = loaders.reduceRight((code, loader) => {
      return loader(code);
    }, sourceCode)
    //通过loader翻译后的内容一定是js内容
    const ast = parser.parse(sourceCode, {sourceType: "module"});
    traverse(ast, {
      CallExpression: (nodePath) => {
        const {node} = nodePath;
        //在ast中查找require语句，找出依赖的模块和 绝对路径
        if(node.callee.name==='require'){
          const depModuleName = node.arguments[0].value; //获取依赖的模块
          const dirName = path.posix.dirname(modulePath); //获取当前正在编译的模块所在的目录
          let depModulePath = path.posix.join(dirName, depModuleName); //依赖模块的绝对路径
          const extensions = this.options.resolve?.extensions || ['.js']; //获取配置中的extensions
          depModulePath = tryExtensions(depModulePath, extensions);
          //将依赖模块的绝对路径添加到依赖数组中
          this.fileDependencies.push(depModulePath);
          //生成依赖模块的id
          const depModuleId = "./" + path.posix.relative(baseDir, depModulePath);
          //修改语法结构，把依赖的模块改为依赖模块的id
          node.arguments = [types.stringLiteral(depModuleId)];
          module.dependencies.push({depModuleId, depModulePath});
        }
      }
    })
    let {code} = generator(ast);
    module._source = code;
    //对依赖模块进行编译
    module.dependencies.forEach(({depModuleId, depModulePath}) => {
      //一个模块可能被多个其他模块引用，如果已经编译过了，就不需要再编译了
      let existModule = this.modules.find(item=>item.id===depModuleId);
      if(existModule){
        existModule.names.push(name);
      }else{
        let depModule = this.buildModule(name, depModulePath);
        this.modules.push(depModule);
      }
    })
    return module
  }

  build(callback){
    //编译工作，完成后执行callback
    let entry = {};
    if(typeof this.options.entry==='string'){
      entry.main = this.options.entry;
    }else{
      entry = this.options.entry;
    }
    //从入口文件开始，调用配置的loader规则
    for(let entryName in entry){
      let entryFilePath = path.posix.join(baseDir, entry[entryName]);
      // 将入口文件路径添加到依赖数组中
      this.fileDependencies.push(entryFilePath);
      //得到入口文件的module对象，里面放着该模块的路径，依赖，源代码等
      const entryModule = this.buildModule(entryName, entryFilePath);
      //将生成的模块添加到模块数组中
      this.modules.push(entryModule);
      //模块编译完成后，根据模块间的依赖关系，组装代码块chunk(一般来说，一个入口文件对应一个代码块chunk，该chunk中包含本入口模块和其依赖模块)
      let chunk = {
        name: entryName,
        entryModule,
        modules: this.modules.filter(item=>item.names.includes(entryName))
      }
      this.chunks.push(chunk);
    }
    //把每一个chunk转换成文件加入到输出列表
    this.chunks.forEach(chunk=>{
      const fileName = this.options.output.filename.replace("[name]", chunk.name);
      this.assets[fileName] = getSource(chunk);
    })
    callback(
      null,
      {
        chunks: this.chunks,
        modules: this.modules,
        assets: this.assets
      },
      this.fileDependencies
    );
  }
}

function webpack(webpackOptions){
  const compiler = new Compiler(webpackOptions);
  const plugins = webpackOptions.plugins;
  plugins.forEach(element => {
    element.apply(compiler);
  });
  return compiler;
}

//插件定义时必须有一个apply方法，运行插件就是执行插件的apply方法
class WebpackRunPlugin {
  constructor(){}
  apply(compiler){
    compiler.hooks.run.tap("WebpackRunPlugin", ()=>{
      console.log('开始编译');
    })
  }
}

class WebpackDonePlugin {
  constructor(){}
  apply(compiler){
    compiler.hooks.done.tap("WebpackDonePlugin", ()=>{
      console.log("编译完成");
    })
  }
}

const delConsoleLoader = (source) => {
  // return source.replace(/console\.log\(.*\)/g, '');
  return source + '给代码加点注释:loader1;';
}
const loader2 = (source) => {
  return source + '给代码加点注释:loader2;';
}

module.exports = {
  webpack,
  WebpackRunPlugin,
  WebpackDonePlugin,
  delConsoleLoader,
  loader2
}