/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const { EsbuildPlugin } = require("esbuild-loader");

module.exports = (env, argv) => {
    const production = argv.mode === "production";
    return {
        mode: argv.mode || "development",
        watch: !production,
        devtool: production ? false : "inline-source-map",
        entry: {
            [production ? "dist/kernel" : "kernel"]: "./src/kernel/index.ts",
        },
        experiments: {
            outputModule: true,
        },
        output: {
            filename: "[name].js",
            path: path.resolve(__dirname),
            library: {
                type: "module",
            },
        },
        externals: {
            siyuan: "siyuan",
        },
        optimization: {
            minimize: production,
            minimizer: [new EsbuildPlugin()],
        },
        resolve: {
            extensionAlias: {
                ".js": [".ts", ".js"],
            },
            extensions: [".ts", ".js", ".json"],
        },
        module: {
            rules: [
                {
                    test: /\.ts(x?)$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [
                        {
                            loader: "esbuild-loader",
                            options: {
                                target: "esnext",
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [],
    };
};
