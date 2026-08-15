import { type PluginManifest, PluginScript } from "@ryot-app/contract/modules/plugins/manifest";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Match, Schema } from "effect";

import {
	type CompiledPluginSandboxEntry,
	compilePluginSandboxEntryPaths,
} from "./compiler-plugins";
import type { SandboxTypeScriptSources } from "./compiler-project";

export type PluginScriptMetadata = PluginScript extends infer Script
	? Script extends { readonly entry: string }
		? Omit<Script, "entry">
		: never
	: never;

export class PluginScriptCompileMismatch extends Schema.TaggedError<PluginScriptCompileMismatch>()(
	"PluginScriptCompileMismatch",
	{
		entry: Schema.String,
		reason: Schema.Literals(["missing-output", "metadata-mismatch", "provider-path"]),
	},
) {}

export const pluginScriptCompileMismatchIssue = (error: PluginScriptCompileMismatch) =>
	Match.value(error.reason).pipe(
		Match.when("missing-output", () => `Compiler returned no output for ${error.entry}`),
		Match.when("metadata-mismatch", () => `Declared script metadata does not match ${error.entry}`),
		Match.when(
			"provider-path",
			() =>
				`Provider script must live at backend/providers/<entity-schema>/<vendor>/<operation>.sandbox.ts: ${error.entry}`,
		),
		Match.exhaustive,
	);

export const declaredScriptMetadata = (script: PluginScript): PluginScriptMetadata => {
	if (script.kind === "script") {
		return {
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
			...(script.providerSlug ? { providerSlug: script.providerSlug } : {}),
		};
	}
	if (script.kind === "operation" || script.kind === "automation") {
		return {
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		};
	}
	if (script.kind === "workflow") {
		return {
			kind: "workflow",
			slug: script.slug,
			name: script.name,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		};
	}
	return {
		kind: "provider",
		slug: script.slug,
		name: script.name,
		capabilities: script.capabilities,
		providerSlug: script.providerSlug,
		providerOperation: script.providerOperation,
		requiredPluginConfigKeys: script.requiredPluginConfigKeys,
		requiredSystemConfigKeys: script.requiredSystemConfigKeys,
		...("searchOptionsSchema" in script && script.searchOptionsSchema
			? { searchOptionsSchema: script.searchOptionsSchema }
			: {}),
	};
};

const PLUGIN_SANDBOX_ENTRY_SUFFIX = ".sandbox.ts";

const PLUGIN_PROVIDER_ROOT = "backend/providers/";

export const pluginSandboxEntryPaths = (files: SandboxTypeScriptSources["files"]) =>
	Object.keys(files)
		.filter((path) => path.endsWith(PLUGIN_SANDBOX_ENTRY_SUFFIX))
		.sort();

const providerSlugForEntry = (entry: string) => {
	if (!entry.startsWith(PLUGIN_PROVIDER_ROOT)) {
		return undefined;
	}
	const segments = entry.slice(PLUGIN_PROVIDER_ROOT.length).split("/");
	return segments.length >= 2 ? segments.slice(0, -1).join(".") : undefined;
};

const derivedPluginScript = (
	output: CompiledPluginSandboxEntry,
): Effect.Effect<PluginScript, PluginScriptCompileMismatch> => {
	const manifest = output.compiled.manifest;
	const providerSlug = providerSlugForEntry(output.entry);
	const providerFields = Match.value(manifest.kind).pipe(
		Match.when("provider", () => ({
			providerSlug,
			providerOperation: output.providerOperation,
		})),
		Match.orElse(() => (providerSlug ? { providerSlug } : {})),
	);
	return Schema.decodeUnknownEffect(PluginScript)({
		...manifest,
		...providerFields,
		entry: output.entry,
	}).pipe(
		Effect.mapError(
			() => new PluginScriptCompileMismatch({ entry: output.entry, reason: "provider-path" }),
		),
	);
};

export const derivePluginSandboxScripts = Effect.fn("derivePluginSandboxScripts")(function* (
	files: SandboxTypeScriptSources["files"],
) {
	const compiled = yield* compilePluginSandboxEntryPaths(files, pluginSandboxEntryPaths(files));
	return yield* Effect.forEach(compiled, (output) =>
		derivedPluginScript(output).pipe(
			Effect.map((script) => ({ script, source: output.source, compiled: output.compiled })),
		),
	);
});

export const compilePluginManifestScripts = Effect.fn("compilePluginManifestScripts")(function* (
	manifest: PluginManifest,
	files: SandboxTypeScriptSources["files"],
) {
	const derived = yield* derivePluginSandboxScripts(files);
	const derivedByEntry = new Map(derived.map((output) => [output.script.entry, output]));
	return yield* Effect.forEach(manifest.scripts, (script) => {
		const output = derivedByEntry.get(script.entry);
		if (!output) {
			return Effect.fail(
				new PluginScriptCompileMismatch({ entry: script.entry, reason: "missing-output" }),
			);
		}
		if (stableStringify(script) !== stableStringify(output.script)) {
			return Effect.fail(
				new PluginScriptCompileMismatch({ entry: script.entry, reason: "metadata-mismatch" }),
			);
		}
		return Effect.succeed({ script, source: output.source, compiled: output.compiled });
	});
});
