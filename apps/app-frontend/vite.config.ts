import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import openapiTS, { astToString } from "openapi-typescript";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const openApiTypesPath = fileURLToPath(
	new URL("./src/lib/api/openapi.d.ts", import.meta.url),
);
const openApiSourceUrl =
	process.env.RYOT_APP_OPENAPI_URL ?? "http://localhost:8000/api/openapi.json";

const createOpenApiTypesPlugin = (): Plugin => {
	let currentHash = "";
	let isUpdatingOpenApiTypes = false;
	let hasLoggedConnectionFailure = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	const syncOpenApiTypes = async () => {
		if (isUpdatingOpenApiTypes) return false;
		isUpdatingOpenApiTypes = true;

		try {
			const response = await fetch(openApiSourceUrl);
			if (!response.ok)
				throw new Error(
					`OpenAPI request failed with status ${response.status}`,
				);

			const schemaText = await response.text();
			hasLoggedConnectionFailure = false;
			const nextHash = createHash("sha1").update(schemaText).digest("hex");
			if (nextHash === currentHash) return false;

			const ast = await openapiTS(schemaText);
			const nextTypes = astToString(ast);
			const previousTypes = await readFile(openApiTypesPath, "utf8").catch(
				() => "",
			);

			currentHash = nextHash;
			if (nextTypes === previousTypes) return false;

			await mkdir(dirname(openApiTypesPath), { recursive: true });
			await writeFile(openApiTypesPath, nextTypes, "utf8");
			return true;
		} finally {
			isUpdatingOpenApiTypes = false;
		}
	};

	return {
		apply: "serve",
		name: "ryot-openapi-types",
		async configureServer(server) {
			const refreshTypes = async () => {
				try {
					const didUpdateTypes = await syncOpenApiTypes();
					if (!didUpdateTypes) return;

					server.watcher.emit("change", openApiTypesPath);
					server.config.logger.info(
						`[openapi-types] updated ${openApiTypesPath}`,
					);
				} catch (error) {
					if (hasLoggedConnectionFailure) return;
					hasLoggedConnectionFailure = true;
					const message =
						error instanceof Error ? error.message : String(error);
					server.config.logger.warn(
						`[openapi-types] waiting for ${openApiSourceUrl}: ${message}`,
					);
				}
			};

			await refreshTypes();
			timer = setInterval(() => {
				void refreshTypes();
			}, 1500);

			server.httpServer?.once("close", () => {
				if (!timer) return;
				clearInterval(timer);
			});
		},
	};
};

const config = defineConfig({
	server: { host: true, port: 3005, strictPort: true, allowedHosts: true },
	plugins: [
		devtools(),
		createOpenApiTypesPlugin(),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart({ spa: { enabled: true } }),
		viteReact(),
	],
});

export default config;
