import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readLocale = (fileName: string): Record<string, string> =>
    JSON.parse(
        readFileSync(
            new URL(`../../i18n/${fileName}`, import.meta.url),
            "utf8",
        ),
    ) as Record<string, string>;

const readSource = (relativePath: string): string =>
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const en = readLocale("en.json");
const zh = readLocale("zh-CN.json");

describe("locale parity", () => {
    it("keeps English and Chinese key sets identical", () => {
        expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
        for (const key of Object.keys(en)) {
            expect(en[key]).not.toBe("");
            expect(zh[key]).not.toBe("");
        }
    });

    it("provides every key the plugin reads from the SiYuan i18n bundle", () => {
        const source = readSource("src/frontend/plugin.ts");
        const keys = [
            ...source.matchAll(/this\.i18n\.([A-Za-z_][A-Za-z0-9_]*)/g),
        ].map((match) => match[1]);

        expect(keys.length).toBeGreaterThan(0);
        const missing = [...new Set(keys)].filter(
            (key) => !(key in en) || !(key in zh),
        );
        expect(missing).toEqual([]);
    });
});
