import type { PluginManifest, PluginScript } from "@ryot-app/contract/modules/plugins/manifest";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Match, Schema } from "effect";

import { compilePluginSandboxSourceEntries } from "./compiler-plugins";
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
		reason: Schema.Literals(["missing-output", "metadata-mismatch"]),
	},
) {}

export const pluginScriptCompileMismatchIssue = (error: PluginScriptCompileMismatch) =>
	Match.value(error.reason).pipe(
		Match.when("missing-output", () => `Compiler returned no output for ${error.entry}`),
		Match.when("metadata-mismatch", () => `Declared script metadata does not match ${error.entry}`),
		Match.exhaustive,
	);

export const pluginSandboxScriptEntries = (scripts: PluginManifest["scripts"]) =>
	scripts.map((script) => {
		if (script.kind === "script") {
			const { providerSlug, ...genericScript } = script;
			return providerSlug ? { ...genericScript, providerSlug } : genericScript;
		}
		return script;
	});

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

const compiledScriptMetadata = (script: PluginScript) => {
	if (script.kind === "script") {
		const { entry: _entry, providerSlug: _providerSlug, ...compiledMetadata } = script;
		return compiledMetadata;
	}
	if (script.kind !== "provider") {
		return declaredScriptMetadata(script);
	}
	const {
		entry: _entry,
		providerSlug: _providerSlug,
		providerOperation: _providerOperation,
		...compiledMetadata
	} = script;
	return compiledMetadata;
};

export const compilePluginManifestScripts = Effect.fn("compilePluginManifestScripts")(function* (
	manifest: PluginManifest,
	files: SandboxTypeScriptSources["files"],
) {
	const compiled = yield* compilePluginSandboxSourceEntries(
		files,
		pluginSandboxScriptEntries(manifest.scripts),
	);
	const compiledByEntry = new Map(compiled.map((output) => [output.entry, output]));
	return yield* Effect.forEach(manifest.scripts, (script) => {
		const output = compiledByEntry.get(script.entry);
		if (!output) {
			return Effect.fail(
				new PluginScriptCompileMismatch({ entry: script.entry, reason: "missing-output" }),
			);
		}
		if (
			stableStringify(compiledScriptMetadata(script)) !== stableStringify(output.compiled.manifest)
		) {
			return Effect.fail(
				new PluginScriptCompileMismatch({ entry: script.entry, reason: "metadata-mismatch" }),
			);
		}
		return Effect.succeed({ script, source: output.source, compiled: output.compiled });
	});
});
