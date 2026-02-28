import {
	ensureBuiltinEntitySchema,
	ensureBuiltinSandboxScript,
	linkScriptPairToEntitySchema,
} from "./helpers";
import {
	builtinEntitySchemas,
	builtinSandboxScripts,
	entitySchemaScriptLinks,
} from "./manifests";

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const schemaIds = new Map<string, string>();
	for (const schema of builtinEntitySchemas()) {
		const schemaId = await ensureBuiltinEntitySchema({
			slug: schema.slug,
			name: schema.name,
			eventSchemas: schema.eventSchemas,
			propertiesSchema: schema.propertiesSchema,
		});
		schemaIds.set(schema.slug, schemaId);
	}

	const scriptIds = new Map<string, string>();
	for (const script of builtinSandboxScripts()) {
		const scriptId = await ensureBuiltinSandboxScript({
			code: script.code,
			name: script.name,
			slug: script.slug,
		});
		scriptIds.set(script.slug, scriptId);
	}

	for (const link of entitySchemaScriptLinks()) {
		const entitySchemaId = schemaIds.get(link.schemaSlug);
		const searchScriptId = scriptIds.get(link.searchScriptSlug);
		const detailsScriptId = scriptIds.get(link.detailsScriptSlug);

		if (!entitySchemaId)
			throw new Error(`Missing schema id for ${link.schemaSlug}`);

		if (!searchScriptId)
			throw new Error(`Missing search script id for ${link.searchScriptSlug}`);

		if (!detailsScriptId)
			throw new Error(
				`Missing details script id for ${link.detailsScriptSlug}`,
			);

		await linkScriptPairToEntitySchema({
			entitySchemaId,
			searchScriptId,
			detailsScriptId,
		});
	}

	console.info("Entity schemas seeded successfully");
};
