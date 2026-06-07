import { randomUUID } from "node:crypto";

import { getPgClient } from "../setup";

export type SeededProviderScript = {
	slug: string;
	scriptId: string;
	entitySchemaScriptId: string | null;
};

// Seeds a builtin (global, user_id null) sandbox_script row directly via SQL, mirroring how the
// backend seeds real provider scripts at startup. This lets e2e tests exercise the provider-driven
// flows (search, details/import, populate, translate) against deterministic offline data instead of
// a live external API. Optionally links the script to an entity schema via entity_schema_script so it
// resolves as a provider for that schema (needed when a `details` result references it by slug).
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

// Removes everything a seeded provider script may have produced (global entities plus any
// relationship touching them), the schema link, then the script itself. Safe for afterAll/afterEach:
// all failures are swallowed so cleanup never masks a test failure.
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

// ─── Deterministic driver-code builders ──────────────────────────────────────
// Each builder emits a `driver("<kind>", ...)` registration returning fixed data with no network
// access. Concatenate several (join with "\n") to register multiple drivers in one script.

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

// Emits a `translate` driver that returns a fixed overlay for each language present in
// `translations` and an empty object (→ negative-cache, all-null overlay) for any other language.
// Always registering a translate driver keeps the "populate never triggers a premature translate"
// test honest: an erroneous translate enqueue would write an all-null overlay rather than error out.
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
