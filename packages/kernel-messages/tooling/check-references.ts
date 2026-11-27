import { BunRuntime, BunServices } from "@effect/platform-bun";
import { checkCatalogReferences } from "@ryot-app/i18n/compiler/build";
import { isReferenceSource } from "@ryot-app/i18n/compiler/references";
import { Effect, FileSystem, Path } from "effect";

import { catalog } from "../dist/locales/en.mjs";

const REFERENCE_ROOTS = [
	"packages/i18n/src",
	"packages/contract/src",
	"packages/definitions/src",
	"kernel/backend/src",
	"kernel/client/src",
	"packages/plugin-ui-sdk/src",
	"packages/plugin-client-sdk/src",
	"packages/kernel-renderers/src",
	"packages/ryotql-recipes/src",
	"packages/plugin-backend-sdk/src",
];

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const toolingRoot = path.dirname(yield* path.fromFileUrl(new URL(import.meta.url)));
	const repositoryRoot = path.resolve(toolingRoot, "../../..");
	const references = yield* Effect.forEach(REFERENCE_ROOTS, (root) =>
		Effect.flatMap(
			fs.readDirectory(path.join(repositoryRoot, root), { recursive: true }),
			(files) =>
				Effect.forEach(files.filter(isReferenceSource).sort(), (file) =>
					Effect.map(fs.readFileString(path.join(repositoryRoot, root, file)), (content) => ({
						content,
						path: path.join(root, file),
					})),
				),
		),
	);
	yield* checkCatalogReferences({
		keys: Object.keys(catalog),
		references: references.flat(),
		builders: ["kernelMessage", "kernelText"],
		catalogPath: "packages/kernel-messages/messages/en.json",
	});
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
