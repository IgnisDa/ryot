import { randomUUID } from "node:crypto";

import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import type { ProviderInformation } from "@ryot/sandbox-sdk/core";
import type {
	ProviderDetailsResult,
	ProviderSearchResult,
	ProviderTranslateResult,
} from "@ryot/sandbox-sdk/provider";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { createAndPromoteSandboxScript } from "./sandbox";

export type SeededProviderScript = {
	slug: string;
	scriptId: string;
	entitySchemaScriptId: string | null;
};

export const seedBuiltinProviderScript = (input: {
	slug?: string;
	name?: string;
	client: Client;
	drivers: FakeProviderDrivers;
	linkToEntitySchemaId?: string;
	providerInformation?: ProviderInformation;
}) =>
	Effect.gen(function* () {
		const backend = getBackendClient();
		const slug = input.slug ?? `e2e-provider-${randomUUID()}`;
		const name = input.name ?? "E2E Provider Script";
		const script = yield* createAndPromoteSandboxScript(
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
			const entitySchemaId = EntitySchemaId.make(input.linkToEntitySchemaId);
			entitySchemaScriptId = yield* Effect.gen(function* () {
				const link = yield* backend.call(
					(c) =>
						c.testSupport.linkSandboxScriptToEntitySchema({
							path: {
								scriptId: SandboxScriptId.make(scriptId),
								entitySchemaId,
							},
						}),
					adminHeaders,
				);
				const repeatedLink = yield* backend.call(
					(c) =>
						c.testSupport.linkSandboxScriptToEntitySchema({
							path: { scriptId: SandboxScriptId.make(scriptId), entitySchemaId },
						}),
					adminHeaders,
				);
				if (repeatedLink.id !== link.id) {
					throw new Error("Repeated sandbox script link returned a different row");
				}
				return link.id;
			}).pipe(
				Effect.onError(() =>
					backend
						.call(
							(c) =>
								c.testSupport.deleteSandboxScript({
									path: { scriptId: SandboxScriptId.make(scriptId) },
								}),
							adminHeaders,
						)
						.pipe(
							Effect.catchAll((cleanupError) =>
								Effect.logError("[sandbox-provider] failed link cleanup", cleanupError),
							),
						),
				),
			);
		}

		return { slug, scriptId, entitySchemaScriptId };
	});

export const cleanupBuiltinProviderScript = (seeded: SeededProviderScript) =>
	getBackendClient()
		.call(
			(c) =>
				c.testSupport.deleteSandboxScript({
					path: { scriptId: SandboxScriptId.make(seeded.scriptId) },
				}),
			adminHeaders,
		)
		.pipe(
			Effect.catchAll((error) =>
				Effect.logError("[sandbox-provider] cleanup failed (non-fatal)", error),
			),
		);

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
		Partial<Pick<ProviderDetailsResult, "childEntities" | "properties" | "relatedEntityGroups">>,
): ProviderDetailsResult {
	return {
		name: result.name,
		properties: result.properties ?? {},
		...(result.childEntities ? { childEntities: result.childEntities } : {}),
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
import { defineManifest } from "@ryot/sandbox-sdk/core";
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
