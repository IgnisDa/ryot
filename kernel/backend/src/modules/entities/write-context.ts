import { DbError } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { DefinitionOwner, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema, Struct } from "effect";

import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { DefinitionRepository } from "#modules/definitions/repository";
import { lockPluginIngestionShared } from "#modules/plugins/packages/ingestion-fence";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import {
	isUserBootstrapPrincipal,
	ScriptExecutionPrincipal,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { ownerWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
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

type DeclarationSlugs = {
	readonly entity: string;
	readonly relationship: string;
	readonly event: { readonly entitySchemaSlug: string; readonly eventSchemaSlug: string };
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

export type DomainWritePin = { readonly id: string };

type DomainWriteCommand = Pick<DomainLifecycleCommand, "writeContext" | "kernelCollection">;

export type DomainWriteCheck = {
	readonly owner: DefinitionOwner;
	readonly command: DomainWriteCommand;
	readonly scopeUserId: string | null;
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

export class DomainWriteChecks extends Context.Service<DomainWriteChecks>()("DomainWriteChecks", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const definitions = yield* DefinitionRepository;
		const authority = yield* SandboxExecutionAuthority;
		const check = Effect.fnUntraced(function* (
			command: DomainWriteCommand,
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
					.select({ id: tables.pluginRevision.id })
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
			);
			if (!revision) {
				return yield* new DbError({ message: "Pinned domain write authority is unavailable" });
			}
			if (userId !== null) {
				const [installation] = yield* session.run((db) => {
					const query = db
						.select({
							uninstalledAt: tables.pluginInstallation.uninstalledAt,
							ingestionRetiring: tables.pluginInstallation.ingestionRetiring,
							incompatibilityReason: tables.pluginInstallation.incompatibilityReason,
						})
						.from(tables.pluginInstallation)
						.where(
							and(
								eq(tables.pluginInstallation.pluginId, plugin.id),
								eq(tables.pluginInstallation.userId, userId),
							),
						)
						.limit(1);
					return lock ? query.for("share", { of: tables.pluginInstallation }) : query;
				});
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
					!account ||
					(account.disabledAt !== null && !isUserBootstrapPrincipal(principal)) ||
					principal.subject.type === "system" ||
					account.token !== principal.subject.accountGeneration?.token
				) {
					return yield* new DbError({
						message: "Current domain write account authority is unavailable",
					});
				}
			}
			yield* authority
				.resolve(principal)
				.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
			return owner.kind === "kernel" && command.kernelCollection === true ? null : revision;
		});
		const checkMany = Effect.fnUntraced(function* (checks: ReadonlyArray<DomainWriteCheck>) {
			const pins = new Map<string, DomainWritePin | null>();
			for (const input of checks) {
				const key = domainWriteCheckKey(input);
				if (!pins.has(key)) {
					pins.set(key, yield* check(input.command, input.owner, input.scopeUserId, true));
				}
			}
			return (input: DomainWriteCheck) => pins.get(domainWriteCheckKey(input));
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
		const resolvePinnedDeclaration = Effect.fnUntraced(function* <K extends keyof DeclarationSlugs>(
			kind: K,
			pin: DomainWritePin | null,
			owner: DefinitionOwner,
			slug: DeclarationSlugs[K],
		) {
			if (!pin || owner.kind !== "plugin") {
				return { pinned: undefined, active: undefined };
			}
			const [plugin] = yield* session.run((db) =>
				db
					.select({ activeRevisionId: tables.pluginRevision.id })
					.from(tables.plugin)
					.innerJoin(
						tables.pluginRevision,
						and(
							eq(tables.plugin.activeRevisionId, tables.pluginRevision.id),
							eq(tables.pluginRevision.pluginId, tables.plugin.id),
						),
					)
					.where(and(eq(tables.plugin.id, owner.pluginId), eq(tables.plugin.status, "active")))
					.limit(1),
			);
			if (!plugin) {
				return yield* new DbError({ message: "Active domain storage constraints are unavailable" });
			}
			const pinned = yield* findPinnedDeclaration(kind, pin.id, slug);
			return {
				pinned,
				active:
					plugin.activeRevisionId === pin.id
						? pinned
						: yield* findPinnedDeclaration(kind, plugin.activeRevisionId, slug),
			};
		});
		return { check, checkMany, checkProvider, findPinnedDeclaration, resolvePinnedDeclaration };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const DomainWriteChecksLive = DomainWriteChecks.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			DefinitionRepository.layer,
			SandboxExecutionAuthorityLive.pipe(Layer.provide(SandboxRepository.layer)),
		),
	),
);
