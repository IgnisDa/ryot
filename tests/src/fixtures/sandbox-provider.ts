import { randomUUID } from "node:crypto";

import type { ProviderInformation } from "@ryot/sandbox-sdk";
import type {
	ProviderDetailsResult,
	ProviderSearchResult,
	ProviderTranslateResult,
} from "@ryot/sandbox-sdk/provider";

import { getPgClient } from "../setup";
import type { Client } from "./auth";
import { createAndPromoteSandboxScript } from "./sandbox";

export type SeededProviderScript = {
	slug: string;
	scriptId: string;
	entitySchemaScriptId: string | null;
};

export async function seedBuiltinProviderScript(input: {
	slug?: string;
	name?: string;
	client: Client;
	drivers: FakeProviderDrivers;
	linkToEntitySchemaId?: string;
	providerInformation?: ProviderInformation;
}): Promise<SeededProviderScript> {
	const pg = getPgClient();
	const slug = input.slug ?? `e2e-provider-${randomUUID()}`;
	const name = input.name ?? "E2E Provider Script";
	const script = await createAndPromoteSandboxScript(
		input.client,
		providerSandboxSource({
			name,
			slug,
			drivers: input.drivers,
			providerInformation: input.providerInformation ?? { source: "e2e" },
		}),
	);
	const scriptId = script.id;

	let entitySchemaScriptId: string | null = null;
	if (input.linkToEntitySchemaId) {
		entitySchemaScriptId = randomUUID();
		try {
			await pg.query(
				`insert into entity_schema_sandbox_script (id, entity_schema_id, sandbox_script_id)
				 values ($1, $2, $3)`,
				[entitySchemaScriptId, input.linkToEntitySchemaId, scriptId],
			);
		} catch (error) {
			await pg
				.query(`delete from sandbox_script where id = $1`, [scriptId])
				.catch((cleanupError) => {
					console.error("[sandbox-provider] failed link cleanup", cleanupError);
				});
			throw error;
		}
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

type FakeSearchItem = { title: string; externalId: string; subtitle?: number | null };

export function fakeProviderSearchResult(
	items: ReadonlyArray<FakeSearchItem>,
): ProviderSearchResult {
	return {
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
}

export function fakeProviderDetailsResult(
	result: Pick<ProviderDetailsResult, "name"> &
		Partial<Pick<ProviderDetailsResult, "properties" | "relatedEntityGroups">>,
): ProviderDetailsResult {
	return {
		name: result.name,
		properties: result.properties ?? {},
		...(result.relatedEntityGroups ? { relatedEntityGroups: result.relatedEntityGroups } : {}),
	};
}

export function fakeProviderTranslations(
	translations: Record<string, ProviderTranslateResult>,
): Readonly<Record<string, ProviderTranslateResult>> {
	return translations;
}

type FakeProviderDrivers = {
	readonly details?: ProviderDetailsResult;
	readonly search?: ProviderSearchResult;
	readonly translations?: Readonly<Record<string, ProviderTranslateResult>>;
};

export function providerSandboxSource(input: {
	readonly name: string;
	readonly slug: string;
	readonly drivers: FakeProviderDrivers;
	readonly providerInformation: ProviderInformation;
}) {
	const declarations: string[] = [];
	const driverEntries: string[] = [];
	const providerImports = ["defineProvider", "defineProviderDriver"];

	if (input.drivers.search) {
		providerImports.push("providerSearchResultSchema");
		declarations.push(`const searchResult = providerSearchResultSchema.parse(JSON.parse(${JSON.stringify(
			JSON.stringify(input.drivers.search),
		)}));
const search = defineProviderDriver(manifest, "search", async () => searchResult);`);
		driverEntries.push("search");
	}
	if (input.drivers.details) {
		providerImports.push("providerDetailsResultSchema");
		declarations.push(`const detailsResult = providerDetailsResultSchema.parse(JSON.parse(${JSON.stringify(
			JSON.stringify(input.drivers.details),
		)}));
const details = defineProviderDriver(manifest, "details", async () => detailsResult);`);
		driverEntries.push("details");
	}
	if (input.drivers.translations) {
		providerImports.push("providerTranslateResultSchema");
		declarations.push(`const translations = z.record(z.string(), providerTranslateResultSchema).parse(
  JSON.parse(${JSON.stringify(JSON.stringify(input.drivers.translations))}),
);
const translate = defineProviderDriver(manifest, "translate", async ({ language }) =>
  translations[language] ?? {},
);`);
		driverEntries.push("translate");
	}
	if (driverEntries.length === 0) {
		throw new Error("Fake provider requires at least one driver");
	}

	return `
import { defineManifest } from "@ryot/sandbox-sdk";
import { ${providerImports.join(", ")} } from "@ryot/sandbox-sdk/provider";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "provider",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: [],
  requiredAppConfigKeys: [],
  providerInformation: ${JSON.stringify(input.providerInformation)},
});

${declarations.join("\n\n")}

export default defineProvider({
  manifest,
  drivers: { ${driverEntries.join(", ")} },
});
`;
}
