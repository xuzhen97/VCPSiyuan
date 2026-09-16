import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: [
            "dist",
            "node_modules",
            "examples",
            ".tmp",
            "index.js",
            "index.css",
            "kernel.js",
            "package.zip",
            "webpack.config.cjs",
            "webpack.kernel.config.cjs",
        ],
    },
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            sourceType: "module",
            parserOptions: {
                ecmaVersion: "latest",
            },
        },
    },
    ...compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
    ),
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            },
            parser: tsParser,
        },
        rules: {
            semi: [2, "always"],
            quotes: [2, "double", { avoidEscape: true }],
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { caughtErrors: "none" },
            ],
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
];
