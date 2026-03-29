import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import { AutomationsService } from "#modules/automations/service";

import {
	builtinEventAutomationRuleLinks,
	builtinEntityAutomationRuleLinks,
	builtinRelationshipAutomationRuleLinks,
	builtinSandboxScripts,
	companySchemaSandboxScriptLinks,
	entitySchemaSandboxScriptLinks,
	fitnessSchemaSandboxScriptLinks,
	groupSchemaSandboxScriptLinks,
	personSchemaSandboxScriptLinks,
} from "./registry";

const ensureBuiltinSandboxScript = Effect.fn(function* (input: {
	name: string;
	slug: string;
	source: string;
	compiledCode: string;
	compiledFormat: number;
	manifest: Record<string, unknown>;
}) {
	const db = yield* CurrentDb;
	const [existing] = yield* dbEffect(() =>
		db
			.select({ id: schema.sandboxScript.id })
			.from(schema.sandboxScript)
			.where(and(eq(schema.sandboxScript.slug, input.slug), isNull(schema.sandboxScript.userId)))
			.limit(1),
	);
	const id = existing?.id ?? generateId();
	const values = {
		isBuiltin: true,
		name: input.name,
		source: input.source,
		metadata: input.manifest,
		compiledCode: input.compiledCode,
		compiledFormat: input.compiledFormat,
	};
	if (existing) {
		yield* dbEffect(() =>
			db.update(schema.sandboxScript).set(values).where(eq(schema.sandboxScript.id, id)),
		);
	} else {
		yield* dbEffect(() =>
			db.insert(schema.sandboxScript).values({ id, slug: input.slug, ...values }),
		);
	}
	return id;
});

const linkScriptToEntitySchema = Effect.fn(function* (input: {
	entitySchemaSlug: string;
	sandboxScriptId: string;
}) {
	const db = yield* CurrentDb;
	yield* dbEffect(() =>
		db.insert(schema.entitySchemaSandboxScript).values(input).onConflictDoNothing(),
	);
});

const seedScripts = Effect.gen(function* () {
	const scriptIds = new Map<string, string>();
	for (const script of builtinSandboxScripts()) {
		scriptIds.set(script.slug, yield* ensureBuiltinSandboxScript(script));
	}
	for (const link of [
		...entitySchemaSandboxScriptLinks(),
		...fitnessSchemaSandboxScriptLinks(),
		...companySchemaSandboxScriptLinks(),
		...personSchemaSandboxScriptLinks(),
		...groupSchemaSandboxScriptLinks(),
	]) {
		const scriptId = scriptIds.get(link.scriptSlug);
		if (!scriptId) {
			return yield* Effect.die(new Error(`Missing script id for ${link.scriptSlug}`));
		}
		yield* linkScriptToEntitySchema({
			entitySchemaSlug: link.schemaSlug,
			sandboxScriptId: scriptId,
		});
	}
	return scriptIds;
});

export class SeedService extends Effect.Service<SeedService>()("SeedService", {
	effect: Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		const automations = yield* AutomationsService;
		const scriptIds = yield* runner(seedScripts);
		for (const link of builtinEntityAutomationRuleLinks()) {
			const scriptId = scriptIds.get(link.scriptSlug);
			if (!scriptId) {
				return yield* Effect.die(new Error(`Missing script for ${link.name}`));
			}
			yield* automations.ensureBuiltin({
				name: link.name,
				kind: "subscription",
				operation: link.operation,
				sandboxScriptId: SandboxScriptId.make(scriptId),
				target: { id: EntitySchemaSlug.make(link.entitySchemaSlug), kind: "entity_schema" },
			});
		}
		for (const link of builtinEventAutomationRuleLinks()) {
			const scriptId = scriptIds.get(link.scriptSlug);
			if (!scriptId) {
				return yield* Effect.die(new Error(`Missing script for ${link.name}`));
			}
			yield* automations.ensureBuiltin({
				name: link.name,
				kind: link.kind,
				operation: "create",
				metadata: link.metadata,
				position: link.position,
				sandboxScriptId: SandboxScriptId.make(scriptId),
				target: { id: EventSchemaSlug.make(link.eventSchemaSlug), kind: "event_schema" },
			});
		}
		for (const link of builtinRelationshipAutomationRuleLinks()) {
			const scriptId = scriptIds.get(link.scriptSlug);
			if (!scriptId) {
				return yield* Effect.die(new Error(`Missing script for ${link.name}`));
			}
			yield* automations.ensureBuiltin({
				name: link.name,
				kind: "subscription",
				operation: link.operation,
				sandboxScriptId: SandboxScriptId.make(scriptId),
				target: {
					kind: "relationship_schema",
					id: RelationshipSchemaSlug.make(link.relationshipSchemaSlug),
				},
			});
		}
		return { done: true as const };
	}),
}) {}
