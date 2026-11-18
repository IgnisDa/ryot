import { commonMessageKeyIssues } from "@ryot-app/contract/modules/plugins/common-messages";
import type { CompiledCatalog } from "@ryot-app/i18n/catalog";
import { buildCatalogs } from "@ryot-app/i18n/compiler/build";
import { isReferenceSource } from "@ryot-app/i18n/compiler/references";
import {
	CATALOG_MESSAGE_BUILDER,
	CATALOG_MESSAGES_DIRECTORY,
	CATALOG_MESSAGES_MODULE,
	CATALOG_ROW_TEXT_BUILDER,
	catalogMessagesModule,
} from "@ryot-app/plugin-kit/messages-module";
import { Effect, FileSystem, Option, Path, Result, Schema, Stream } from "effect";

const REFERENCE_GLOBS = ["*.ts", "{backend,client,manifest,shared}/**/*.{ts,tsx}"];

export type PluginMessages = {
	readonly source: CompiledCatalog;
	readonly catalogs: Readonly<Record<string, CompiledCatalog>>;
};

export class PluginMessagesError extends Schema.TaggedError<
	PluginMessagesError,
	{ readonly brand: unique symbol }
>()("PluginMessagesError", { message: Schema.String }) {}

/**
 * Validates `shared/messages/<locale>.json` with the kernel's catalog rules, fails on unknown and
 * unused keys across the plugin's sources and on kernel common message keys, and writes the typed
 * `catalogMessage` builder module for editors and local tests. Compilers generate their own copy
 * from `source`.
 */
export const buildPluginMessages = Effect.fn("buildPluginMessages")(function* (cwd: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const referencePaths = yield* Stream.fromIterable(REFERENCE_GLOBS).pipe(
		Stream.flatMap((pattern) =>
			Stream.fromAsyncIterable(
				new Bun.Glob(pattern).scan({ cwd, onlyFiles: true }),
				(error) =>
					new PluginMessagesError({
						message: `Unable to discover plugin sources: ${String(error)}`,
					}),
			),
		),
		Stream.map((file) => path.normalize(file)),
		Stream.filter(isReferenceSource),
		Stream.runCollect,
	);
	const referenceFiles = yield* Effect.forEach([...referencePaths].sort(), (file) =>
		Effect.map(fs.readFileString(path.join(cwd, file)), (content) => ({ content, path: file })),
	);
	const { source, catalogs, descriptions } = yield* buildCatalogs({
		root: cwd,
		references: referenceFiles,
		directory: CATALOG_MESSAGES_DIRECTORY,
		builders: [CATALOG_MESSAGE_BUILDER, CATALOG_ROW_TEXT_BUILDER],
	});
	const shadowed = commonMessageKeyIssues(source);
	if (shadowed.length > 0) {
		return yield* new PluginMessagesError({ message: shadowed.join("\n") });
	}
	const modulePath = path.join(cwd, CATALOG_MESSAGES_MODULE);
	const generated = catalogMessagesModule(source, descriptions);
	if (Result.isFailure(generated)) {
		return yield* new PluginMessagesError({ message: generated.failure.join("\n") });
	}
	const module = generated.success;
	const current = yield* fs.readFileString(modulePath).pipe(Effect.option);
	if (Option.getOrUndefined(current) !== module) {
		yield* fs.writeFileString(modulePath, module);
	}
	return { source, catalogs: Object.fromEntries(catalogs) } satisfies PluginMessages;
});
