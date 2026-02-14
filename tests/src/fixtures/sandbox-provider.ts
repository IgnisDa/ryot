import { randomUUID } from "node:crypto";

import { getPgClient } from "../setup";

export type SeededProviderScript = {
	slug: string;
	scriptId: string;
	entitySchemaScriptId: string | null;
};

export async function seedBuiltinProviderScript(input: {
	code: string;
	slug?: string;
	name?: string;
	linkToEntitySchemaId?: string;
	metadata?: Record<string, unknown>;
}): Promise<SeededProviderScript> {
	const pg = getPgClient();
	const scriptId = randomUUID();
	const slug = input.slug ?? `e2e-provider-${scriptId}`;
	const name = input.name ?? "E2E Provider Script";

	await pg.query(
		`insert into sandbox_script (id, slug, name, code, is_builtin, metadata, user_id)
		 values ($1, $2, $3, $4, true, $5::jsonb, null)`,
		[scriptId, slug, name, input.code, JSON.stringify(input.metadata ?? {})],
	);

	let entitySchemaScriptId: string | null = null;
	if (input.linkToEntitySchemaId) {
		entitySchemaScriptId = randomUUID();
		await pg.query(
			`insert into entity_schema_sandbox_script (id, entity_schema_id, sandbox_script_id)
			 values ($1, $2, $3)`,
			[entitySchemaScriptId, input.linkToEntitySchemaId, scriptId],
		);
	}

	return { slug, scriptId, entitySchemaScriptId };
}

export async function cleanupBuiltinProviderScript(seeded: SeededProviderScript): Promise<void> {
	const pg = getPgClient();
	try {
		await pg.query(
			`delete from relationship r
			 using entity e
			 where (r.source_entity_id = e.id or r.target_entity_id = e.id)
			   and e.sandbox_script_id = $1`,
			[seeded.scriptId],
		);
		await pg.query(`delete from entity where sandbox_script_id = $1`, [seeded.scriptId]);
		if (seeded.entitySchemaScriptId) {
			await pg.query(`delete from entity_schema_sandbox_script where id = $1`, [
				seeded.entitySchemaScriptId,
			]);
		}
		await pg.query(`delete from sandbox_script where id = $1`, [seeded.scriptId]);
	} catch (error) {
		console.error("[sandbox-provider] cleanup failed (non-fatal)", error);
	}
}

export type FakeSearchItem = {
	title: string;
	externalId: string;
	subtitle?: number | null;
};

export function searchDriverCode(items: ReadonlyArray<FakeSearchItem>): string {
	const result = {
		items: items.map((item) => ({
			externalId: item.externalId,
			titleProperty: { kind: "text", value: item.title },
			...(item.subtitle === undefined
				? {}
				: {
						primarySubtitleProperty:
							item.subtitle === null
								? { kind: "null", value: null }
								: { kind: "number", value: item.subtitle },
					}),
		})),
	};
	return `driver("search", async function () { return ${JSON.stringify(result)}; });`;
}

export type FakeRelatedEntity = {
	name: string;
	externalId: string;
	scriptSlug: string;
	reverseDirection?: boolean;
	relationshipSchemaSlug?: string;
	relationshipProperties?: Record<string, unknown>;
};

export function detailsDriverCode(result: {
	name: string;
	properties?: Record<string, unknown>;
	relatedEntities?: ReadonlyArray<FakeRelatedEntity>;
}): string {
	const payload = {
		name: result.name,
		properties: result.properties ?? {},
		...(result.relatedEntities ? { relatedEntities: result.relatedEntities } : {}),
	};
	return `driver("details", async function () { return ${JSON.stringify(payload)}; });`;
}

export function translateDriverCode(
	translations: Record<
		string,
		{ name?: string | null; properties?: Record<string, unknown> | null }
	>,
): string {
	return `driver("translate", async function (context) {
	var translations = ${JSON.stringify(translations)};
	var language = context && context.language;
	if (language && Object.prototype.hasOwnProperty.call(translations, language)) {
		return translations[language];
	}
	return {};
});`;
}
