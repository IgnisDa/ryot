import { DbError } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { DefinitionOwner, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Schema, Struct } from "effect";

import { lockPluginIngestionShared } from "#lib/infrastructure/db/advisory-locks";
import { ownerWhere } from "#lib/infrastructure/db/definition-owner";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	SandboxExecutionPrincipal,
	sandboxSubjectUserId,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxRepository } from "#modules/sandbox/repository";

export const DomainLifecycleCommand = Schema.Struct({
	...LifecycleCommand.fields,
	writeContext: Schema.NullOr(SandboxExecutionPrincipal),
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

export class DomainWriteConflict extends Schema.TaggedError<DomainWriteConflict>()(
	"DomainWriteConflict",
	{
		message: Schema.String,
		reason: Schema.Union([
			Schema.Struct({
				actual: DefinitionOwner,
				expected: DefinitionOwner,
				code: Schema.Literal("owner-mismatch"),
			}),
			Schema.Struct({ code: Schema.Literal("global-scope-forbidden") }),
		]),
	},
) {}

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

export const domainWriteOwner = (
	command: Pick<DomainLifecycleCommand, "writeContext" | "kernelCollection">,
	owner: DefinitionOwner,
) => {
	const plugin = command.writeContext?.pluginRevision;
	return (
		!plugin ||
		(owner.kind === "plugin" && owner.pluginId === plugin.id) ||
		(owner.kind === "kernel" && command.kernelCollection === true)
	);
};

export const makeDomainWriteChecks = (session: DatabaseSession["Service"]) => {
	const check = Effect.fnUntraced(function* (
		command: Pick<DomainLifecycleCommand, "writeContext" | "kernelCollection">,
		owner: DefinitionOwner,
		scopeUserId: string | null,
		lock = false,
	) {
		if (lock) {
			yield* session.requireTransaction.pipe(
				Effect.mapError(
					() => new DbError({ message: "Domain authority commit checks require a transaction" }),
				),
			);
			yield* lockPluginIngestionShared(session);
		}
		const principal = command.writeContext;
		if (principal === null) {
			return null;
		}
		const plugin = principal.pluginRevision;
		const userId = sandboxSubjectUserId(principal.subject);
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
				return yield* new DbError({ message: "Domain writer has no persisted plugin authority" });
			}
			return null;
		}
		if (lock) {
			yield* session.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock_shared(hashtext(${`plugin-config:${plugin.id}`}))`,
				),
			);
		}
		const [revision] = yield* session.run((db) =>
			db
				.select({ manifest: tables.pluginRevision.manifest })
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
						sql`${tables.pluginRevision.manifest} -> 'metadata' ->> 'packageId' = ${plugin.packageId}`,
						eq(tables.plugin.status, "active"),
						eq(tables.pluginRevision.id, plugin.revisionId),
						isNull(tables.pluginConfigRevision.payloadPrunedAt),
						plugin.ownerId === null
							? isNull(tables.plugin.ownerId)
							: eq(tables.plugin.ownerId, plugin.ownerId),
						plugin.scope === "user"
							? eq(tables.pluginConfigRevision.ownerUserId, plugin.ownerId ?? "")
							: undefined,
					),
				)
				.limit(1),
		);
		if (!revision) {
			return yield* new DbError({ message: "Pinned domain write authority is unavailable" });
		}
		if (userId !== null) {
			const queryInstallation = () =>
				session.run((db) => {
					const query = db
						.select({
							id: tables.pluginInstallation.id,
							activationId: tables.plugin.activationId,
							health: tables.pluginInstallation.health,
							isHidden: tables.pluginInstallation.isHidden,
							isInitialized: tables.pluginInstallation.isInitialized,
							uninstalledAt: tables.pluginInstallation.uninstalledAt,
							ingestionRetiring: tables.pluginInstallation.ingestionRetiring,
							incompatibilityReason: tables.pluginInstallation.incompatibilityReason,
						})
						.from(tables.pluginInstallation)
						.innerJoin(tables.plugin, eq(tables.plugin.id, tables.pluginInstallation.pluginId))
						.where(
							and(
								eq(tables.pluginInstallation.pluginId, plugin.id),
								eq(tables.pluginInstallation.userId, userId),
							),
						)
						.limit(1);
					return lock ? query.for("share", { of: tables.pluginInstallation }) : query;
				});
			const [installation] = yield* queryInstallation();
			if (
				installation?.uninstalledAt !== null ||
				installation.ingestionRetiring ||
				installation.incompatibilityReason !== null
			) {
				return yield* new DbError({
					message: "Current domain write installation authority is unavailable",
				});
			}
			const [account] = yield* session.run((db) => {
				const query = db
					.select({ disabledAt: tables.user.disabledAt, token: tables.user.accountGeneration })
					.from(tables.user)
					.where(eq(tables.user.id, userId))
					.limit(1);
				return lock ? query.for("share") : query;
			});
			if (
				account?.disabledAt !== null ||
				principal.subject.type === "system" ||
				account.token !== principal.subject.accountGeneration?.token
			) {
				return yield* new DbError({
					message: "Current domain write account authority is unavailable",
				});
			}
		}
		const sandbox = yield* SandboxRepository.make.pipe(
			Effect.provideService(DatabaseSession, session),
		);
		const pinned = yield* sandbox
			.getScriptPin(principal.scriptId, plugin, principal.subject, principal.initialization)
			.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
		if (pinned === null) {
			return yield* new DbError({ message: "Pinned domain write authority is unavailable" });
		}
		const stored = yield* Schema.decodeEffect(SandboxExecutionPrincipal)({
			...pinned,
			subject: principal.subject,
		}).pipe(
			Effect.mapError(() => new DbError({ message: "Invalid persisted domain write authority" })),
		);
		const validated = yield* Schema.decodeEffect(SandboxExecutionPrincipal)(principal).pipe(
			Effect.mapError(() => new DbError({ message: "Invalid domain write principal" })),
		);
		if (stableStringify(stored) !== stableStringify(validated)) {
			return yield* new DbError({
				message: "Pinned domain write authority does not match the current persisted principal",
			});
		}
		return owner.kind === "kernel" && command.kernelCollection === true ? null : revision.manifest;
	});
	const checkProvider = Effect.fnUntraced(function* (providerId: string, owner: DefinitionOwner) {
		const [provider] = yield* session.run((db) =>
			db
				.select({
					id: tables.sandboxProvider.id,
					slug: tables.sandboxProvider.slug,
					pluginId: tables.sandboxProvider.pluginId,
					rootEntitySchemaSlug: tables.sandboxProvider.rootEntitySchemaSlug,
				})
				.from(tables.sandboxProvider)
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
	const activeManifest = Effect.fnUntraced(function* (pluginId: string) {
		const [row] = yield* session.run((db) =>
			db
				.select({ manifest: tables.pluginRevision.manifest })
				.from(tables.plugin)
				.innerJoin(
					tables.pluginRevision,
					and(
						eq(tables.plugin.activeRevisionId, tables.pluginRevision.id),
						eq(tables.pluginRevision.pluginId, tables.plugin.id),
					),
				)
				.where(and(eq(tables.plugin.id, pluginId), eq(tables.plugin.status, "active")))
				.limit(1),
		);
		if (!row) {
			return yield* new DbError({ message: "Active domain storage constraints are unavailable" });
		}
		return row.manifest;
	});
	return { check, checkProvider, activeManifest };
};
