// const {webpack} = require('webpack');
const {webpack} = require('./webpack');
const options = require('./webpack.config');
const compiler = webpack(options);
//开始编译
compiler.run((err, stats) => {
  console.log({err});
  console.log(stats.toJson({
    assets: true,  //打印编译产出的资源
    chunks: true,  //打印编译产出的代码块
    modules: true  //打印编译产出的模块
  }));
})
