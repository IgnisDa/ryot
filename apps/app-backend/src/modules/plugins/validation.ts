import {
	PluginManifest,
	type PluginManifest as PluginManifestValue,
} from "@ryot/plugin-kit/manifest";
import { Data, Effect, Schema } from "effect";

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

export const validatePluginManifestReferences = (
	manifest: PluginManifestValue,
	snapshot: DefinitionSnapshot,
) =>
	Effect.gen(function* () {
		const scriptSlugs = new Set<string>();
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
		for (const definition of manifest.trackers) {
			yield* assertSlug("tracker", definition.slug);
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

		const eventSchemaSlugs = new Set(
			Object.values(snapshot.entitySchemas).flatMap((entitySchema) =>
				Object.keys(entitySchema.eventSchemas).map(
					(eventSchemaSlug) => `${entitySchema.slug}:${eventSchemaSlug}`,
				),
			),
		);
		for (const binding of manifest.bindings.schemaScriptLinks) {
			yield* assertReference("Schema script binding", binding.scriptSlug, scriptSlugs);
			yield* assertReference(
				"Schema script binding",
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
