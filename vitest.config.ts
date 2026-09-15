import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            siyuan: path.resolve(__dirname, "tests/helpers/siyuan-mock.ts"),
        },
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        coverage: {
            reporter: ["text", "json"],
        },
    },
});
