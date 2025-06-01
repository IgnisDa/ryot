import type { DbClient } from "~/lib/db";
import {
	authenticationBuiltinEntitySchemas,
	authenticationBuiltinRelationshipSchemas,
} from "~/modules/authentication/bootstrap/manifests";
import {
	ensureBuiltinEntitySchema,
	ensureBuiltinEntitySchemaEventSchemas,
	ensureBuiltinRelationshipSchema,
	ensureBuiltinSandboxScript,
	linkScriptToEntitySchema,
} from "./helpers";
import {
	builtinSandboxScripts,
	entitySchemaScriptLinks,
	personSchemaScriptLinks,
} from "./manifests";

export const seedInitialDatabase = async (database: DbClient) => {
	console.info("Seeding entity schemas...");

	await database.transaction(async (tx) => {
		const schemaIds = new Map<string, string>();
		for (const schema of authenticationBuiltinEntitySchemas()) {
			const schemaId = await ensureBuiltinEntitySchema({
				database: tx,
				slug: schema.slug,
				icon: schema.icon,
				name: schema.name,
				accentColor: schema.accentColor,
				propertiesSchema: schema.propertiesSchema,
			});
			await ensureBuiltinEntitySchemaEventSchemas({
				database: tx,
				entitySchemaId: schemaId,
				eventSchemas: schema.eventSchemas,
			});
			schemaIds.set(schema.slug, schemaId);
		}

		const scriptIds = new Map<string, string>();
		for (const script of builtinSandboxScripts()) {
			const scriptId = await ensureBuiltinSandboxScript({
				database: tx,
				code: script.code,
				name: script.name,
				slug: script.slug,
				metadata: script.metadata,
			});
			scriptIds.set(script.slug, scriptId);
		}

		for (const link of [
			...entitySchemaScriptLinks(),
			...personSchemaScriptLinks(),
		]) {
			const entitySchemaId = schemaIds.get(link.schemaSlug);
			const scriptId = scriptIds.get(link.scriptSlug);

			if (!entitySchemaId) {
				throw new Error(`Missing schema id for ${link.schemaSlug}`);
			}

			if (!scriptId) {
				throw new Error(`Missing script id for ${link.scriptSlug}`);
			}

			await linkScriptToEntitySchema({
				database: tx,
				entitySchemaId,
				sandboxScriptId: scriptId,
			});
		}

		console.info("Seeding relationship schemas...");

		for (const schema of authenticationBuiltinRelationshipSchemas()) {
			const sourceEntitySchemaId = schema.sourceEntitySchemaSlug
				? (schemaIds.get(schema.sourceEntitySchemaSlug) ??
					(() => {
						throw new Error(
							`Missing entity schema id for slug "${schema.sourceEntitySchemaSlug}" (relationship schema: "${schema.slug}")`,
						);
					})())
				: undefined;
			const targetEntitySchemaId = schema.targetEntitySchemaSlug
				? (schemaIds.get(schema.targetEntitySchemaSlug) ??
					(() => {
						throw new Error(
							`Missing entity schema id for slug "${schema.targetEntitySchemaSlug}" (relationship schema: "${schema.slug}")`,
						);
					})())
				: undefined;

			await ensureBuiltinRelationshipSchema({
				database: tx,
				slug: schema.slug,
				name: schema.name,
				sourceEntitySchemaId,
				targetEntitySchemaId,
				propertiesSchema: schema.propertiesSchema,
			});
		}
	});

	console.info("Entity schemas seeded successfully");
};
