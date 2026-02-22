const path = require('path');

module.exports = {
  mode: process.env.NODE_ENV || 'production',
  entry: './src/sidepanel.js', // adjust if your entry point has a different name
  output: {
    filename: 'sidepanel.js',
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