import { DbError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { EntityId } from "@ryot/contract/schema/brands";
import { EntitySchemaId, UserId } from "@ryot/contract/schema/brands";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DateTime, Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	buildNotificationRuleValues,
	NOTIFICATION_SCRIPT_SLUG,
} from "#modules/automations/notification-install";
import { EntitiesService } from "#modules/entities/service";

import { builtinEntitySchemas } from "./entity-schemas";
import { builtinSavedViews } from "./saved-views";
import { builtinTrackers } from "./trackers";

export { defaultUserPreferences } from "@ryot/contract/auth-middleware";
export type { CachedUserPreferences } from "@ryot/contract/auth-middleware";

const createBuiltinTrackers = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	const trackers = builtinTrackers();

	if (trackers.length === 0) {
		return [];
	}

	yield* dbEffect(() =>
		db
			.insert(schema.tracker)
			.values(
				trackers.map((t, index) => ({
					userId,
					icon: t.icon,
					name: t.name,
					slug: t.slug,
					isBuiltin: true,
					sortOrder: index,
					accentColor: t.accentColor,
					description: t.description,
				})),
			)
			.onConflictDoNothing({ target: [schema.tracker.userId, schema.tracker.slug] }),
	);

	const slugs = trackers.map((t) => t.slug);
	return yield* dbEffect(() =>
		db
			.select({ id: schema.tracker.id, slug: schema.tracker.slug })
			.from(schema.tracker)
			.where(and(eq(schema.tracker.userId, userId), inArray(schema.tracker.slug, slugs))),
	);
});

const listBuiltinEntitySchemas = Effect.gen(function* () {
	const db = yield* CurrentDb;
	return yield* dbEffect(() =>
		db
			.select({
				id: schema.entitySchema.id,
				slug: schema.entitySchema.slug,
				icon: schema.entitySchema.icon,
				accentColor: schema.entitySchema.accentColor,
			})
			.from(schema.entitySchema)
			.where(and(eq(schema.entitySchema.isBuiltin, true), isNull(schema.entitySchema.userId))),
	);
});

type TrackerRow = { id: string; slug: string };
type BootstrapLibraryEntity = { entity: ListedEntity; schema: EntitySchemaRow };
type EntitySchemaRow = { accentColor: string; icon: string; id: string; slug: string };

export type BootstrapUserEnvelope = {
	entitySchemaSlug: string;
	entitySchemaId: EntitySchemaId;
	entity: { id: EntityId; name: string; createdAt: string; properties: unknown };
};

const createTrackerEntitySchemaLinks = Effect.fn(function* (
	trackers: TrackerRow[],
	entitySchemas: EntitySchemaRow[],
) {
	const db = yield* CurrentDb;
	const schemaLinks = builtinEntitySchemas()
		.filter((s): s is typeof s & { trackerSlug: string } => typeof s.trackerSlug === "string")
		.map((s) => ({ slug: s.slug, trackerSlug: s.trackerSlug }));

	const links = schemaLinks.flatMap((link) => {
		const tracker = trackers.find((t) => t.slug === link.trackerSlug);
		const entitySchema = entitySchemas.find((es) => es.slug === link.slug);
		if (!tracker || !entitySchema) {
			return [];
		}
		return [{ entitySchemaId: entitySchema.id, trackerId: tracker.id }];
	});

	if (links.length === 0) {
		return;
	}

	yield* dbEffect(() =>
		db
			.insert(schema.trackerEntitySchema)
			.values(links)
			.onConflictDoNothing({
				target: [schema.trackerEntitySchema.trackerId, schema.trackerEntitySchema.entitySchemaId],
			}),
	);
});

const createBuiltinSavedViews = Effect.fn(function* (
	userId: string,
	trackers: TrackerRow[],
	entitySchemas: EntitySchemaRow[],
) {
	const db = yield* CurrentDb;
	const views = builtinSavedViews();

	if (views.length === 0) {
		return;
	}

	const scopeOrderMap = new Map<string, number>();

	const values = views.flatMap((view) => {
		const tracker = view.trackerSlug
			? trackers.find((t) => t.slug === view.trackerSlug)
			: undefined;
		const entitySchema = view.entitySchemaSlug
			? entitySchemas.find((es) => es.slug === view.entitySchemaSlug)
			: undefined;

		if (view.trackerSlug && !tracker) {
			return [];
		}
		if (view.entitySchemaSlug && !entitySchema) {
			return [];
		}

		const icon = view.icon ?? entitySchema?.icon;
		const accentColor = view.accentColor ?? entitySchema?.accentColor;

		if (!icon || !accentColor) {
			return [];
		}

		const queryDocument = entitySchema
			? (view.queryDocument ??
				buildDefaultSavedViewQueryDocument({
					schemas: [entitySchema.slug],
					requireInLibrary: view.requireInLibrary,
				}))
			: null;

		if (!queryDocument) {
			return [];
		}

		const scopeKey = tracker?.id ?? "__top_level__";
		const sortOrder = scopeOrderMap.get(scopeKey) ?? 0;
		scopeOrderMap.set(scopeKey, sortOrder + 1);

		return [
			{
				icon,
				userId,
				sortOrder,
				accentColor,
				queryDocument,
				name: view.name,
				isBuiltin: true,
				slug: view.slug,
				trackerId: tracker?.id ?? null,
				displayConfiguration: view.displayConfiguration,
			},
		];
	});

	if (values.length === 0) {
		return;
	}

	yield* dbEffect(() =>
		db
			.insert(schema.savedView)
			.values(values)
			.onConflictDoUpdate({
				target: [schema.savedView.userId, schema.savedView.slug],
				set: {
					isBuiltin: true,
					icon: sql`excluded.icon`,
					name: sql`excluded.name`,
					sortOrder: sql`excluded.sort_order`,
					trackerId: sql`excluded.tracker_id`,
					accentColor: sql`excluded.accent_color`,
					queryDocument: sql`excluded.query_document`,
					displayConfiguration: sql`excluded.display_configuration`,
				},
			}),
	);
});

const ensureLibraryEntity = Effect.fn(function* (userId: string, entitySchemas: EntitySchemaRow[]) {
	const db = yield* CurrentDb;
	const entities = yield* EntitiesService;
	const librarySchema = entitySchemas.find((s) => s.slug === "library");

	if (!librarySchema) {
		yield* Effect.logWarning(
			"Missing builtin library entity schema; skipping library entity creation",
		);
		return null;
	}

	const [existing] = yield* dbEffect(() =>
		db
			.select({ id: schema.entity.id })
			.from(schema.entity)
			.where(
				and(
					eq(schema.entity.userId, userId),
					eq(schema.entity.entitySchemaId, librarySchema.id),
					isNull(schema.entity.externalId),
					isNull(schema.entity.sandboxScriptId),
				),
			)
			.limit(1),
	);

	if (existing) {
		return null;
	}

	const outcome = yield* entities
		.save({
			scope: "user",
			properties: {},
			name: "Library",
			userId: UserId.make(userId),
			entitySchemaId: EntitySchemaId.make(librarySchema.id),
		})
		.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
	return outcome.operation === "create"
		? ({ entity: outcome.entity, schema: librarySchema } satisfies BootstrapLibraryEntity)
		: null;
});

const createDefaultNotificationRules = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	const [script] = yield* dbEffect(() =>
		db
			.select({ id: schema.sandboxScript.id })
			.from(schema.sandboxScript)
			.where(
				and(
					eq(schema.sandboxScript.slug, NOTIFICATION_SCRIPT_SLUG),
					eq(schema.sandboxScript.isBuiltin, true),
					isNull(schema.sandboxScript.userId),
				),
			)
			.limit(1),
	);
	if (!script) {
		return yield* Effect.die(new Error("Missing built-in notification sandbox script"));
	}
	const signalSchemas = yield* dbEffect(() =>
		db
			.select({ id: schema.signalSchema.id, name: schema.signalSchema.name })
			.from(schema.signalSchema)
			.where(
				and(
					eq(schema.signalSchema.isBuiltin, true),
					eq(schema.signalSchema.catalogState, "active"),
					isNull(schema.signalSchema.userId),
					isNull(schema.signalSchema.archivedAt),
				),
			),
	);
	yield* dbEffect(() =>
		db
			.insert(schema.automationRule)
			.values(
				signalSchemas.map((signalSchema) =>
					buildNotificationRuleValues({
						userId,
						sandboxScriptId: script.id,
						signalSchemaId: signalSchema.id,
						signalSchemaName: signalSchema.name,
					}),
				),
			)
			.onConflictDoNothing(),
	);
	return undefined;
});

export const performBootstrap = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	const completedAt = yield* DateTime.nowAsDate;
	const entitySchemas = yield* listBuiltinEntitySchemas;

	const trackers = yield* createBuiltinTrackers(userId);
	yield* createTrackerEntitySchemaLinks(trackers, entitySchemas);
	const libraryEntity = yield* ensureLibraryEntity(userId, entitySchemas);
	yield* createBuiltinSavedViews(userId, trackers, entitySchemas);
	yield* createDefaultNotificationRules(userId);
	yield* dbEffect(() =>
		db
			.update(schema.user)
			.set({ bootstrapCompletedAt: completedAt })
			.where(eq(schema.user.id, userId)),
	);
	yield* Effect.logInfo("Bootstrap complete", { userId });
	return { libraryEntity };
});

export const bootstrapNewUser = (userId: string) =>
	Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		const libraryEntity = yield* runner(
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [user] = yield* dbEffect(() =>
					db
						.select({ bootstrapCompletedAt: schema.user.bootstrapCompletedAt })
						.from(schema.user)
						.where(eq(schema.user.id, userId))
						.for("update")
						.limit(1),
				);
				if (!user || user.bootstrapCompletedAt) {
					return null;
				}
				const result = yield* performBootstrap(userId);
				return result.libraryEntity;
			}),
		);
		if (!libraryEntity) {
			return null;
		}
		return {
			entitySchemaSlug: libraryEntity.schema.slug,
			entitySchemaId: EntitySchemaId.make(libraryEntity.schema.id),
			entity: {
				id: libraryEntity.entity.id,
				name: libraryEntity.entity.name,
				createdAt: libraryEntity.entity.createdAt,
				properties: libraryEntity.entity.properties,
			},
		} satisfies BootstrapUserEnvelope;
	}).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));
