#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { validateCatalogSources } from "@ryot-app/i18n/compiler/validate";
import { SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { catalog } from "@ryot-app/kernel-messages/locales/en";
import {
	CATALOG_MESSAGES_MODULE,
	catalogMessagesModule,
} from "@ryot-app/plugin-kit/messages-module";
import { Effect, FileSystem, Option, Path, Result } from "effect";

const SOURCE_CATALOG = `packages/kernel-messages/messages/${SOURCE_LOCALE}.json`;

/** Kernel scripts are a sandbox package whose catalog is the kernel's source-locale catalog. */
const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const toolingDirectory = path.dirname(yield* path.fromFileUrl(new URL(import.meta.url)));
	const { descriptions } = validateCatalogSources([
		{
			path: SOURCE_CATALOG,
			locale: SOURCE_LOCALE,
			content: yield* fs.readFileString(path.resolve(toolingDirectory, "../../..", SOURCE_CATALOG)),
		},
	]);
	const generated = catalogMessagesModule(catalog, descriptions);
	if (Result.isFailure(generated)) {
		return yield* Effect.die(new Error(generated.failure.join("\n")));
	}
	const modulePath = path.resolve(
		toolingDirectory,
		"../src/modules/definitions/kernel-scripts",
		CATALOG_MESSAGES_MODULE,
	);
	const current = yield* fs.readFileString(modulePath).pipe(Effect.option);
	if (Option.getOrUndefined(current) !== generated.success) {
		yield* fs.makeDirectory(path.dirname(modulePath), { recursive: true });
		yield* fs.writeFileString(modulePath, generated.success);
	}
	return yield* Effect.logInfo("Generated kernel script messages");
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
