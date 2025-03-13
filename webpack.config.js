const path = require('path');

module.exports = {
  mode: 'production', // or 'development' during development
  entry: './scripts/main.js', // adjust if your entry point has a different name
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '',
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        type: 'asset/source'
      }
    ]
  },
};