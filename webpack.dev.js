require("webpack");
const path = require("path");
const merge = require("webpack-merge");
const common = require("./webpack.common.js");

module.exports = merge(common, {
    mode: "development",
    devtool: "source-map",
    watch: true,
    watchOptions: {
        ignored: /node_modules/
    },
    module: {
        rules: [
            // {
            //     test: /\.(js)$/,
            //     use: 'babel-loader',
            //     exclude: /node_modules/
            // }
        ]
    },
    devServer: {
        contentBase: path.join(__dirname),
        watchFiles:["src/**/*"], // to detect changes on all files inside src directory
        compress: false,
        port: 9000
    }
});
