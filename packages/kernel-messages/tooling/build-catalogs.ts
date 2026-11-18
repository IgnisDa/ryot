#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { buildCatalogs } from "@ryot-app/i18n/compiler/build";
import { generateCatalogModules } from "@ryot-app/i18n/compiler/codegen";
import { isReferenceSource } from "@ryot-app/i18n/compiler/references";
import { Effect, FileSystem, Path } from "effect";

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
	const packageRoot = path.resolve(
		path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
		"..",
	);
	const repositoryRoot = path.resolve(packageRoot, "../..");
	const outputRoot = path.join(packageRoot, "dist");
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
	const built = yield* buildCatalogs({
		root: repositoryRoot,
		references: references.flat(),
		builders: ["kernelMessage", "kernelText"],
		directory: "packages/kernel-messages/messages",
	});

	const modules = generateCatalogModules({
		catalogs: built.catalogs,
		typeName: "KernelCatalog",
		arguments: built.arguments,
		localesName: "kernelLocales",
		localeTypeName: "KernelLocale",
		loaderName: "loadKernelCatalog",
		descriptions: built.descriptions,
		localeModule: (locale) => `@ryot-app/kernel-messages/locales/${locale}`,
	});
	const localesRoot = path.join(outputRoot, "locales");
	yield* fs.remove(localesRoot, { force: true, recursive: true });
	yield* fs.makeDirectory(localesRoot, { recursive: true });
	yield* fs.writeFileString(path.join(outputRoot, "catalog.ts"), modules.index);
	yield* Effect.forEach(modules.locales, (module) =>
		Effect.all([
			fs.writeFileString(path.join(localesRoot, `${module.locale}.mjs`), module.content),
			fs.writeFileString(
				path.join(localesRoot, `${module.locale}.d.mts`),
				modules.localeDeclaration,
			),
		]),
	);
	return yield* Effect.logInfo(`Generated kernel catalogs for ${modules.locales.length} locales`);
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
