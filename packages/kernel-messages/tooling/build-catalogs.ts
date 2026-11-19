#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { compileCatalogs } from "@ryot-app/i18n/compiler/build";
import { generateCatalogModules } from "@ryot-app/i18n/compiler/codegen";
import { Effect, FileSystem, Path } from "effect";

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const packageRoot = path.resolve(
		path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
		"..",
	);
	const outputRoot = path.join(packageRoot, "dist");
	const built = yield* compileCatalogs({ root: packageRoot, directory: "messages" });

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
