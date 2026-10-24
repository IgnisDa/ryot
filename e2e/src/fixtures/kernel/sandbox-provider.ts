import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	type PluginPackageId,
	pluginPackageSegments,
	type SandboxProviderId,
	type SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import type {
	ProviderDetailsResult,
	ProviderRelatedResult,
	ProviderResolveResult,
	ProviderSearchOptionsResult,
	ProviderSearchResult,
	ProviderTranslateResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { Effect, Record } from "effect";

import { requirePresent } from "~/support/assertions";
import { getSharedHarnessTarget, type HarnessTarget } from "~/support/harness-target";

import { listAdminSandboxScripts } from "./admin-sandbox-scripts";
import { listAdminSystemPlugins } from "./admin-system-plugins";
import type { Client } from "./auth";
import { compilePluginPackage } from "./compiled-package";
import {
	encodePluginSourceFiles,
	type InstalledTestPlugin,
	installTestPluginBundle,
	reinstallTestPluginScript,
	testPluginEntitySchema,
	testPluginManifest,
	type TestPluginScript,
	uninstallTestPlugin,
	updateTestSupportSystemPlugin,
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
	| Readonly<Record<string, ProviderRelatedResult>>
	| Readonly<Record<string, ProviderTranslateResult>>;

export type InstalledTestProvider = Omit<InstalledTestPlugin, "scriptId" | "slug"> & {
	providerSlug: string;
	providerId: SandboxProviderId;
	detailsScriptId: SandboxScriptId;
	searchScriptId?: SandboxScriptId;
	resolveScriptId?: SandboxScriptId;
	relatedScriptId?: SandboxScriptId;
	translateScriptId?: SandboxScriptId;
	searchOptionsScriptId?: SandboxScriptId;
};

export type AttachedTestProvider = Pick<
	InstalledTestProvider,
	| "pluginId"
	| "providerId"
	| "providerSlug"
	| "searchScriptId"
	| "detailsScriptId"
	| "resolveScriptId"
	| "translateScriptId"
	| "searchOptionsScriptId"
>;

type HttpCalls = { readonly url: string; readonly count: number };

type TestProviderSpec = {
	slug?: string;
	name?: string;
	detailsDelayMs?: number;
	rootEntitySchemaSlug: string;
	search?: ProviderSearchResult;
	searchOptionsFailure?: string;
	details: ProviderDetailsResult;
	resolve?: ProviderResolveResult;
	searchOptionsSchema?: AppSchema;
	detailsFailure?: string | undefined;
	detailsHttpCalls?: HttpCalls;
	information?: PluginProviderInformation;
	searchOptions?: ProviderSearchOptionsResult;
	relatedPages?: Readonly<Record<string, ProviderRelatedResult>>;
	translations?: Readonly<Record<string, ProviderTranslateResult>>;
};

type TestProviderPlugin = {
	client: Client;
	scope?: "system";
	pluginSlug?: string;
	savedViews?: PluginManifest["savedViews"];
	entitySchemas?: PluginManifest["entitySchemas"];
	relationshipSchemas?: PluginManifest["relationshipSchemas"];
};

type TestPluginManifestInput = Parameters<typeof testPluginManifest>[0];

type TestProviderDeclaration = {
	readonly files: Readonly<Record<string, string>>;
	readonly scripts: NonNullable<TestPluginManifestInput["scripts"]>;
	readonly provider: NonNullable<TestPluginManifestInput["providers"]>[number];
};

const testProviderDeclaration = (input: TestProviderSpec): TestProviderDeclaration => {
	const name = input.name ?? "E2E Provider Script";
	const providerSlug = input.slug ?? `e2e-provider-${crypto.randomUUID()}`;
	const operations: Array<{
		delayMs?: number;
		httpCalls?: HttpCalls;
		executionFailure?: string;
		operation: ProviderOperation;
		result: ProviderOperationResult;
	}> = [
		{
			operation: "details",
			result: input.details,
			delayMs: input.detailsDelayMs,
			...(input.detailsFailure === undefined ? {} : { executionFailure: input.detailsFailure }),
			...(input.detailsHttpCalls === undefined ? {} : { httpCalls: input.detailsHttpCalls }),
		},
	];
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
	if (input.relatedPages) {
		operations.push({ operation: "related", result: input.relatedPages });
	}
	if (input.translations) {
		operations.push({ operation: "translate", result: input.translations });
	}
	const scripts = operations.map(({ operation, httpCalls }) => {
		const slug = `${providerSlug}.${operation}`;
		return {
			slug,
			providerSlug,
			kind: "provider" as const,
			providerOperation: operation,
			requiredPluginConfigKeys: [],
			name: `${name} ${operation}`,
			capabilities: httpCalls === undefined ? [] : ["httpCall" as const],
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
					...(operationDefinition?.httpCalls === undefined
						? {}
						: { httpCalls: operationDefinition.httpCalls }),
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
	const provider = {
		name,
		slug: providerSlug,
		rootEntitySchemaSlug: input.rootEntitySchemaSlug,
		information: input.information ?? { source: "e2e" },
	};
	return { files, scripts, provider };
};

const resolveTestProviders = <Key extends string>(
	declarations: Readonly<Record<Key, ReturnType<typeof testProviderDeclaration>>>,
	installed: {
		readonly target: HarnessTarget;
		readonly activePluginRevisionId: string;
		readonly scriptIds: Readonly<Record<string, SandboxScriptId>>;
	},
) =>
	listAdminSandboxScripts(installed.activePluginRevisionId, installed.target).pipe(
		Effect.map((storedScripts) =>
			Record.map(declarations, ({ provider: { slug: providerSlug } }) => {
				const scriptId = (operation: string) => installed.scriptIds[`${providerSlug}.${operation}`];
				const detailsScriptId = requirePresent(
					scriptId("details"),
					`Provider '${providerSlug}' details script was not installed`,
				);
				const providerScripts = storedScripts.filter(({ slug }) =>
					slug.startsWith(`${providerSlug}.`),
				);
				const providerId = requirePresent(
					providerScripts.find(({ id }) => id === detailsScriptId)?.providerId,
					`Provider '${providerSlug}' ID was not returned by test support`,
				);
				if (providerScripts.some((script) => script.providerId !== providerId)) {
					throw new Error(`Provider '${providerSlug}' scripts do not share one provider ID`);
				}
				return {
					providerId,
					providerSlug,
					detailsScriptId,
					searchScriptId: scriptId("search"),
					resolveScriptId: scriptId("resolve"),
					relatedScriptId: scriptId("related"),
					translateScriptId: scriptId("translate"),
					searchOptionsScriptId: scriptId("search-options"),
				};
			}),
		),
	);

export const installTestProviders = <Key extends string>(
	input: TestProviderPlugin & { providers: Readonly<Record<Key, TestProviderSpec>> },
) =>
	Effect.gen(function* () {
		const declarations = Record.map(input.providers, testProviderDeclaration);
		const common = {
			pluginSlug: input.pluginSlug,
			savedViews: input.savedViews,
			relationshipSchemas: input.relationshipSchemas,
			scripts: Record.values(declarations).flatMap(({ scripts }) => scripts),
			providers: Record.values(declarations).map(({ provider }) => provider),
			files: Object.assign({}, ...Record.values(declarations).map(({ files }) => files)),
			entitySchemas:
				input.entitySchemas ??
				[
					...new Set(
						Record.values(declarations).map(({ provider }) => provider.rootEntitySchemaSlug),
					),
				].map((slug) => testPluginEntitySchema({ slug })),
		};
		const installed = yield* installTestPluginBundle(
			input.scope === "system"
				? { scope: "system", target: input.client.target, ...common }
				: { client: input.client, ...common },
		);
		const providers = yield* resolveTestProviders(declarations, installed);
		return Record.map(providers, (provider): InstalledTestProvider => ({
			...installed,
			...provider,
		}));
	});

export const shippedPluginTestProviders = (
	packageId: PluginPackageId,
	target = getSharedHarnessTarget(),
) =>
	Effect.gen(function* () {
		const archiveUrl = new URL(
			`../../../../plugins/${pluginPackageSegments(packageId).name}/dist/${packageId}.zip`,
			import.meta.url,
		);
		const shipped = yield* readPluginArchive(
			yield* Effect.promise(() => Bun.file(archiveUrl).bytes()),
		);
		const pluginId = requirePresent(
			(yield* listAdminSystemPlugins(target)).find((plugin) => plugin.packageId === packageId),
			`Shipped plugin '${packageId}' is not installed`,
		).id;
		const specs = new Map<string, TestProviderSpec>();
		const attached = new Map<string, TestProviderDeclaration>();
		const publish = Effect.gen(function* () {
			const declarations = Record.fromEntries(attached);
			const compiled = yield* compilePluginPackage({
				files: encodePluginSourceFiles(
					Object.assign({}, ...Record.values(declarations).map(({ files }) => files)),
				),
				manifest: testPluginManifest({
					pluginSlug: `attached-providers-${crypto.randomUUID()}`,
					scripts: Record.values(declarations).flatMap(({ scripts }) => scripts),
					providers: Record.values(declarations).map(({ provider }) => provider),
					entitySchemas: [
						...new Set(
							Record.values(declarations).map(({ provider }) => provider.rootEntitySchemaSlug),
						),
					].map((slug) => testPluginEntitySchema({ slug })),
				}),
			});
			const current = requirePresent(
				(yield* listAdminSystemPlugins(target)).find(({ id }) => id === pluginId),
				`Shipped plugin '${packageId}' is not installed`,
			);
			const updated = yield* updateTestSupportSystemPlugin({
				target,
				...shipped,
				pluginId,
				compiledScripts: [...shipped.compiledScripts, ...compiled.compiledScripts],
				contentHash: requirePresent(current.contentHash, "Shipped plugin has no content hash"),
				manifest: {
					...shipped.manifest,
					scripts: [...shipped.manifest.scripts, ...compiled.manifest.scripts],
					providers: [...shipped.manifest.providers, ...compiled.manifest.providers],
				},
			});
			return yield* resolveTestProviders(declarations, {
				target,
				activePluginRevisionId: updated.activePluginRevisionId,
				scriptIds: Object.fromEntries(updated.scripts.map(({ id, slug }) => [slug, id])),
			});
		});
		const attachDeclarations = <Key extends string>(
			providers: Readonly<Record<Key, TestProviderDeclaration>>,
		) =>
			Effect.gen(function* () {
				for (const declaration of Record.values(providers)) {
					attached.set(declaration.provider.slug, declaration);
				}
				const published = yield* publish;
				return Record.map(providers, ({ provider }): AttachedTestProvider => ({
					...requirePresent(
						published[provider.slug],
						`Provider '${provider.slug}' was not published`,
					),
					pluginId,
				}));
			});
		const attach = <Key extends string>(providers: Readonly<Record<Key, TestProviderSpec>>) =>
			attachDeclarations(
				Record.map(providers, (provider) => {
					const providerSlug = provider.slug ?? `e2e-provider-${crypto.randomUUID()}`;
					specs.set(providerSlug, { ...provider, slug: providerSlug });
					return testProviderDeclaration({ ...provider, slug: providerSlug });
				}),
			);
		return {
			attach,
			attachDeclarations,
			attachProvider: (provider: TestProviderSpec) =>
				attach({ provider }).pipe(Effect.map(({ provider: attachedProvider }) => attachedProvider)),
			update: (providerSlug: string, changes: Partial<TestProviderSpec>) =>
				Effect.suspend(() => {
					const spec = {
						...requirePresent(
							specs.get(providerSlug),
							`Provider '${providerSlug}' is not attached`,
						),
						...changes,
						slug: providerSlug,
					};
					specs.set(providerSlug, spec);
					attached.set(providerSlug, testProviderDeclaration(spec));
					return publish;
				}).pipe(Effect.asVoid),
		};
	});

export const installTestProvider = (input: TestProviderPlugin & TestProviderSpec) =>
	installTestProviders({ ...input, providers: { provider: input } }).pipe(
		Effect.map(({ provider }) => provider),
	);

export const testProviderEntitySchema = (provider: InstalledTestProvider) => ({
	owner: definitionOwner(provider.pluginId),
	slug: EntitySchemaSlug.make(
		requirePresent(
			provider.manifest.providers.find(({ slug }) => slug === provider.providerSlug),
			`Provider '${provider.providerSlug}' is missing from its manifest`,
		).rootEntitySchemaSlug,
	),
});

export const uninstallTestProvider = (seeded: InstalledTestProvider) =>
	uninstallTestPlugin({ ...seeded, slug: seeded.providerSlug, scriptId: seeded.detailsScriptId });

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

export const relatedPageKey = (continuation: JsonValue) => JSON.stringify(continuation);

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
	readonly httpCalls?: HttpCalls;
	readonly operation: ProviderOperation;
	readonly result: ProviderOperationResult;
	readonly searchOptionsSchema?: AppSchema;
}) {
	const resultSchemaByOperation = {
		search: "providerSearchResultSchema",
		details: "providerDetailsResultSchema",
		related: "providerRelatedResultSchema",
		resolve: "providerResolveResultSchema",
		translate: "providerTranslateResultSchema",
		"search-options": "providerSearchOptionsResultSchema",
	} as const satisfies Record<ProviderOperation, string>;
	const resultSchema = resultSchemaByOperation[input.operation];
	const isTranslate = input.operation === "translate";
	const isRelated = input.operation === "related";
	const decoded = (name: string, schema: string) => `const ${name} = Schema.decodeSync(${schema})(
  JSON.parse(${JSON.stringify(JSON.stringify(input.result))}),
);`;
	let declarations = decoded("result", resultSchema);
	if (isRelated) {
		declarations = decoded("pages", "Schema.Record(Schema.String, providerRelatedResultSchema)");
	} else if (isTranslate) {
		declarations = decoded(
			"translations",
			"Schema.Record(Schema.String, providerTranslateResultSchema)",
		);
	}
	let run: string;
	if (input.executionFailure !== undefined) {
		run = `() => Effect.die(${JSON.stringify(input.executionFailure)})`;
	} else if (input.httpCalls !== undefined) {
		run = `(_input, host) => Effect.forEach(
    Array.from({ length: ${input.httpCalls.count} }),
    () => host.httpCall("GET", ${JSON.stringify(input.httpCalls.url)}),
    { discard: true },
  ).pipe(Effect.as(result))`;
	} else if (isRelated) {
		run = `({ continuation }) => {
    const page = pages[JSON.stringify(continuation)];
    return page === undefined
      ? Effect.die("No fixture related page for " + JSON.stringify(continuation))
      : Effect.succeed(page);
  }`;
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
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider, ${isTranslate ? "providerTranslateResultSchema" : resultSchema} } from "@ryot-app/plugin-backend-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
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
		requiredPluginConfigKeys: [],
		providerOperation: input.operation,
		capabilities: input.httpCalls === undefined ? [] : ["httpCall"],
		providerSlug: input.slug.slice(0, -(input.operation.length + 1)),
	});
	return source;
}
