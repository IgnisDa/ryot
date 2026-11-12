import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { documentTables, type RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import type { RyotQLResult } from "@ryot-app/contract/modules/ryotql/language";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import type {
	DescribeResponse,
	ExecutionRequest,
	ExecutionSource,
} from "@ryot-app/contract/modules/ryotql/request";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { type TimeZone, UTC } from "@ryot-app/contract/schema/time-zone";
import {
	compileControlFilter,
	compileControlSort,
	type ControlSchema,
	describeFilterFields,
	hasMembershipControls,
	type MembershipSource,
	resolveControl,
} from "@ryot-app/ryotql-recipes/controls";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { bindDocument as bindAuthoredDocument, cursorBindingKey } from "@ryot-app/ryotql/binding";
import type { RyotQLAudience } from "@ryot-app/ryotql/catalog";
import { type ExpandedRyotQLDocument, validateRyotQLDocument } from "@ryot-app/ryotql/validator";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord, isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Context, DateTime, Deferred, Effect, Layer, Match, Result, Schema } from "effect";

import { DefinitionCatalog, pluginOwner } from "#modules/definitions/catalog";
import { loadCatalogRelations } from "#modules/definitions/catalog-relations";
import type { DefinitionReadContext } from "#modules/definitions/read-context";
import { DatabaseSession } from "#platform/db/session";
import { HmacSigner } from "#platform/storage/hmac-signer";
import { user as userTable } from "#schema/tables/auth";
import { plugin } from "#schema/tables/core";

import { bindRyotQLDocument, type PluginBinding, pluginIdentityReferences } from "./binding";
import type { RyotQLExecutionScope } from "./catalog";
import { executeNamedQuery, executeSubjectSet } from "./executor";
import { collectionSubjectDocument } from "./source-queries";
import { RyotQLSources } from "./sources";

const RYOTQL_STATEMENT_TIMEOUT_MS = 30_000;
const PUBLICATION_STATEMENT_TIMEOUT_MS = 10_000;

const invalidQuery = () => new RyotQLBadRequest({ reason: { code: "invalid-query" } });

class DiscardedSavepoint extends Schema.TaggedError<
	DiscardedSavepoint,
	{ readonly brand: unique symbol }
>()("DiscardedSavepoint", {}) {}

export class RyotQLService extends Context.Service<RyotQLService>()(
	"@ryot-app/kernel-backend/modules/ryotql/service/RyotQLService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const signer = yield* HmacSigner;
			const catalogs = yield* DefinitionCatalog;
			const sources = yield* RyotQLSources;

			// Only rolling back a savepoint reverts READ ONLY and local settings; releasing it would leave
			// them on the transaction of the write that is reading its own changes.
			const discardedSavepoint = <A, E, R>(read: Effect.Effect<A, E, R>) =>
				Effect.gen(function* () {
					const finished = yield* Deferred.make<A>();
					return yield* session
						.savepoint(
							read.pipe(
								Effect.flatMap((value) => Deferred.succeed(finished, value)),
								Effect.andThen(new DiscardedSavepoint()),
							),
						)
						.pipe(Effect.catchTag("DiscardedSavepoint", () => Deferred.await(finished)));
				});

			const runRead = Effect.fnUntraced(function* <A, E, R>(
				timeoutMs: number,
				body: (transaction: EffectPgDatabase) => Effect.Effect<A, E, R>,
			) {
				const joined = yield* session.isTransactionActive;
				const read = session.run((transaction) =>
					Effect.gen(function* () {
						yield* transaction.execute(
							joined
								? sql`SET TRANSACTION READ ONLY`
								: sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
						);
						yield* transaction.execute(
							sql`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true), set_config('jit', 'off', true)`,
						);
						return yield* body(transaction);
					}),
				);
				return yield* (joined ? discardedSavepoint(read) : session.transaction(read)).pipe(
					Effect.catchTag(
						"DatabaseSessionStateError",
						() => new RyotQLInternalError({ reason: { code: "execution-failed" } }),
					),
					Effect.catchIf(
						(error): error is DbError => error instanceof DbError,
						(error) =>
							Effect.logError("RyotQL database execution failed", error).pipe(
								Effect.andThen(
									Match.value(error.code).pipe(
										Match.when("57014", () =>
											Effect.fail(
												new RyotQLBadRequest({
													reason: { limitMs: timeoutMs, code: "query-timeout" },
												}),
											),
										),
										Match.orElse(() =>
											Effect.fail(
												new RyotQLInternalError({ reason: { code: "execution-failed" } }),
											),
										),
									),
								),
							),
					),
				);
			});

			const readyUserPlugins = (userId: string) =>
				Effect.map(catalogs.userPlugins(userId), (plugins) =>
					plugins.filter(({ health }) => health === "ready"),
				);

			const scopePlugins = Effect.fnUntraced(function* (
				transaction: EffectPgDatabase,
				scope: RyotQLExecutionScope,
			) {
				if (scope.type === "user") {
					return yield* readyUserPlugins(scope.userId);
				}
				const plugins = yield* transaction
					.select({ pluginId: plugin.id, ownerId: plugin.ownerId, packageId: plugin.packageId })
					.from(plugin)
					.where(
						and(
							eq(plugin.status, "active"),
							scope.type === "plugin" ? isNull(plugin.ownerId) : undefined,
						),
					);
				const available = Array.from(plugins, (entry) => ({
					...entry,
					scope: entry.ownerId === null ? ("system" as const) : ("user" as const),
				}));
				if (
					scope.type === "plugin" &&
					!available.some(({ pluginId }) => pluginId === scope.pluginId)
				) {
					available.push({
						ownerId: null,
						scope: "system",
						pluginId: scope.pluginId,
						packageId: scope.packageId,
					});
				}
				return available;
			});

			const bindDocument = Effect.fnUntraced(function* <E, R>(
				document: ExpandedRyotQLDocument,
				scope: RyotQLExecutionScope,
				loadCatalog: Effect.Effect<ReadonlyArray<PluginBinding>, E, R>,
			) {
				const catalog = pluginIdentityReferences(document).length === 0 ? [] : yield* loadCatalog;
				return yield* bindRyotQLDocument(document, scope, catalog);
			});

			const runDocument = Effect.fnUntraced(function* <E, R>(
				transaction: EffectPgDatabase,
				scope: RyotQLExecutionScope,
				document: ExpandedRyotQLDocument,
				options: {
					readonly relationsOwner: null | string;
					readonly resultBytes: number | undefined;
					readonly loadCatalog: Effect.Effect<ReadonlyArray<PluginBinding>, E, R>;
				},
			) {
				const bound = yield* bindDocument(document, scope, options.loadCatalog);
				if (validateRyotQLDocument(bound, scope).error !== null) {
					return yield* invalidQuery();
				}
				const budget =
					options.resultBytes === undefined
						? undefined
						: { limitBytes: options.resultBytes, remainingBytes: options.resultBytes };
				const results: Array<readonly [string, RyotQLResult]> = [];
				for (const [name, query] of Object.entries(bound.queries)) {
					results.push([
						name,
						yield* executeNamedQuery(
							{ ...scope, cursorIdentity: `${scope.cursorIdentity ?? ""}:${name}` },
							query,
							name,
							transaction,
							budget,
							(names) => loadCatalogRelations(catalogs, options.relationsOwner, names),
						).pipe(Effect.provideService(HmacSigner, signer)),
					]);
				}
				return { data: Object.fromEntries(results) };
			});

			const controlSchemas = Effect.fn("RyotQLService.controlSchemas")(function* (
				scope: RyotQLExecutionScope,
			): Effect.fn.Return<readonly ControlSchema[], DbError> {
				if (scope.type === "user") {
					const catalog = yield* catalogs.forUser(scope.userId);
					const context = scope.definitionContext;
					const owner = catalog.plugins.find(
						(entry) => entry.pluginId === context?.pluginId && entry.isDefinitionEffective,
					);
					if (context === undefined || owner === undefined) {
						return catalog.entitySchemas;
					}
					const pinned = yield* catalogs.revision(context.pluginRevisionId);
					return [
						...catalog.entitySchemas.filter((entry) => entry.pluginId !== context.pluginId),
						...pinned.entitySchemas.map((entry) =>
							Object.assign({}, entry, pluginOwner(owner), { isEffective: true }),
						),
					];
				}
				if (scope.type === "plugin") {
					return (yield* catalogs.revision(scope.pluginRevisionId)).entitySchemas.map((entry) =>
						Object.assign({}, entry, {
							isEffective: true,
							pluginId: scope.pluginId,
							packageId: scope.packageId,
							pluginScope: "system" as const,
						}),
					);
				}
				return [];
			});

			const prepareRequest = Effect.fn("RyotQLService.prepareRequest")(function* (
				transaction: EffectPgDatabase,
				scope: RyotQLExecutionScope,
				request: ExecutionRequest,
				path: readonly string[] = [],
				budget: {
					rows: number;
					sources: number;
					identities: string[];
					revisions: Record<string, number>;
				} = { rows: 0, sources: 0, revisions: {}, identities: [] },
				forbiddenSource?: SavedViewReference,
				executionNow?: Date,
			): Effect.fn.Return<
				{
					readonly scope: RyotQLExecutionScope;
					readonly document: ExpandedRyotQLDocument;
					readonly membership: readonly MembershipSource[];
					readonly execution: { readonly now: number; readonly timeZone: TimeZone };
				},
				DbError | RyotQLBadRequest | DemoOperationProtected | EffectDrizzleQueryError
			> {
				const resolved = yield* sources.resolve(scope, request.source);
				budget.identities.push(resolved.identity);
				if (path.includes(resolved.identity) || path.length >= 16 || ++budget.sources > 64) {
					return yield* invalidQuery();
				}
				const values = {
					...resolved.values,
					...request,
					arguments: { ...resolved.values.arguments, ...request.arguments },
				};
				const argumentsResult = bindArguments(resolved.document.parameters, values.arguments);
				if (Result.isFailure(argumentsResult)) {
					return yield* invalidQuery();
				}
				const selected =
					resolved.selectedQuery === undefined
						? resolved.document
						: {
								...resolved.document,
								queries: Object.fromEntries(
									Object.entries(resolved.document.queries).filter(
										([name]) => name === resolved.selectedQuery,
									),
								),
							};
				const now = executionNow ?? DateTime.toDateUtc(yield* DateTime.now);
				let ownerId: string | undefined;
				if (scope.type === "user") {
					ownerId = scope.userId;
				}
				const [owner] =
					ownerId === undefined
						? []
						: yield* transaction
								.select({ preferences: userTable.preferences })
								.from(userTable)
								.where(eq(userTable.id, ownerId))
								.limit(1);
				const schemas = yield* controlSchemas(scope);
				const membership: MembershipSource[] = [];
				const sourceEntities: Record<
					string,
					readonly { readonly rank: number; readonly entityId: string }[]
				> = {};
				const references = new Set<string>();
				const visit = (value: unknown): void => {
					if (isUnknownArray(value)) {
						for (const child of value) {
							visit(child);
						}
						return;
					}
					if (!isObjectRecord(value) || value["type"] === "literal") {
						return;
					}
					if (value["type"] === "sourceEntity" && typeof value["parameter"] === "string") {
						const reference = argumentsResult.success[value["parameter"]];
						if (typeof reference === "string") {
							references.add(reference);
						}
					}
					for (const child of Object.values(value)) {
						visit(child);
					}
				};
				visit(selected.queries);
				if ([...documentTables(selected)].some((table) => table.startsWith("sourceEntity:"))) {
					return yield* invalidQuery();
				}
				for (const reference of references) {
					if (++budget.sources > 64) {
						return yield* invalidQuery();
					}
					if (scope.type !== "user") {
						return yield* invalidQuery();
					}
					const source = yield* sources
						.entitySource(scope, reference)
						.pipe(Effect.catchTag("RyotQLBadRequest", invalidQuery));
					if (
						source.kind === "savedView" &&
						forbiddenSource !== undefined &&
						stableStringify(source.reference) === stableStringify(forbiddenSource)
					) {
						return yield* invalidQuery();
					}
					let selection: ExpandedRyotQLDocument;
					let subjectAlias: string;
					let selectionScope = scope;
					if (source.kind === "collection") {
						budget.identities.push(
							stableStringify({ collectionId: source.id, membership: source.membership }),
						);
						budget.revisions[`sourceEntity:${reference}`] = source.revision;
						membership.push({ collectionId: source.id, propertiesSchema: source.membership });
						subjectAlias = "subject";
						const collection = yield* Effect.fromResult(
							bindAuthoredDocument(
								collectionSubjectDocument,
								{ arguments: { collectionId: source.id } },
								{ now, reportingTimeZone: owner?.preferences.reportingTimeZone ?? "UTC" },
							),
						).pipe(Effect.orDie);
						const validated = validateRyotQLDocument(collection.document, scope);
						if (validated.error !== null) {
							return yield* invalidQuery();
						}
						selection = validated.value;
					} else {
						subjectAlias = source.subjectAlias;
						const prepared = yield* prepareRequest(
							transaction,
							scope,
							{ source: { kind: "savedView", query: source.query, reference: source.reference } },
							[...path, resolved.identity],
							budget,
							forbiddenSource,
							now,
						);
						selection = prepared.document;
						membership.push(...prepared.membership);
						if (prepared.scope.type !== "user") {
							return yield* invalidQuery();
						}
						selectionScope = prepared.scope;
					}
					const bound = yield* bindDocument(
						selection,
						selectionScope,
						scopePlugins(transaction, selectionScope),
					);
					const [query] = Object.values(bound.queries);
					if (
						query?.output.type !== "rows" ||
						![
							query.from,
							...(query.joins ?? []).flatMap((join) =>
								join.type === "jsonElements" ? [] : [join.table],
							),
						].some((table) => table.alias === subjectAlias && table.table === "entity")
					) {
						return yield* invalidQuery();
					}
					const rows = yield* executeSubjectSet(
						selectionScope,
						{ ...query, output: query.output },
						subjectAlias,
						10000 - budget.rows,
						transaction,
						(names) => loadCatalogRelations(catalogs, scope.userId, names),
					);
					budget.rows += rows.length;
					if (budget.rows > 10000) {
						return yield* new RyotQLBadRequest({
							reason: { limit: 10000, code: "source-limit-exceeded" },
						});
					}
					sourceEntities[`sourceEntity:${reference}`] = rows;
				}
				const bound = bindAuthoredDocument(selected, values, {
					now,
					reportingTimeZone: owner?.preferences.reportingTimeZone ?? "UTC",
					resolveSourceEntity: (reference, alias) =>
						sourceEntities[`sourceEntity:${reference}`] === undefined
							? Result.fail(new Error("Unresolved source"))
							: Result.succeed({ alias, table: `sourceEntity:${reference}` }),
					sort: (name, target, value) => {
						const query = resolved.document.queries[name];
						return query === undefined
							? Result.fail(new Error("Unknown query"))
							: Result.flatMap(
									resolveControl(target, query, schemas, resolved.document, {
										memberships: membership,
										arguments: argumentsResult.success,
									}),
									(controls) => {
										budget.identities.push(stableStringify(controls));
										return compileControlSort(controls, value);
									},
								);
					},
					filter: (name, target, value) => {
						const query = resolved.document.queries[name];
						return query === undefined
							? Result.fail(new Error("Unknown query"))
							: Result.flatMap(
									resolveControl(target, query, schemas, resolved.document, {
										memberships: membership,
										arguments: argumentsResult.success,
									}),
									(controls) => {
										budget.identities.push(stableStringify(controls));
										return compileControlFilter(controls, query, value, now);
									},
								);
					},
				});
				if (Result.isFailure(bound)) {
					yield* Effect.logWarning("RyotQL binding failed", bound.failure);
					return yield* invalidQuery();
				}
				const executionScope = {
					...scope,
					sourceEntities,
					sourceRevisions: { ...budget.revisions },
					cursorIdentity: cursorBindingKey({
						sort: values.sort,
						filter: values.filter,
						arguments: bound.success.arguments,
						ownerIdentity: stableStringify(scope),
						sourceIdentity: stableStringify({
							source: resolved.identity,
							dependencies: budget.identities,
						}),
					}),
				};
				const validated = validateRyotQLDocument(bound.success.document, executionScope);
				if (validated.error !== null) {
					if (
						scope.type === "user" &&
						scope.accessClass === "demo" &&
						validateRyotQLDocument(bound.success.document, {
							...scope,
							type: "user",
							accessClass: "standard",
						}).error === null
					) {
						return yield* new DemoOperationProtected({
							reason: { code: "demo-operation-protected" },
						});
					}
					yield* Effect.logWarning("RyotQL validation failed", { diagnostic: validated.error });
					return yield* invalidQuery();
				}
				return {
					membership,
					scope: executionScope,
					document: validated.value,
					execution: { now: now.getTime(), timeZone: owner?.preferences.reportingTimeZone ?? UTC },
				};
			});

			const executeWithScope = Effect.fn("RyotQLService.executeWithScope")(function* (
				scope: RyotQLExecutionScope,
				request: ExecutionRequest,
				resultBytes?: number,
			) {
				if (request.source.kind === "inline" && request.source.document.controls === undefined) {
					const unresolvedSources = new Set<string>();
					const { query, document } = request.source;
					const selected =
						query === undefined
							? document
							: {
									...document,
									queries: Object.fromEntries(
										Object.entries(document.queries).filter(([name]) => name === query),
									),
								};
					const bound = bindAuthoredDocument(selected, request, {
						reportingTimeZone: "UTC",
						now: DateTime.toDateUtc(yield* DateTime.now),
						resolveSourceEntity: (reference) => {
							unresolvedSources.add(reference);
							return Result.fail(new Error("Source resolution requires a transaction"));
						},
					});
					if (unresolvedSources.size === 0) {
						if (Result.isFailure(bound)) {
							return yield* invalidQuery();
						}
						const validated = validateRyotQLDocument(bound.success.document, scope);
						if (validated.error !== null) {
							if (
								scope.type === "user" &&
								scope.accessClass === "demo" &&
								validateRyotQLDocument(bound.success.document, {
									...scope,
									accessClass: "standard",
								}).error === null
							) {
								return yield* new DemoOperationProtected({
									reason: { code: "demo-operation-protected" },
								});
							}
							return yield* invalidQuery();
						}
					}
				}

				return yield* runRead(RYOTQL_STATEMENT_TIMEOUT_MS, (transaction) =>
					Effect.gen(function* () {
						const prepared = yield* prepareRequest(transaction, scope, request);
						const result = yield* runDocument(transaction, prepared.scope, prepared.document, {
							resultBytes,
							loadCatalog: scopePlugins(transaction, scope),
							relationsOwner: scope.type === "user" ? scope.userId : null,
						});
						return { ...result, execution: prepared.execution };
					}),
				);
			});

			const describeSource = Effect.fn("RyotQLService.describeSource")(function* (
				scope: RyotQLExecutionScope,
				source: ExecutionSource,
				argumentsValue?: ExecutionRequest["arguments"],
			) {
				const resolved = yield* sources.resolve(scope, source);
				const { document, selectedQuery } = resolved;
				const membership = hasMembershipControls(document)
					? yield* sources.membershipAuthority(scope, resolved, argumentsValue)
					: undefined;
				const context =
					membership === undefined
						? undefined
						: {
								memberships: membership,
								arguments: yield* Effect.fromResult(
									bindArguments(document.parameters, {
										...resolved.values.arguments,
										...argumentsValue,
									}),
								).pipe(Effect.mapError(invalidQuery)),
							};
				const schemas = yield* controlSchemas(scope);
				yield* Effect.fromResult(storedValidationBranches(document, schemas, scope)).pipe(
					Effect.mapError(invalidQuery),
				);
				const query =
					selectedQuery === undefined
						? Object.values(document.queries)[0]
						: document.queries[selectedQuery];
				if (!query) {
					return yield* invalidQuery();
				}
				const filters = yield* Effect.fromResult(
					resolveControl(document.controls?.filter, query, schemas, document, context),
				).pipe(Effect.mapError(invalidQuery));
				const sorts = yield* Effect.fromResult(
					resolveControl(document.controls?.sort, query, schemas, document, context),
				).pipe(Effect.mapError(invalidQuery));
				return {
					parameters: document.parameters ?? { fields: {} },
					sort: sorts.sorts.map(({ branches: _, ...choice }) => choice),
					filter: yield* Effect.fromResult(describeFilterFields(filters)).pipe(
						Effect.mapError(invalidQuery),
					),
				} satisfies typeof DescribeResponse.Type;
			});

			const describeWithScope = (
				scope: RyotQLExecutionScope,
				source: ExecutionSource,
				argumentsValue?: ExecutionRequest["arguments"],
			) =>
				runRead(RYOTQL_STATEMENT_TIMEOUT_MS, () => describeSource(scope, source, argumentsValue));

			const executeDeclared = Effect.fn("RyotQLService.executeDeclared")(function* (
				owner: { readonly userId: string; readonly language: null | string },
				document: RyotQLDocument,
				request: { readonly query?: string } & Omit<ExecutionRequest, "source">,
				resultBytes: number,
			) {
				const scope = {
					...owner,
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				} as const;
				if (request.query !== undefined && !Object.hasOwn(document.queries, request.query)) {
					return yield* invalidQuery();
				}
				return yield* runRead(PUBLICATION_STATEMENT_TIMEOUT_MS, (transaction) =>
					Effect.gen(function* () {
						const now = DateTime.toDateUtc(yield* DateTime.now);
						const prepared = yield* prepareRequest(
							transaction,
							scope,
							{
								...request,
								source: {
									document,
									kind: "inline",
									...(request.query === undefined ? {} : { query: request.query }),
								},
							},
							[],
							{ rows: 0, sources: 0, revisions: {}, identities: [] },
							undefined,
							now,
						);
						const result = yield* runDocument(transaction, prepared.scope, prepared.document, {
							resultBytes,
							relationsOwner: owner.userId,
							loadCatalog: scopePlugins(transaction, scope),
						});
						return { ...result, execution: prepared.execution };
					}),
				).pipe(Effect.catchTag("DemoOperationProtected", invalidQuery));
			});
			const describeDeclared = Effect.fn("RyotQLService.describeDeclared")(function* (
				owner: { readonly userId: string; readonly language: null | string },
				document: RyotQLDocument,
				query: string,
				argumentsValue?: ExecutionRequest["arguments"],
			) {
				const scope = {
					...owner,
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				} as const;
				return yield* runRead(PUBLICATION_STATEMENT_TIMEOUT_MS, () =>
					Effect.gen(function* () {
						for (const [name, property] of Object.entries(document.parameters?.fields ?? {})) {
							if (property.type !== "string" || property.reference?.kind !== "entity-source") {
								continue;
							}
							const reference = argumentsValue?.[name] ?? property.defaultValue;
							if (typeof reference === "string") {
								yield* sources.entitySource(scope, reference);
							}
						}
						return yield* describeSource(
							scope,
							{ query, document, kind: "inline" },
							argumentsValue,
						);
					}),
				);
			});

			const executeForUser = (
				userId: string,
				language: null | string,
				audience: RyotQLAudience,
				request: ExecutionRequest,
				accessClass: AccessClass = "standard",
				resultBytes?: number,
				definitionContext?: DefinitionReadContext,
			) => {
				const scope = {
					userId,
					language,
					audience,
					accessClass,
					type: "user",
					definitionContext,
				} as const;
				return executeWithScope(scope, request, resultBytes);
			};

			const executeForPlugin = (
				scope: Omit<Extract<RyotQLExecutionScope, { type: "plugin" }>, "type">,
				request: ExecutionRequest,
				resultBytes: number,
			) =>
				executeWithScope({ ...scope, type: "plugin" }, request, resultBytes).pipe(
					Effect.catchTag("DemoOperationProtected", invalidQuery),
				);

			const executeForAdmin = (request: ExecutionRequest) =>
				executeWithScope({ type: "admin" }, request).pipe(
					Effect.catchTag("DemoOperationProtected", invalidQuery),
				);

			const execute = (
				user: CurrentUserValue,
				request: ExecutionRequest,
				accessClass: AccessClass,
			) => executeForUser(user.id, user.preferences.language, "kernel", request, accessClass);

			const executeForPluginAudience = (
				user: CurrentUserValue,
				request: ExecutionRequest,
				accessClass: AccessClass,
			) => executeForUser(user.id, user.preferences.language, "plugin", request, accessClass);

			return {
				execute,
				executeForUser,
				executeForAdmin,
				executeDeclared,
				executeForPlugin,
				describeDeclared,
				executeForPluginAudience,
				describeForAdmin: (
					source: ExecutionSource,
					argumentsValue?: ExecutionRequest["arguments"],
				) => describeWithScope({ type: "admin" }, source, argumentsValue),
				describe: (
					user: CurrentUserValue,
					source: ExecutionSource,
					audience: RyotQLAudience,
					accessClass: AccessClass,
					argumentsValue?: ExecutionRequest["arguments"],
				) =>
					describeWithScope(
						{
							audience,
							accessClass,
							type: "user",
							userId: user.id,
							language: user.preferences.language,
						},
						source,
						argumentsValue,
					),
				validateSelectionForUser: (
					userId: string,
					request: ExecutionRequest,
					forbiddenSource?: SavedViewReference,
				) =>
					runRead(RYOTQL_STATEMENT_TIMEOUT_MS, (transaction) =>
						prepareRequest(
							transaction,
							{ userId, type: "user", language: null, audience: "plugin", accessClass: "standard" },
							request,
							[],
							{ rows: 0, sources: 0, revisions: {}, identities: [] },
							forbiddenSource,
						),
					).pipe(Effect.asVoid),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(HmacSigner.layer),
		Layer.provide(RyotQLSources.layer),
		Layer.provide(DefinitionCatalog.layer),
	);
}
