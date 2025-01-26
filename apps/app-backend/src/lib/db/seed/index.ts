import {
	ensureBuiltinEntitySchema,
	ensureBuiltinEntitySchemaEventSchemas,
	ensureBuiltinFacet,
	ensureBuiltinSandboxScript,
	linkScriptPairToEntitySchema,
} from "./helpers";
import {
	builtinEntitySchemas,
	builtinFacets,
	builtinSandboxScripts,
	entitySchemaScriptLinks,
} from "./manifests";

export const seedEntitySchemas = async () => {
	console.info("Seeding entity schemas...");

	const facetIds = new Map<string, string>();
	for (const facet of builtinFacets()) {
		const facetId = await ensureBuiltinFacet({
			slug: facet.slug,
			name: facet.name,
			mode: facet.mode,
			description: facet.description,
		});
		facetIds.set(facet.slug, facetId);
	}

	const schemaIds = new Map<string, string>();
	for (const schema of builtinEntitySchemas()) {
		const facetId = facetIds.get(schema.facetSlug);
		if (!facetId) throw new Error(`Missing facet id for schema ${schema.slug}`);

		const schemaId = await ensureBuiltinEntitySchema({
			facetId,
			slug: schema.slug,
			name: schema.name,
			propertiesSchema: schema.propertiesSchema,
		});
		await ensureBuiltinEntitySchemaEventSchemas({
			entitySchemaId: schemaId,
			eventSchemas: schema.eventSchemas,
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
