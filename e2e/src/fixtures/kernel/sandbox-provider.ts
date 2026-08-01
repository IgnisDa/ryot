import { randomUUID } from "node:crypto";

import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type {
	ProviderDetailsResult,
	ProviderResolveResult,
	ProviderSearchResult,
	ProviderSearchOptionsResult,
	ProviderTranslateResult,
} from "@ryot-app/sandbox-sdk/provider";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import {
	installTestPluginBundle,
	reinstallTestPluginScript,
	type InstalledTestPlugin,
	type TestPluginScript,
	uninstallTestPlugin,
} from "./test-plugin";

type PluginProviderInformation = PluginManifest["providers"][number]["information"];
type ProviderOperation = Extract<
	PluginManifest["scripts"][number],
	{ kind: "provider" }
>["providerOperation"];
type ProviderOperationResult =
	| ProviderDetailsResult
	| ProviderSearchOptionsResult
	| ProviderSearchResult
	| ProviderResolveResult
	| Readonly<Record<string, ProviderTranslateResult>>;

export type InstalledTestProvider = Omit<InstalledTestPlugin, "scriptId" | "slug"> & {
	providerSlug: string;
	providerId: SandboxProviderId;
	detailsScriptId: SandboxScriptId;
	searchScriptId?: SandboxScriptId;
	resolveScriptId?: SandboxScriptId;
	translateScriptId?: SandboxScriptId;
	searchOptionsScriptId?: SandboxScriptId;
};

export const installTestProvider = (input: {
	slug?: string;
	name?: string;
	client: Client;
	scope?: "system";
	pluginSlug?: string;
	detailsDelayMs?: number;
	rootEntitySchemaSlug: string;
	search?: ProviderSearchResult;
	searchOptionsFailure?: string;
	details: ProviderDetailsResult;
	resolve?: ProviderResolveResult;
	searchOptionsSchema?: AppSchema;
	information?: PluginProviderInformation;
	savedViews?: PluginManifest["savedViews"];
	searchOptions?: ProviderSearchOptionsResult;
	entitySchemas?: PluginManifest["entitySchemas"];
	relationshipSchemas?: PluginManifest["relationshipSchemas"];
	translations?: Readonly<Record<string, ProviderTranslateResult>>;
}) =>
	Effect.gen(function* () {
		const name = input.name ?? "E2E Provider Script";
		const information = input.information ?? { source: "e2e" };
		const providerSlug = input.slug ?? `e2e-provider-${randomUUID()}`;
		const operations: Array<{
			delayMs?: number;
			executionFailure?: string;
			operation: ProviderOperation;
			result: ProviderOperationResult;
		}> = [{ operation: "details", result: input.details, delayMs: input.detailsDelayMs }];
		if (input.search) {
			operations.push({ operation: "search", result: input.search });
		}
		if (input.searchOptions !== undefined || input.searchOptionsFailure !== undefined) {
			operations.push({
				operation: "search-options",
				executionFailure: input.searchOptionsFailure,
				result: input.searchOptions ?? { sources: {} },
			});
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
				providerSlug,
				capabilities: [],
				kind: "provider" as const,
				providerOperation: operation,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: `${name} ${operation}`,
				entry: `backend/providers/${providerSlug}/${operation}.sandbox.ts`,
				...(operation === "search" && input.searchOptionsSchema !== undefined
					? { searchOptionsSchema: input.searchOptionsSchema }
					: {}),
			};
		});
		const files = Object.fromEntries(
			scripts.map((script) => {
				const operationDefinition = operations.find(
					({ operation }) => operation === script.providerOperation,
				);
				return [
					script.entry,
					providerSandboxSource({
						name: script.name,
						slug: script.slug,
						operation: script.providerOperation,
						delayMs: operationDefinition?.delayMs,
						result: operationDefinition?.result ?? input.details,
						...(operationDefinition?.executionFailure !== undefined
							? { executionFailure: operationDefinition.executionFailure }
							: {}),
						...(script.providerOperation === "search" && input.searchOptionsSchema !== undefined
							? { searchOptionsSchema: input.searchOptionsSchema }
							: {}),
					}),
				];
			}),
		);
		const providerOperations = {
			details: `${providerSlug}.details`,
			...(input.search ? { search: `${providerSlug}.search` } : {}),
			...(input.resolve ? { resolve: `${providerSlug}.resolve` } : {}),
			...(input.translations ? { translate: `${providerSlug}.translate` } : {}),
			...(input.searchOptions !== undefined || input.searchOptionsFailure !== undefined
				? { searchOptions: `${providerSlug}.search-options` }
				: {}),
		};
		const common = {
			files,
			scripts,
			pluginSlug: input.pluginSlug,
			savedViews: input.savedViews,
			entitySchemas: input.entitySchemas,
			relationshipSchemas: input.relationshipSchemas,
			providers: [
				{
					name,
					information,
					slug: providerSlug,
					operations: providerOperations,
					rootEntitySchemaSlug: input.rootEntitySchemaSlug,
				},
			],
		};
		const installed = yield* installTestPluginBundle(
			input.scope === "system"
				? { scope: "system", ...common }
				: { client: input.client, ...common },
		);
		const detailsScriptId = installed.scriptIds[`${providerSlug}.details`];
		if (!detailsScriptId) {
			return yield* Effect.die(new Error("Installed provider details script was not found"));
		}
		const storedScripts = yield* Effect.all(
			Object.values(installed.scriptIds).map((scriptId) =>
				getApiClient().call(
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
			searchOptionsScriptId: installed.scriptIds[`${providerSlug}.search-options`],
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

type FakeSearchItem = Pick<
	ProviderSearchResult["items"][number],
	"externalId" | "metadata" | "title"
>;

export function fakeProviderSearchResult(
	items: ReadonlyArray<FakeSearchItem>,
): ProviderSearchResult {
	return { items };
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
	readonly delayMs?: number;
	readonly executionFailure?: string;
	readonly operation: ProviderOperation;
	readonly result: ProviderOperationResult;
	readonly searchOptionsSchema?: AppSchema;
}) {
	const resultSchemaByOperation = {
		search: "providerSearchResultSchema",
		details: "providerDetailsResultSchema",
		resolve: "providerResolveResultSchema",
		translate: "providerTranslateResultSchema",
		"search-options": "providerSearchOptionsResultSchema",
	} as const satisfies Record<ProviderOperation, string>;
	const resultSchema = resultSchemaByOperation[input.operation];
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
	let run: string;
	if (input.executionFailure !== undefined) {
		run = `() => Effect.die(${JSON.stringify(input.executionFailure)})`;
	} else if (isTranslate) {
		run = "({ language }) => Effect.succeed(translations[language] ?? {})";
	} else {
		run =
			input.delayMs === undefined
				? "() => Effect.succeed(result)"
				: `() => Effect.sleep(${JSON.stringify(`${input.delayMs} millis`)}).pipe(Effect.as(result))`;
	}
	const searchOptionsSchema =
		input.searchOptionsSchema === undefined
			? ""
			: `\n  searchOptionsSchema: ${JSON.stringify(input.searchOptionsSchema)},`;

	const source = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider, ${isTranslate ? "providerTranslateResultSchema" : resultSchema} } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
${searchOptionsSchema}
});

${declarations}

export default defineProvider({
  manifest,
  run: ${run},
  operation: ${JSON.stringify(input.operation)},
});
`;
	providerMetadataBySource.set(source, {
		name: input.name,
		slug: input.slug,
		kind: "provider",
		capabilities: [],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		providerOperation: input.operation,
		providerSlug: input.slug.slice(0, -(input.operation.length + 1)),
	});
	return source;
}
