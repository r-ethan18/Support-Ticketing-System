import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const backendTarget =
		process.env.VITE_BACKEND_URL ||
		env.VITE_BACKEND_URL ||
		process.env.VITE_API_URL ||
		env.VITE_API_URL ||
		"http://localhost:8000";

	return {
		plugins: [react()],
		resolve: {
			alias: {
				"@": path.resolve(import.meta.dirname, "./src"),
			},
		},
		server: {
			port: 3000,
			host: true,
			// Served behind a proxy under whatever hostname it is given.
			allowedHosts: true,
			proxy: {
				"/api": {
					target: backendTarget,
					changeOrigin: true,
				},
			},
		},
		preview: {
			port: 3000,
			host: true,
			allowedHosts: true,
		},
	};
});
