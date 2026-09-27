import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { compileClientPluginModule } from "@ryot-app/plugin-client-compiler";
import { CLIENT_API_VERSION, clientDeclarationHash } from "@ryot-app/plugin-client-contract";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, FileSystem, Layer } from "effect";

import { fitnessPlugin } from "../../manifest/plugin";

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, ViteBuildService.layer))((test) => {
	test.effect("packages the shared editor and its audio through the real client compiler", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const paths = [
				...new Bun.Glob("{client,shared}/**/*.{ts,tsx,mp3}").scanSync({ cwd: "." }),
			].filter((path) => !path.includes(".test."));
			const sources = yield* Effect.forEach(paths, (path) =>
				fs.readFile(path).pipe(Effect.map((bytes) => [path, bytes] as const)),
			);
			const input = {
				name: "Fitness",
				kind: "plugin" as const,
				apiVersion: CLIENT_API_VERSION,
				files: Object.fromEntries(sources),
				publicExports: fitnessPlugin.client.exports,
				packageId: PluginPackageId.make("ryot/fitness"),
				clientDeclarationHash: clientDeclarationHash(fitnessPlugin.client),
			};
			const compiled = yield* compileClientPluginModule(input);
			expect(compiled.artifact.files.some(({ name }) => name.endsWith(".js"))).toBe(true);
			expect(compiled.artifact.files.filter(({ name }) => name.endsWith(".mp3"))).toHaveLength(4);
		}),
	);
});
