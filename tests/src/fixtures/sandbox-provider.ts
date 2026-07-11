import { randomUUID } from "node:crypto";

import type { ProviderInformation } from "@ryot/sandbox-sdk/core";
import type {
	ProviderDetailsResult,
	ProviderSearchResult,
	ProviderTranslateResult,
} from "@ryot/sandbox-sdk/provider";
import { Effect } from "effect";

import type { Client } from "./auth";
import {
	installTestPlugin,
	reinstallTestPluginScript,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "./test-plugin";

export type InstalledProviderScript = InstalledTestPlugin;

export const installTestProvider = (input: {
	slug?: string;
	name?: string;
	client: Client;
	drivers: FakeProviderDrivers;
	linkToEntitySchemaSlug?: string;
	providerInformation?: ProviderInformation;
}) =>
	Effect.gen(function* () {
		const slug = input.slug ?? `e2e-provider-${randomUUID()}`;
		const name = input.name ?? "E2E Provider Script";
		const providerInformation = input.providerInformation ?? { source: "e2e" };
		const source = providerSandboxSource({
			name,
			slug,
			providerInformation,
			drivers: input.drivers,
		});
		return yield* installTestPlugin({
			source,
			linkToEntitySchemaSlug: input.linkToEntitySchemaSlug,
			script: {
				name,
				slug,
				kind: "provider",
				capabilities: [],
				providerInformation,
				requiredAppConfigKeys: [],
			},
		});
	});

export const uninstallTestProvider = (seeded: InstalledProviderScript) =>
	uninstallTestPlugin(seeded);

export const replaceSandboxScriptCompiledRepresentation = (
	_client: Client,
	targetScriptId: string,
	source: string,
) => {
	const metadata = providerMetadataBySource.get(source);
	if (!metadata) {
		return Effect.dieMessage("Replacement provider source was not built by providerSandboxSource");
	}
	return reinstallTestPluginScript(targetScriptId, source, metadata).pipe(Effect.asVoid);
};

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

const providerMetadataBySource = new Map<
	string,
	{
		name: string;
		slug: string;
		kind: "provider";
		capabilities: ReadonlyArray<string>;
		providerInformation: ProviderInformation;
		requiredAppConfigKeys: ReadonlyArray<string>;
	}
>();

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
		declarations.push(`const searchResult = Schema.decodeUnknownSync(providerSearchResultSchema)(JSON.parse(${JSON.stringify(
			JSON.stringify(input.drivers.search),
		)}));
const search = defineProviderDriver(manifest, "search", () => Effect.succeed(searchResult));`);
		driverEntries.push("search");
	}
	if (input.drivers.details) {
		providerImports.push("providerDetailsResultSchema");
		declarations.push(`const detailsResult = Schema.decodeUnknownSync(providerDetailsResultSchema)(JSON.parse(${JSON.stringify(
			JSON.stringify(input.drivers.details),
		)}));
const details = defineProviderDriver(manifest, "details", () => Effect.succeed(detailsResult));`);
		driverEntries.push("details");
	}
	if (input.drivers.translations) {
		providerImports.push("providerTranslateResultSchema");
		declarations.push(`const translations = Schema.decodeUnknownSync(
  Schema.Record({ key: Schema.String, value: providerTranslateResultSchema }),
)(
  JSON.parse(${JSON.stringify(JSON.stringify(input.drivers.translations))}),
);
const translate = defineProviderDriver(manifest, "translate", ({ language }) =>
  Effect.succeed(translations[language] ?? {}),
);`);
		driverEntries.push("translate");
	}
	if (driverEntries.length === 0) {
		throw new Error("Fake provider requires at least one driver");
	}

	const source = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { ${providerImports.join(", ")} } from "@ryot/sandbox-sdk/provider";

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
	providerMetadataBySource.set(source, {
		name: input.name,
		slug: input.slug,
		kind: "provider",
		capabilities: [],
		requiredAppConfigKeys: [],
		providerInformation: input.providerInformation,
	});
	return source;
}
