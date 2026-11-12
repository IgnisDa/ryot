import { expect } from "bun:test";

import { CLIENT_API_VERSION, pageDeclarationHash } from "@ryot-app/plugin-client-contract";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem } from "effect";

import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { compileClientPluginModule } from "./module";
import { pluginClientCompilerPlatformLayer } from "./platform";
import { generateClientSdkReference } from "./sdk-reference";

it.layer(pluginClientCompilerPlatformLayer)("SDK authoring reference", (test) => {
	test.effect(
		"generates deterministic public exports, type-only exports and props without internal paths",
		() =>
			Effect.gen(function* () {
				const reference = yield* generateClientSdkReference();
				expect(reference).toContain("## @ryot-app/plugin-client-sdk/react");
				expect(reference).toContain("createRyotQuery:");
				const ratingScale = reference.split("\n").find((line) => line.startsWith("RatingScale:"));
				for (const value of ["hundred", "ten", "five", "three-point"]) {
					expect(ratingScale).toContain(`"${value}"`);
				}
				expect(ratingScale).not.toContain("Literals<");
				expect(reference).toContain("page: {");
				expect(reference).toContain("query: <Success>");
				expect(reference).toContain("## @ryot-app/plugin-ui-sdk/charts");
				expect(reference).toContain("MetricGrid:");
				expect(reference).toContain('variant: "tiles" | "panel" | "plain"');
				expect(reference).toContain("QueryStatusProps:");
				expect(reference).toContain("\nonRetry: () => void;");
				expect(reference).not.toContain("__@queryTypeId@");
				for (const path of ["bootstrap", "runtime", "testing", "schedule"]) {
					expect(reference).not.toContain(`## @ryot-app/plugin-client-sdk/${path}\n`);
				}
				expect(reference).not.toContain("## motion/react");
				expect(reference).not.toContain("/__ryot_sdk_reference__");
				expect(reference).not.toContain(Bun.fileURLToPath(new URL("../../..", import.meta.url)));
				expect(reference).not.toContain("../Users/");
				expect(reference).not.toContain("../home/");
				expect(yield* generateClientSdkReference()).toBe(reference);
			}),
		{ timeout: 180_000 },
	);

	for (const sdk of ["clientSdkRoot", "uiSdkRoot"] as const) {
		test.effect(
			`compiles the source-owned ${sdk} page examples`,
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const dependencies = yield* resolveClientPluginCompilerDependencies;
					const guidance = yield* fs.readFileString(
						`${dependencies[sdk]}/../assistant-reference.md`,
					);
					let count = 0;
					for (const match of guidance.matchAll(/```tsx\n([\s\S]*?)\n```/g)) {
						const source = match[1];
						if (source === undefined) {
							continue;
						}
						const entry = "client/page.tsx";
						const result = yield* compileClientPluginModule({
							kind: "page",
							name: "SDK reference example",
							apiVersion: CLIENT_API_VERSION,
							publicExports: { page: { entry, kind: "page" } },
							files: { [entry]: new TextEncoder().encode(source) },
							pageDeclarationHash: pageDeclarationHash({ entry, pluginDependencies: {} }),
						});
						expect(result.artifact.files.some(({ name }) => name === "module.js")).toBe(true);
						count++;
					}
					expect(count).toBeGreaterThan(0);
				}),
			{ timeout: 180_000 },
		);
	}
});
