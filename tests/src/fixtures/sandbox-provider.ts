import { randomUUID } from "node:crypto";

import type { ContractPayload } from "@ryot/contract/client";
import type { SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import type {
	ProviderDetailsResult,
	ProviderResolveResult,
	ProviderSearchResult,
	ProviderTranslateResult,
} from "@ryot/sandbox-sdk/provider";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import {
	installTestPluginBundle,
	reinstallTestPluginScript,
	type InstalledTestPlugin,
	type TestPluginScript,
	uninstallTestPlugin,
} from "./test-plugin";

type PluginManifest = ContractPayload<"plugins", "install">["manifest"];
type PluginProviderInformation = PluginManifest["providers"][number]["information"];

export type InstalledTestProvider = Omit<InstalledTestPlugin, "scriptId" | "slug"> & {
	providerId: SandboxProviderId;
	providerSlug: string;
	detailsScriptId: SandboxScriptId;
	searchScriptId?: SandboxScriptId;
	resolveScriptId?: SandboxScriptId;
	translateScriptId?: SandboxScriptId;
};

export const installTestProvider = (input: {
	slug?: string;
	name?: string;
	client: Client;
	details: ProviderDetailsResult;
	search?: ProviderSearchResult;
	resolve?: ProviderResolveResult;
	translations?: Readonly<Record<string, ProviderTranslateResult>>;
	linkToEntitySchemaSlug?: string;
	information?: PluginProviderInformation;
}) =>
	Effect.gen(function* () {
		const providerSlug = input.slug ?? `e2e-provider-${randomUUID()}`;
		const name = input.name ?? "E2E Provider Script";
		const information = input.information ?? { source: "e2e" };
		const operations: Array<{
			operation: "details" | "search" | "resolve" | "translate";
			result:
				| ProviderDetailsResult
				| ProviderSearchResult
				| ProviderResolveResult
				| Readonly<Record<string, ProviderTranslateResult>>;
		}> = [{ operation: "details", result: input.details }];
		if (input.search) {
			operations.push({ operation: "search", result: input.search });
		}
		if (input.resolve) {
			operations.push({ operation: "resolve", result: input.resolve });
		}
		if (input.translations) {
			operations.push({ operation: "translate", result: input.translations });
		}
		const scripts = operations.map(({ operation }) => {
			const slug = `${providerSlug}.${operation}`;
			return {
				slug,
				entry: `scripts/${slug}.sandbox.ts`,
				kind: "provider" as const,
				name: `${name} ${operation}`,
				providerSlug,
				capabilities: [],
				providerOperation: operation,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			};
		});
		const files = Object.fromEntries(
			scripts.map((script) => [
				script.entry,
				providerSandboxSource({
					name: script.name,
					slug: script.slug,
					operation: script.providerOperation,
					result:
						operations.find(({ operation }) => operation === script.providerOperation)?.result ??
						input.details,
				}),
			]),
		);
		const providerOperations = {
			details: `${providerSlug}.details`,
			...(input.search ? { search: `${providerSlug}.search` } : {}),
			...(input.resolve ? { resolve: `${providerSlug}.resolve` } : {}),
			...(input.translations ? { translate: `${providerSlug}.translate` } : {}),
		};
		const installed = yield* installTestPluginBundle({
			files,
			scripts,
			linkToEntitySchemaSlug: input.linkToEntitySchemaSlug,
			providers: [
				{
					name,
					slug: providerSlug,
					information,
					operations: providerOperations,
				},
			],
		});
		const detailsScriptId = installed.scriptIds[`${providerSlug}.details`];
		if (!detailsScriptId) {
			return yield* Effect.die(new Error("Installed provider details script was not found"));
		}
		const storedScripts = yield* Effect.all(
			Object.values(installed.scriptIds).map((scriptId) =>
				getBackendClient().call(
					(c) => c.testSupport.getSandboxScript({ params: { scriptId } }),
					adminHeaders,
				),
			),
		);
		const providerId = storedScripts.find((script) => script.id === detailsScriptId)?.providerId;
		if (!providerId) {
			return yield* Effect.die(new Error("Installed provider ID was not returned by test support"));
		}
		if (storedScripts.some((script) => script.providerId !== providerId)) {
			return yield* Effect.die(
				new Error("Installed provider operation scripts do not share one provider ID"),
			);
		}
		return {
			...installed,
			providerId,
			providerSlug,
			detailsScriptId,
			searchScriptId: installed.scriptIds[`${providerSlug}.search`],
			resolveScriptId: installed.scriptIds[`${providerSlug}.resolve`],
			translateScriptId: installed.scriptIds[`${providerSlug}.translate`],
		};
	});

export const uninstallTestProvider = (seeded: InstalledTestProvider) =>
	uninstallTestPlugin({ ...seeded, scriptId: seeded.detailsScriptId, slug: seeded.providerSlug });

export const replaceSandboxScriptCompiledRepresentation = (
	_client: Client,
	targetScriptId: string,
	source: string,
) => {
	const metadata = providerMetadataBySource.get(source);
	if (!metadata) {
		return Effect.die(
			new Error("Replacement provider source was not built by providerSandboxSource"),
		);
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

const providerMetadataBySource = new Map<string, Extract<TestPluginScript, { kind: "provider" }>>();

export function providerSandboxSource(input: {
	readonly name: string;
	readonly slug: string;
	readonly operation: "details" | "search" | "resolve" | "translate";
	readonly result:
		| ProviderDetailsResult
		| ProviderSearchResult
		| ProviderResolveResult
		| Readonly<Record<string, ProviderTranslateResult>>;
}) {
	const resultSchema = `provider${input.operation[0]?.toUpperCase()}${input.operation.slice(1)}ResultSchema`;
	const isTranslate = input.operation === "translate";
	const declarations = isTranslate
		? `const translations = Schema.decodeSync(
  Schema.Record(Schema.String, providerTranslateResultSchema),
)(
  JSON.parse(${JSON.stringify(JSON.stringify(input.result))}),
);`
		: `const result = Schema.decodeSync(${resultSchema})(
  JSON.parse(${JSON.stringify(JSON.stringify(input.result))}),
);`;
	const run = isTranslate
		? "({ language }) => Effect.succeed(translations[language] ?? {})"
		: "() => Effect.succeed(result)";

	const source = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineProvider, ${isTranslate ? "providerTranslateResultSchema" : resultSchema} } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

${declarations}

export default defineProvider({
  manifest,
  operation: ${JSON.stringify(input.operation)},
  run: ${run},
});
`;
	providerMetadataBySource.set(source, {
		name: input.name,
		slug: input.slug,
		kind: "provider",
		providerSlug: input.slug.slice(0, -(input.operation.length + 1)),
		providerOperation: input.operation,
		capabilities: [],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	});
	return source;
}
