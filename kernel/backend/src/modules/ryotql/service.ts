import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import type { PublicationScope } from "@ryot-app/contract/modules/publications/schemas";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import type { RyotQLDocument, RyotQLResult } from "@ryot-app/contract/modules/ryotql/language";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Context, Deferred, Effect, Layer, Match, Schema } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { loadCatalogRelations } from "#modules/definitions/catalog-relations";
import type { DefinitionReadContext } from "#modules/definitions/read-context";
import { DatabaseSession } from "#platform/db/session";
import { plugin } from "#schema/tables/core";

import { bindRyotQLDocument, type PluginBinding, pluginIdentityReferences } from "./binding";
import type { RyotQLAudience, RyotQLExecutionScope } from "./catalog";
import { executeNamedQuery, executeSubjectSet } from "./executor";
import { type ExpandedRyotQLDocument, validateRyotQLDocument } from "./validator";

const RYOTQL_STATEMENT_TIMEOUT_MS = 30_000;
const PUBLICATION_STATEMENT_TIMEOUT_MS = 10_000;

/** A publication's resolved scope query, executed as its owner only to select the visible subjects. */
export type PublicationSubjectQuery = {
	readonly ownerUserId: string;
	readonly subjectLimit: number;
	readonly scope: PublicationScope;
	readonly language: null | string;
};

const SubjectsJson = Schema.fromJsonString(
	Schema.Array(Schema.Struct({ rank: Schema.Int, entity_id: Schema.String })),
);

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
			const catalogs = yield* DefinitionCatalog;

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
				return Array.from(plugins, (entry) => ({
					...entry,
					scope: entry.ownerId === null ? ("system" as const) : ("user" as const),
				}));
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
				const budget =
					options.resultBytes === undefined
						? undefined
						: { limitBytes: options.resultBytes, remainingBytes: options.resultBytes };
				const results: Array<readonly [string, RyotQLResult]> = [];
				for (const [name, query] of Object.entries(bound.queries)) {
					results.push([
						name,
						yield* executeNamedQuery(scope, query, name, transaction, budget, (names) =>
							loadCatalogRelations(catalogs, options.relationsOwner, names),
						),
					]);
				}
				return { data: Object.fromEntries(results) };
			});

			const executeWithScope = Effect.fn("RyotQLService.executeWithScope")(function* (
				scope: RyotQLExecutionScope,
				document: RyotQLDocument,
				resultBytes?: number,
			) {
				const validated = validateRyotQLDocument(document, scope);
				if (validated.error !== null) {
					yield* Effect.logWarning("RyotQL validation failed", { diagnostic: validated.error });
					return yield* invalidQuery();
				}
				return yield* runRead(RYOTQL_STATEMENT_TIMEOUT_MS, (transaction) =>
					runDocument(transaction, scope, validated.value, {
						resultBytes,
						loadCatalog: scopePlugins(transaction, scope),
						relationsOwner: scope.type === "user" ? scope.userId : null,
					}),
				);
			});

			const readSubjects = Effect.fn("RyotQLService.readSubjects")(function* (
				transaction: EffectPgDatabase,
				source: PublicationSubjectQuery,
			) {
				const ownerScope = {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
					language: source.language,
					userId: source.ownerUserId,
				} as const;
				const validated = validateRyotQLDocument(
					{ queries: { subjects: source.scope.query } },
					ownerScope,
				);
				const query = validated.value?.queries["subjects"];
				const subjectTable = [
					...(query ? [query.from] : []),
					...(query?.joins ?? []).flatMap((join) =>
						join.type === "jsonElements" ? [] : [join.table],
					),
				].find(({ alias }) => alias === source.scope.subjectAlias)?.table;
				if (
					validated.error !== null ||
					query?.output.type !== "rows" ||
					subjectTable !== "entity"
				) {
					yield* Effect.logWarning("Publication scope is invalid", {
						diagnostic: validated.error ?? "The subject must be an entity alias of a rows query",
					});
					return yield* invalidQuery();
				}
				const bound = yield* bindDocument(
					validated.value,
					ownerScope,
					readyUserPlugins(source.ownerUserId),
				);
				const boundQuery = bound.queries["subjects"];
				if (boundQuery?.output.type !== "rows") {
					return yield* invalidQuery();
				}
				const subjects = yield* executeSubjectSet(
					ownerScope,
					{ ...boundQuery, output: boundQuery.output },
					source.scope.subjectAlias,
					source.subjectLimit,
					transaction,
					(names) => loadCatalogRelations(catalogs, source.ownerUserId, names),
				);
				if (subjects.length > source.subjectLimit) {
					return yield* new RyotQLBadRequest({
						reason: { limit: source.subjectLimit, code: "subject-limit-exceeded" },
					});
				}
				return subjects;
			});

			const resolvePublicationSubjects = (source: PublicationSubjectQuery) =>
				runRead(PUBLICATION_STATEMENT_TIMEOUT_MS, (transaction) =>
					readSubjects(transaction, source),
				);

			const executeForPublication = Effect.fn("RyotQLService.executeForPublication")(function* (
				source: PublicationSubjectQuery,
				document: RyotQLDocument,
				resultBytes: number,
			) {
				const validated = validateRyotQLDocument(document, { type: "publication" });
				if (validated.error !== null) {
					yield* Effect.logWarning("Publication RyotQL validation failed", {
						diagnostic: validated.error,
					});
					return yield* invalidQuery();
				}
				return yield* runRead(PUBLICATION_STATEMENT_TIMEOUT_MS, (transaction) =>
					Effect.gen(function* () {
						const subjects = yield* readSubjects(transaction, source);
						const scope = {
							type: "publication",
							language: source.language,
							ownerUserId: source.ownerUserId,
							subjectsJson: yield* Schema.encodeEffect(SubjectsJson)(
								subjects.map(({ rank, entityId }) => ({ rank, entity_id: entityId })),
							).pipe(Effect.orDie),
						} as const;
						return yield* runDocument(transaction, scope, validated.value, {
							resultBytes,
							relationsOwner: source.ownerUserId,
							loadCatalog: Effect.map(readyUserPlugins(source.ownerUserId), (plugins) =>
								plugins.filter((entry) => entry.scope === "system"),
							),
						});
					}),
				);
			});

			const executeForUser = (
				userId: string,
				language: null | string,
				audience: RyotQLAudience,
				document: RyotQLDocument,
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
				return executeWithScope(scope, document, resultBytes).pipe(
					Effect.catchIf(
						(error): boolean =>
							error instanceof RyotQLBadRequest &&
							error.reason.code === "invalid-query" &&
							accessClass === "demo" &&
							validateRyotQLDocument(document, { ...scope, accessClass: "standard" }).error ===
								null,
						() => new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
					),
				);
			};

			const executeForPlugin = (
				scope: Omit<Extract<RyotQLExecutionScope, { type: "plugin" }>, "type">,
				document: RyotQLDocument,
				resultBytes: number,
			) => executeWithScope({ ...scope, type: "plugin" }, document, resultBytes);

			const executeForAdmin = (document: RyotQLDocument) =>
				executeWithScope({ type: "admin" }, document);

			const execute = (
				user: CurrentUserValue,
				document: RyotQLDocument,
				accessClass: AccessClass,
			) => executeForUser(user.id, user.preferences.language, "kernel", document, accessClass);

			const executeForPluginAudience = (
				user: CurrentUserValue,
				document: RyotQLDocument,
				accessClass: AccessClass,
			) => executeForUser(user.id, user.preferences.language, "plugin", document, accessClass);

			return {
				execute,
				executeForUser,
				executeForAdmin,
				executeForPlugin,
				executeForPublication,
				executeForPluginAudience,
				resolvePublicationSubjects,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
