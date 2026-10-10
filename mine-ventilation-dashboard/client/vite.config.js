import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom", "socket.io-client"],
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    port: 5174,
    allowedHosts: [".pinggy-free.link", ".free.pinggy.net", ".pinggy.link", ".a.pinggy.io", ".loca.lt", ".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:4001",
      "/socket.io": {
        target: "http://localhost:4001",
        ws: true,
      },
    },
  },
});
