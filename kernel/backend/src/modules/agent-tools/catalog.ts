import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { notFound, schemaValidationFailed } from "@ryot-app/contract/errors";
import {
	type RyotQLDocument,
	stampRyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { PluginId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import {
	type Capability,
	capabilityOwner,
	KERNEL_CAPABILITY_OWNER,
	pluginOperationCapabilityId,
	pluginQueryCapabilityId,
} from "@ryot-app/contract/schema/capability";
import { type Entitlement, isEntitled } from "@ryot-app/contract/schema/entitlement";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer, Schema } from "effect";
import type { Headers as PlatformHeaders } from "effect/http";

import type { AuthService } from "#modules/accounts/auth/service";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { userOperationAccessFailure } from "#modules/plugins/operations/access";
import { OperationsService } from "#modules/plugins/operations/service";
import { RyotQLService } from "#modules/ryotql/service";
import { EntitlementService } from "#platform/entitlements";
import { MessageRegistry } from "#platform/messages";
import { defaultResultByteBudget } from "#platform/tool-result";

import { modelDisplayText } from "./data-catalog";
import {
	boundedQuery,
	cappedRequest,
	declaredQueryInput,
	KernelCapabilities,
	readHints,
	ryotqlOutput,
} from "./kernel-capabilities";

export type AgentAccount = Effect.Success<
	ReturnType<AuthService["Service"]["resolveTrustedAccount"]>
>;
type CapabilityInvocation = {
	readonly resource?: string;
	readonly idempotencyKey?: string;
	readonly headers?: PlatformHeaders.Headers;
};
type CatalogEntry = {
	readonly capability: Capability;
	readonly document?: RyotQLDocument;
	readonly entitlement?: undefined | Entitlement;
};

export const capabilityPin = (capability: Capability) =>
	sha256Base64Url(stableStringify(capability));

export const capabilityNamespaces = (capabilities: readonly Capability[]) =>
	sortBy(
		Object.entries(
			Object.groupBy(capabilities, (capability) => capabilityOwner(capability.id)),
		).map(([namespace, members = []]) => ({
			namespace,
			capabilities: members.length,
			writes: members.filter((capability) => !capability.hints.readOnly).length,
			description:
				namespace === KERNEL_CAPABILITY_OWNER
					? "Ryot data schemas, inline RyotQL queries, collections, pages and saved views"
					: `Operations and declared queries of the ${namespace} plugin`,
		})),
		(entry) => (entry.namespace === KERNEL_CAPABILITY_OWNER ? "" : entry.namespace),
	);

export class CapabilityCatalog extends Context.Service<CapabilityCatalog>()(
	"@ryot-app/kernel-backend/modules/agent-tools/catalog/CapabilityCatalog",
	{
		make: Effect.gen(function* () {
			const kernel = yield* KernelCapabilities;
			const runtime = yield* PluginRuntimeResolver;
			const operations = yield* OperationsService;
			const catalogs = yield* DefinitionCatalog;
			const ryotql = yield* RyotQLService;
			const entitlements = yield* EntitlementService;
			const messages = yield* MessageRegistry;
			const declaredQueries = Effect.fn("CapabilityCatalog.declaredQueries")(function* (
				account: AgentAccount,
			) {
				const catalog = yield* catalogs.forUser(account.user.id);
				const active = yield* entitlements.current;
				const render = yield* messages.modelRenderer(
					catalog.plugins.map((plugin) => plugin.pluginId),
				);
				const title = modelDisplayText(render);
				const entries: CatalogEntry[] = [];
				for (const plugin of catalog.plugins) {
					if (plugin.health !== "ready" || !plugin.isDefinitionEffective || !plugin.isExecutable) {
						continue;
					}
					const revision = yield* catalogs.revision(plugin.activeRevisionId);
					for (const [query, declaration] of Object.entries(revision.sections.queries ?? {})) {
						if (!isEntitled(active, declaration.entitlement)) {
							continue;
						}
						const document = stampRyotQLDocument(plugin.pluginId, declaration.document);
						entries.push({
							document,
							entitlement: declaration.entitlement,
							capability: {
								hints: readHints,
								output: ryotqlOutput,
								title: declaration.title,
								description: declaration.description,
								input: declaredQueryInput(document, title),
								id: pluginQueryCapabilityId(plugin.packageId, query),
								source: {
									query,
									scope: plugin.scope,
									kind: "declared-query",
									pluginId: plugin.pluginId,
									packageId: plugin.packageId,
									revisionId: plugin.activeRevisionId,
								},
							},
						});
					}
				}
				return entries;
			});
			const operationEntries = Effect.fn("CapabilityCatalog.operationEntries")(function* (
				account: AgentAccount,
			) {
				const available = yield* runtime.listOperationsAvailableToUser(account.user.id);
				const active = yield* entitlements.current;
				return available.flatMap(({ plugin, operation }): CatalogEntry[] => {
					if (operation.auth !== "user" || plugin.pluginConfigRevisionId === null) {
						return [];
					}
					const accessClass = account.authorization.accessClass;
					if (
						(accessClass === "demo" && !operation.hints.readOnly) ||
						userOperationAccessFailure({
							operation,
							accessClass,
							entitlements: active,
							pluginScope: plugin.scope,
						})
					) {
						return [];
					}
					return [
						{
							capability: {
								input: operation.input,
								hints: operation.hints,
								title: operation.title,
								output: operation.output,
								description: operation.description,
								id: pluginOperationCapabilityId(plugin.packageId, operation.slug),
								source: {
									kind: "operation",
									packageId: plugin.packageId,
									operationSlug: operation.slug,
									contentHash: plugin.contentHash,
									revisionId: plugin.pluginRevisionId,
									installationId: plugin.installationId,
									configRevisionId: plugin.pluginConfigRevisionId,
								},
							},
						},
					];
				});
			});
			const entries = Effect.fn("CapabilityCatalog.entries")(function* (account: AgentAccount) {
				const kernelEntries = kernel.capabilities
					.filter(
						(capability) =>
							account.authorization.accessClass !== "demo" || capability.hints.readOnly,
					)
					.map((capability) => ({ capability }));
				return sortBy(
					[
						...kernelEntries,
						...(yield* declaredQueries(account)),
						...(yield* operationEntries(account)),
					],
					(entry) => entry.capability.id,
				);
			});
			const list = (account: AgentAccount) =>
				entries(account).pipe(Effect.map((all) => all.map((entry) => entry.capability)));
			const resolve = Effect.fn("CapabilityCatalog.resolve")(function* (
				account: AgentAccount,
				id: string,
			) {
				const entry = (yield* entries(account)).find((candidate) => candidate.capability.id === id);
				if (!entry) {
					return yield* notFound(kernelMessage("error.agent-tools.unknown-capability", { id }));
				}
				return entry;
			});
			const invoke = Effect.fn("CapabilityCatalog.invoke")(function* (
				account: AgentAccount,
				entry: CatalogEntry,
				input: JsonValue,
				invocation: CapabilityInvocation,
			) {
				const { user, authorization } = account;
				const { capability } = entry;
				const source = capability.source;
				if (authorization.accessClass === "demo" && !capability.hints.readOnly) {
					return yield* new DemoOperationProtected({
						reason: { code: "demo-operation-protected" },
					});
				}
				if (source.kind === "kernel") {
					return yield* kernel.handle(
						capability.id,
						{
							user,
							accessClass: authorization.accessClass,
							...(invocation.idempotencyKey === undefined
								? {}
								: { idempotencyKey: invocation.idempotencyKey }),
						},
						input,
					);
				}
				if (source.kind === "declared-query") {
					yield* entitlements.require(entry.entitlement);
					const document = entry.document;
					if (document === undefined) {
						return yield* Effect.die("Declared query capability has no document");
					}
					const value = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(
						input,
					).pipe(Effect.mapError((error) => schemaValidationFailed(error.issue)));
					const request = yield* Schema.decodeEffect(ExecutionRequest)({
						...value,
						source: {
							kind: "plugin",
							scope: source.scope,
							query: source.query,
							packageId: source.packageId,
						},
					}).pipe(Effect.mapError((error) => schemaValidationFailed(error.issue)));
					return yield* boundedQuery(
						ryotql
							.executeForUser(
								user.id,
								user.preferences.contentLanguage,
								"plugin",
								cappedRequest(request, document),
								authorization.accessClass,
								defaultResultByteBudget,
								{
									pluginId: PluginId.make(source.pluginId),
									pluginRevisionId: PluginRevisionId.make(source.revisionId),
								},
							)
							.pipe(
								Effect.flatMap((result) =>
									Schema.encodeEffect(Schema.toCodecJson(RyotQLResponse))(result).pipe(
										Effect.orDie,
									),
								),
							),
					);
				}
				const operationInput = {
					payload: input,
					packageId: source.packageId,
					writeConfirmed: true as const,
					contentHash: source.contentHash,
					operationSlug: source.operationSlug,
					sourcePin: {
						revisionId: source.revisionId,
						installationId: source.installationId,
						configRevisionId: source.configRevisionId,
					},
					...(invocation.resource === undefined ? {} : { resource: invocation.resource }),
					...(invocation.idempotencyKey === undefined
						? {}
						: { idempotencyKey: invocation.idempotencyKey }),
				};
				return yield* invocation.headers === undefined
					? operations.invokeTrusted({ ...operationInput, userId: user.id })
					: operations.invoke({ ...operationInput, headers: invocation.headers });
			});
			return { list, invoke, resolve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
