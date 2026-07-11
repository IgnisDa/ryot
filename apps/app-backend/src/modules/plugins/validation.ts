import {
	PluginManifest,
	type PluginManifest as PluginManifestValue,
	type PluginScript,
} from "@ryot/plugin-kit/manifest";
import { Cron, Data, Effect, Either, Schema } from "effect";

import {
	formatPropertyIssues,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema/property-schema-runtime";
import type { DefinitionSnapshot } from "#modules/definition-registry/service";

export class PluginValidationError extends Data.TaggedError("PluginValidationError")<{
	readonly issues: ReadonlyArray<string>;
}> {}

const fail = (issue: string) => new PluginValidationError({ issues: [issue] });

const assertSlug = (kind: string, slug: string) =>
	slug.includes("/") ? Effect.fail(fail(`${kind} slug cannot contain '/': ${slug}`)) : Effect.void;

const assertReference = (kind: string, slug: string, available: ReadonlySet<string>) =>
	available.has(slug)
		? Effect.void
		: Effect.fail(fail(`${kind} references missing definition: ${slug}`));

export const decodePluginManifest = (input: unknown) =>
	Schema.decodeUnknown(PluginManifest)(input).pipe(
		Effect.mapError((error) => new PluginValidationError({ issues: [String(error)] })),
	);

const canonicalRelativePosixPathIssue = (path: string) => {
	if (path.length === 0) {
		return "must not be empty";
	}
	if (path.startsWith("/")) {
		return "must be relative";
	}
	if (path.includes("\\")) {
		return "must use POSIX separators";
	}
	if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
		return "must not contain empty, '.', or '..' segments";
	}
	return null;
};

export const validatePluginSourcePaths = (
	files: Readonly<Record<string, string>>,
	scripts: PluginManifestValue["scripts"],
) =>
	Effect.gen(function* () {
		for (const path of Object.keys(files)) {
			const issue = canonicalRelativePosixPathIssue(path);
			if (issue) {
				return yield* fail(`Plugin file path '${path}' ${issue}`);
			}
		}
		for (const script of scripts) {
			const issue = canonicalRelativePosixPathIssue(script.entry);
			if (issue) {
				return yield* fail(`Plugin script entry '${script.entry}' ${issue}`);
			}
			if (!Object.hasOwn(files, script.entry)) {
				return yield* fail(`Plugin script entry is missing from files: ${script.entry}`);
			}
		}
		return yield* Effect.void;
	});

export const validatePluginManifestReferences = (
	manifest: PluginManifestValue,
	snapshot: DefinitionSnapshot,
) =>
	Effect.gen(function* () {
		const bootSlugs = new Set<string>();
		const cronSlugs = new Set<string>();
		const scriptSlugs = new Set<string>();
		const workflowSlugs = new Set<string>();
		const operationSlugs = new Set<string>();
		yield* assertSlug("plugin", manifest.metadata.slug);
		for (const definition of manifest.entitySchemas) {
			yield* assertSlug("entity schema", definition.slug);
			for (const eventSchema of definition.eventSchemas) {
				yield* assertSlug("event schema", eventSchema.slug);
			}
		}
		for (const definition of manifest.relationshipSchemas) {
			yield* assertSlug("relationship schema", definition.slug);
		}
		for (const definition of manifest.signalSchemas) {
			yield* assertSlug("signal schema", definition.slug);
		}
		for (const definition of manifest.savedViews) {
			yield* assertSlug("saved view", definition.slug);
		}
		for (const script of manifest.scripts) {
			yield* assertSlug("script", script.slug);
			if (scriptSlugs.has(script.slug)) {
				return yield* fail(`Duplicate script slug: ${script.slug}`);
			}
			scriptSlugs.add(script.slug);
		}
		for (const boot of manifest.boot) {
			yield* assertSlug("boot", boot.slug);
			if (bootSlugs.has(boot.slug)) {
				return yield* fail(`Duplicate boot slug: ${boot.slug}`);
			}
			bootSlugs.add(boot.slug);
			yield* assertReference("Boot", boot.scriptSlug, scriptSlugs);
		}
		for (const cron of manifest.crons) {
			yield* assertSlug("cron", cron.slug);
			if (cronSlugs.has(cron.slug)) {
				return yield* fail(`Duplicate cron slug: ${cron.slug}`);
			}
			cronSlugs.add(cron.slug);
			yield* assertReference("Cron", cron.scriptSlug, scriptSlugs);
			if (Either.isLeft(Cron.parse(cron.schedule))) {
				return yield* fail(`Cron ${cron.slug} has invalid schedule: ${cron.schedule}`);
			}
		}
		for (const operation of manifest.operations) {
			yield* assertSlug("operation", operation.slug);
			if (operationSlugs.has(operation.slug)) {
				return yield* fail(`Duplicate operation slug: ${operation.slug}`);
			}
			operationSlugs.add(operation.slug);
			yield* assertReference("Operation", operation.scriptSlug, scriptSlugs);
		}
		for (const workflow of manifest.workflows) {
			yield* assertSlug("workflow", workflow.slug);
			if (workflowSlugs.has(workflow.slug)) {
				return yield* fail(`Duplicate workflow slug: ${workflow.slug}`);
			}
			workflowSlugs.add(workflow.slug);
			yield* assertReference("Workflow", workflow.scriptSlug, scriptSlugs);
			if (manifest.scripts.find(({ slug }) => slug === workflow.scriptSlug)?.kind !== "workflow") {
				return yield* fail(
					`Workflow ${workflow.slug} script ${workflow.scriptSlug} must be a workflow script`,
				);
			}
		}

		const eventSchemaSlugs = new Set(
			Object.values(snapshot.entitySchemas).flatMap((entitySchema) =>
				Object.keys(entitySchema.eventSchemas).map(
					(eventSchemaSlug) => `${entitySchema.slug}:${eventSchemaSlug}`,
				),
			),
		);
		for (const binding of manifest.bindings.schemaProviderLinks) {
			yield* assertReference(
				"Schema provider binding",
				binding.entitySchemaSlug,
				new Set(Object.keys(snapshot.entitySchemas)),
			);
		}
		for (const binding of manifest.bindings.entityAutomations) {
			yield* assertReference("Entity automation", binding.scriptSlug, scriptSlugs);
			yield* assertReference(
				"Entity automation",
				binding.entitySchemaSlug,
				new Set(Object.keys(snapshot.entitySchemas)),
			);
		}
		for (const binding of manifest.bindings.relationshipAutomations) {
			yield* assertReference("Relationship automation", binding.scriptSlug, scriptSlugs);
			yield* assertReference(
				"Relationship automation",
				binding.relationshipSchemaSlug,
				new Set(Object.keys(snapshot.relationshipSchemas)),
			);
		}
		for (const binding of manifest.bindings.eventAutomations) {
			yield* assertReference("Event automation", binding.scriptSlug, scriptSlugs);
			yield* assertReference("Event automation", binding.eventSchemaSlug, eventSchemaSlugs);
		}
		for (const binding of manifest.bindings.signalAutomations) {
			yield* assertReference("Signal automation", binding.scriptSlug, scriptSlugs);
			yield* assertReference(
				"Signal automation",
				binding.signalSchemaSlug,
				new Set(Object.keys(snapshot.signalSchemas)),
			);
		}
		return yield* Effect.void;
	});

export const validateIntegrationProviderSettingsSchemas = (manifest: PluginManifestValue) =>
	Effect.forEach(
		manifest.integrationProviders,
		(provider) =>
			parseLabeledPropertySchemaInput(
				provider.settingsSchema,
				`Integration provider ${provider.slug} settings`,
			).pipe(
				Effect.mapError((error) =>
					fail(
						`Integration provider ${provider.slug} in plugin ${manifest.metadata.slug} has an invalid settingsSchema: ${formatPropertyIssues(error.issues)}`,
					),
				),
			),
		{ discard: true },
	);

export const validatePluginExecutableScripts = (plugin: {
	readonly manifest: PluginManifestValue;
	readonly scripts: ReadonlyArray<{
		readonly slug: string;
		readonly metadata: { readonly kind?: PluginScript["kind"] };
	}>;
}) =>
	Effect.gen(function* () {
		for (const operation of plugin.manifest.operations) {
			const script = plugin.scripts.find(({ slug }) => slug === operation.scriptSlug);
			if (!script) {
				return yield* fail(
					`Operation ${operation.slug} references missing compiled script: ${operation.scriptSlug}`,
				);
			}
			if (script.metadata.kind !== "operation") {
				return yield* fail(
					`Operation ${operation.slug} script ${operation.scriptSlug} must be an operation script`,
				);
			}
		}
		for (const workflow of plugin.manifest.workflows) {
			const script = plugin.scripts.find(({ slug }) => slug === workflow.scriptSlug);
			if (!script) {
				return yield* fail(
					`Workflow ${workflow.slug} references missing compiled script: ${workflow.scriptSlug}`,
				);
			}
			if (script.metadata.kind !== "workflow") {
				return yield* fail(
					`Workflow ${workflow.slug} script ${workflow.scriptSlug} must be a workflow script`,
				);
			}
		}
		return yield* Effect.void;
	});

type ScriptDescriptor = Pick<PluginScript, "kind" | "slug">;

export const validateSignalSchemaFormatterReferences = (
	snapshot: DefinitionSnapshot,
	pluginScripts: ReadonlyArray<ScriptDescriptor>,
	kernelScripts: ReadonlyArray<ScriptDescriptor>,
	kernelSignalSlugs: ReadonlySet<string>,
) =>
	Effect.gen(function* () {
		const scripts = [...pluginScripts, ...kernelScripts];
		const kernelScriptSlugs = new Set(kernelScripts.map(({ slug }) => slug));
		const scriptSlugs = new Set<string>();
		for (const script of scripts) {
			if (scriptSlugs.has(script.slug)) {
				return yield* fail(`Duplicate script slug: ${script.slug}`);
			}
			scriptSlugs.add(script.slug);
		}
		for (const signalSchema of Object.values(snapshot.signalSchemas)) {
			if (
				kernelScriptSlugs.has(signalSchema.notificationScriptSlug) &&
				!kernelSignalSlugs.has(signalSchema.slug)
			) {
				return yield* fail(
					`Signal schema ${signalSchema.slug} cannot reference kernel source-zero formatter: ${signalSchema.notificationScriptSlug}`,
				);
			}
			const matches = scripts.filter(({ slug }) => slug === signalSchema.notificationScriptSlug);
			if (matches.length === 0) {
				return yield* fail(
					`Signal schema ${signalSchema.slug} notification formatter references missing script: ${signalSchema.notificationScriptSlug}`,
				);
			}
			if (!matches.some(({ kind }) => kind === "automation")) {
				return yield* fail(
					`Signal schema ${signalSchema.slug} notification formatter ${signalSchema.notificationScriptSlug} must reference an automation script`,
				);
			}
		}
		return yield* Effect.void;
	});
