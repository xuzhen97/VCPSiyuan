import { defineConfig } from "vite";

export default defineConfig({
    root: "./dev",
    appType: "spa",
    server: {
        port: 5173,
        open: false,
    },
});
