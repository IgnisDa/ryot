import { DbError } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { DefinitionOwner, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Result, Schema, Struct } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import {
	lockPluginConfigShared,
	lockPluginIngestionShared,
} from "#modules/plugins/packages/ingestion-fence";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import {
	isUserBootstrapPrincipal,
	ScriptExecutionPrincipal,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { ownerWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import {
	type WritePreparation,
	writeState,
	type WriteTransaction,
} from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";

export const DomainLifecycleCommand = Schema.Struct({
	...LifecycleCommand.fields,
	writeContext: Schema.NullOr(ScriptExecutionPrincipal),
	kernelCollection: Schema.optional(Schema.Literal(true)),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(command) =>
				Schema.is(LifecycleCommand)(Struct.omit(command, ["writeContext", "kernelCollection"])) ||
				"Invalid lifecycle account or causation context",
		),
	),
);
export type DomainLifecycleCommand = typeof DomainLifecycleCommand.Type;

export const kernelCollectionLifecycleCommand = (
	command: DomainLifecycleCommand,
): DomainLifecycleCommand => ({ ...command, kernelCollection: true });

export class DomainWriteConflict extends Schema.TaggedError<
	DomainWriteConflict,
	{ readonly brand: unique symbol }
>()("DomainWriteConflict", {
	message: Schema.String,
	reason: Schema.Union([
		Schema.Struct({
			actual: DefinitionOwner,
			expected: DefinitionOwner,
			code: Schema.Literal("owner-mismatch"),
		}),
		Schema.Struct({ code: Schema.Literal("global-scope-forbidden") }),
	]),
}) {}

const writerProperty = (property: AppPropertyDefinition): AppPropertyDefinition => {
	if (property.type === "object") {
		return {
			...property,
			unknownKeys: property.unknownKeys === "passthrough" ? "passthrough" : "strict",
			properties: Object.fromEntries(
				Object.entries(property.properties).map(([key, value]) => [key, writerProperty(value)]),
			),
		};
	}
	return property.type === "array"
		? { ...property, items: writerProperty(property.items) }
		: property;
};
export const writerPropertiesSchema = (schema: AppSchema): AppSchema => ({
	...schema,
	unknownKeys: schema.unknownKeys === "passthrough" ? "passthrough" : "strict",
	fields: Object.fromEntries(
		Object.entries(schema.fields).map(([key, value]) => [key, writerProperty(value)]),
	),
});

type DeclarationSlugs = {
	readonly entity: string;
	readonly relationship: string;
	readonly event: { readonly eventSchemaSlug: string; readonly entitySchemaSlug: string };
};

export const assertStableUnder = <E>(
	kind: string,
	propertiesSchema: AppSchema,
	properties: Record<string, unknown>,
	onError: (reason: "invalid" | "changed") => E,
) =>
	parseAppSchemaProperties({ kind, properties, propertiesSchema }).pipe(
		Effect.mapError(() => onError("invalid")),
		Effect.flatMap((parsed) =>
			stableStringify(parsed) === stableStringify(properties)
				? Effect.void
				: Effect.fail(onError("changed")),
		),
	);

export type DomainWritePin = { readonly id: string; readonly activeRevisionId: string };

export type DomainWriteCheck = {
	readonly owner: DefinitionOwner;
	readonly scopeUserId: null | string;
	readonly command: DomainWriteCommand;
};

type Principal = NonNullable<DomainWriteCommand["writeContext"]>;

type DomainWriteCommand = Pick<DomainLifecycleCommand, "writeContext" | "kernelCollection">;

type AuthorityReads = {
	readonly fence: (userIds: ReadonlyArray<string>) => Effect.Effect<void, DbError>;
	readonly revision: (
		principal: Principal,
		plugin: NonNullable<Principal["pluginRevision"]>,
	) => Effect.Effect<undefined | DomainWritePin, DbError>;
	readonly current: null | {
		readonly resolve: (principal: Principal) => Effect.Effect<unknown, DbError>;
		readonly account: (
			userId: string,
		) => Effect.Effect<undefined | { readonly disabledAt: Date | null }, DbError>;
		readonly installation: (
			pluginId: string,
			userId: string,
		) => Effect.Effect<
			| undefined
			| {
					readonly uninstalledAt: Date | null;
					readonly ingestionRetiring: boolean;
					readonly incompatibilityReason: null | string;
			  },
			DbError
		>;
	};
};

const domainWriteCheckKey = (input: DomainWriteCheck) =>
	stableStringify([
		input.command.writeContext,
		input.command.kernelCollection ?? false,
		input.owner,
		input.scopeUserId,
	]);

const domainWriteOwner = (command: DomainWriteCommand, owner: DefinitionOwner) => {
	const plugin = command.writeContext?.pluginRevision;
	return (
		!plugin ||
		(owner.kind === "plugin" && owner.pluginId === plugin.id) ||
		(owner.kind === "kernel" && command.kernelCollection === true)
	);
};

const once = <A, E, R>(
	entries: Map<string, Result.Result<A, E>>,
	key: string,
	read: Effect.Effect<A, E, R>,
) =>
	Effect.suspend(() => {
		const known = entries.get(key);
		return known
			? Effect.fromResult(known)
			: Effect.flatMap(Effect.result(read), (result) => {
					entries.set(key, result);
					return Effect.fromResult(result);
				});
	});

/** Each writer's pinned and active revision, read once across one commit's preparation. */
const preparedPins = writeState(
	() => new Map<string, Result.Result<undefined | DomainWritePin, DbError>>(),
);

export class DomainWriteChecks extends Context.Service<DomainWriteChecks>()(
	"@ryot-app/kernel-backend/modules/entities/write-context/DomainWriteChecks",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalogs = yield* DefinitionCatalog;
			const definitions = yield* DefinitionRepository;
			const authority = yield* SandboxExecutionAuthority;
			const readRevision: AuthorityReads["revision"] = (principal, plugin) =>
				session
					.run((db) =>
						db
							.select({
								id: tables.pluginRevision.id,
								activeRevisionId: tables.plugin.activeRevisionId,
							})
							.from(tables.pluginRevision)
							.innerJoin(tables.plugin, eq(tables.plugin.id, tables.pluginRevision.pluginId))
							.innerJoin(
								tables.sandboxScript,
								and(
									eq(tables.sandboxScript.id, principal.scriptId),
									eq(tables.sandboxScript.pluginRevisionId, tables.pluginRevision.id),
									eq(tables.sandboxScript.slug, principal.scriptSlug),
									eq(tables.sandboxScript.contentHash, principal.contentHash),
								),
							)
							.innerJoin(
								tables.pluginConfigRevision,
								and(
									eq(tables.pluginConfigRevision.id, plugin.configRevisionId),
									eq(tables.pluginConfigRevision.pluginRevisionId, tables.pluginRevision.id),
								),
							)
							.where(
								and(
									eq(tables.plugin.id, plugin.id),
									eq(tables.plugin.packageId, plugin.packageId),
									eq(tables.pluginRevision.packageId, plugin.packageId),
									eq(tables.plugin.status, "active"),
									eq(tables.pluginRevision.id, plugin.revisionId),
									isNull(tables.pluginConfigRevision.payloadPrunedAt),
									...(plugin.ownerId === null
										? [isNull(tables.plugin.ownerId)]
										: [
												eq(tables.plugin.ownerId, plugin.ownerId),
												eq(tables.pluginConfigRevision.ownerUserId, plugin.ownerId),
											]),
								),
							)
							.limit(1),
					)
					.pipe(
						Effect.map(([row]) =>
							row?.activeRevisionId
								? { id: row.id, activeRevisionId: row.activeRevisionId }
								: undefined,
						),
					);
			const readInstallation = (pluginId: string, userId: string, lock: boolean) =>
				session
					.run((db) => {
						const query = db
							.select({
								uninstalledAt: tables.pluginInstallation.uninstalledAt,
								ingestionRetiring: tables.pluginInstallation.ingestionRetiring,
								incompatibilityReason: tables.pluginInstallation.incompatibilityReason,
							})
							.from(tables.pluginInstallation)
							.where(
								and(
									eq(tables.pluginInstallation.pluginId, pluginId),
									eq(tables.pluginInstallation.userId, userId),
								),
							)
							.limit(1);
						return lock ? query.for("share", { of: tables.pluginInstallation }) : query;
					})
					.pipe(Effect.map(([row]) => row));
			const readAccount = (userId: string, lock: boolean) =>
				session
					.run((db) => {
						const query = db
							.select({ disabledAt: tables.user.disabledAt })
							.from(tables.user)
							.where(eq(tables.user.id, userId))
							.limit(1);
						return lock ? query.for("share") : query;
					})
					.pipe(Effect.map(([row]) => row));
			const resolveAuthority = (principal: Principal) =>
				authority
					.resolve(principal)
					.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
			const unlockedReads: AuthorityReads = {
				revision: readRevision,
				fence: () => Effect.void,
				current: {
					resolve: resolveAuthority,
					account: (userId) => readAccount(userId, false),
					installation: (pluginId, userId) => readInstallation(pluginId, userId, false),
				},
			};
			const preparedReads = (preparation: WritePreparation): AuthorityReads => ({
				current: null,
				fence: () => Effect.void,
				revision: (principal, plugin) =>
					once(
						preparedPins(preparation),
						stableStringify(principal),
						readRevision(principal, plugin),
					),
			});
			/**
			 * Under the configuration lock and the catalog lock its commit took first, a writer whose
			 * prepared pin still names the plugin's active revision and active configuration revision reads
			 * nothing again: revision, script and configuration rows never change, the catalog lock keeps
			 * the plugin active on that revision, and an active configuration revision is never pruned.
			 */
			const lockedRevision = Effect.fnUntraced(function* (
				transaction: WriteTransaction,
				principal: Principal,
				plugin: NonNullable<Principal["pluginRevision"]>,
			) {
				yield* lockPluginConfigShared(session, [plugin.id], transaction);
				const userId = sandboxSubjectUserId(principal.subject);
				const prepared = transaction.preparation
					? preparedPins(transaction.preparation).get(stableStringify(principal))
					: undefined;
				const pin = prepared && Result.isSuccess(prepared) ? prepared.success : undefined;
				if (pin && userId !== null) {
					const current = (yield* catalogs.userPlugins(userId, transaction)).find(
						({ pluginId }) => pluginId === plugin.id,
					);
					if (
						current?.isExecutable &&
						current.activeRevisionId === pin.activeRevisionId &&
						current.configRevisionId === plugin.configRevisionId
					) {
						return pin;
					}
				}
				return yield* readRevision(principal, plugin);
			});
			// A transaction's locked reads hold their locks until it ends, and the commit changes no
			// plugin, installation, or account rows, so each read stays valid for the rest of it.
			const lockedReads = writeState((transaction: WriteTransaction): AuthorityReads => {
				const revisions = new Map<string, Result.Result<undefined | DomainWritePin, DbError>>();
				const resolved = new Map<string, Result.Result<unknown, DbError>>();
				const accounts = new Map<
					string,
					Result.Result<undefined | { readonly disabledAt: Date | null }, DbError>
				>();
				const installations = new Map<
					string,
					Result.Result<Effect.Success<ReturnType<typeof readInstallation>>, DbError>
				>();
				return {
					fence: (userIds) => lockPluginIngestionShared(session, userIds, transaction),
					revision: (principal, plugin) =>
						once(
							revisions,
							stableStringify(principal),
							lockedRevision(transaction, principal, plugin),
						),
					current: {
						account: (userId) => once(accounts, userId, readAccount(userId, true)),
						resolve: (principal) =>
							once(resolved, stableStringify(principal), resolveAuthority(principal)),
						installation: (pluginId, userId) =>
							once(
								installations,
								stableStringify([pluginId, userId]),
								readInstallation(pluginId, userId, true),
							),
					},
				};
			});
			const authorize = Effect.fnUntraced(function* (
				command: DomainWriteCommand,
				owner: DefinitionOwner,
				scopeUserId: null | string,
				reads: AuthorityReads,
			) {
				const principal = command.writeContext;
				const userId = principal === null ? null : sandboxSubjectUserId(principal.subject);
				yield* reads.fence([userId, scopeUserId].filter((id) => id !== null));
				if (principal === null) {
					return null;
				}
				const plugin = principal.pluginRevision;
				if (!domainWriteOwner(command, owner) && plugin) {
					return yield* new DomainWriteConflict({
						message: "Domain write belongs to another definition owner",
						reason: { actual: owner, code: "owner-mismatch", expected: definitionOwner(plugin.id) },
					});
				}
				if (plugin?.scope === "user" && scopeUserId === null) {
					return yield* new DomainWriteConflict({
						reason: { code: "global-scope-forbidden" },
						message: "Private domain writers cannot write global data",
					});
				}
				if (scopeUserId !== null && scopeUserId !== userId) {
					return yield* new DbError({
						message: "Domain write authority does not match the stored owner or scope",
					});
				}
				if (plugin === null) {
					if (principal.kernelScript !== true) {
						return yield* new DbError({
							message: "Domain writer has no persisted plugin authority",
						});
					}
					return null;
				}
				const pinned = owner.kind !== "kernel" || command.kernelCollection !== true;
				const { current } = reads;
				if (current === null && !pinned) {
					return null;
				}
				const revision = yield* reads.revision(principal, plugin);
				if (!revision) {
					return yield* new DbError({ message: "Pinned domain write authority is unavailable" });
				}
				if (current === null) {
					return revision;
				}
				if (userId !== null) {
					const installation = yield* current.installation(plugin.id, userId);
					if (
						installation?.uninstalledAt !== null ||
						installation.ingestionRetiring ||
						installation.incompatibilityReason !== null
					) {
						return yield* new DbError({
							message: "Current domain write installation authority is unavailable",
						});
					}
					const account = yield* current.account(userId);
					if (
						!account ||
						(account.disabledAt !== null && !isUserBootstrapPrincipal(principal)) ||
						principal.subject.type === "system"
					) {
						return yield* new DbError({
							message: "Current domain write account authority is unavailable",
						});
					}
				}
				yield* current.resolve(principal);
				return pinned ? revision : null;
			});
			/**
			 * Checks a domain write against its writer's stored authority. A check given its transaction
			 * is locked: it takes the ingestion fence, the writer's configuration lock, and shared row locks
			 * on its installation and account, reading each once per transaction.
			 */
			const check = (
				command: DomainWriteCommand,
				owner: DefinitionOwner,
				scopeUserId: null | string,
				transaction?: WriteTransaction,
			) =>
				transaction
					? session.requireTransaction.pipe(
							Effect.mapError(
								() =>
									new DbError({ message: "Domain authority commit checks require a transaction" }),
							),
							Effect.andThen(
								Effect.suspend(() =>
									authorize(command, owner, scopeUserId, lockedReads(transaction)),
								),
							),
						)
					: authorize(command, owner, scopeUserId, unlockedReads);
			/**
			 * Resolves the pin a prepared write validates against from the owner and scope rules and the
			 * writer's revisions, unlocked and once per preparation. The commit's locked check decides
			 * installation, account, and execution authority.
			 */
			const preparePin = (
				command: DomainWriteCommand,
				owner: DefinitionOwner,
				scopeUserId: null | string,
				preparation: WritePreparation,
			) => authorize(command, owner, scopeUserId, preparedReads(preparation));
			const checkMany = Effect.fnUntraced(function* (
				checks: ReadonlyArray<DomainWriteCheck>,
				transaction: WriteTransaction,
			) {
				const pins = new Map<string, null | DomainWritePin>();
				for (const input of checks) {
					pins.set(
						domainWriteCheckKey(input),
						yield* check(input.command, input.owner, input.scopeUserId, transaction),
					);
				}
				return (input: DomainWriteCheck) => pins.get(domainWriteCheckKey(input));
			});
			const checkProvider = Effect.fnUntraced(function* (
				providerId: string,
				owner: DefinitionOwner,
			) {
				const [provider] = yield* session.run((db) =>
					db
						.select({
							id: tables.sandboxProvider.id,
							ownerId: tables.plugin.ownerId,
							slug: tables.sandboxProvider.slug,
							pluginId: tables.sandboxProvider.pluginId,
							rootEntitySchemaSlug: tables.sandboxProvider.rootEntitySchemaSlug,
						})
						.from(tables.sandboxProvider)
						.innerJoin(tables.plugin, eq(tables.plugin.id, tables.sandboxProvider.pluginId))
						.where(
							and(
								eq(tables.sandboxProvider.id, providerId),
								ownerWhere(tables.sandboxProvider.pluginId, owner),
							),
						)
						.limit(1),
				);
				if (!provider) {
					return yield* new DbError({
						message: "Provider identity does not belong to the entity schema owner",
					});
				}
				return provider;
			});
			const findPinnedDeclaration = Effect.fnUntraced(function* <K extends keyof DeclarationSlugs>(
				kind: K,
				revisionId: string,
				slug: DeclarationSlugs[K],
			) {
				const lookup =
					typeof slug === "string"
						? { slug }
						: { slug: slug.eventSchemaSlug, entitySchemaSlug: slug.entitySchemaSlug };
				return yield* definitions.findRevisionDeclaration({ kind, revisionId, ...lookup });
			});
			const resolvePinnedDeclaration = Effect.fnUntraced(function* <
				K extends keyof DeclarationSlugs,
			>(kind: K, pin: null | DomainWritePin, owner: DefinitionOwner, slug: DeclarationSlugs[K]) {
				if (!pin || owner.kind !== "plugin") {
					return { pinned: undefined, active: undefined };
				}
				const pinned = yield* findPinnedDeclaration(kind, pin.id, slug);
				return {
					pinned,
					active:
						pin.activeRevisionId === pin.id
							? pinned
							: yield* findPinnedDeclaration(kind, pin.activeRevisionId, slug),
				};
			});
			return {
				check,
				checkMany,
				preparePin,
				checkProvider,
				findPinnedDeclaration,
				resolvePinnedDeclaration,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const DomainWriteChecksLive = DomainWriteChecks.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			DefinitionCatalog.layer,
			DefinitionRepository.layer,
			SandboxExecutionAuthorityLive.pipe(Layer.provide(SandboxRepository.layer)),
		),
	),
);
