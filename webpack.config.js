const path = require('path')
const {WebpackRunPlugin, WebpackDonePlugin} = require('./webpack')
const {delConsoleLoader, loader2} = require('./webpack')

module.exports = {
  mode: 'development',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  plugins: [
    new WebpackRunPlugin(), new WebpackDonePlugin()
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        use: [delConsoleLoader, loader2]
      }
    ]
  },
  devtool: 'source-map'
}