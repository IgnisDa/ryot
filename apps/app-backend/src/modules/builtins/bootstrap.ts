import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";

import { builtinEntitySchemas } from "./entity-schemas";
import { builtinSavedViews } from "./saved-views";
import { builtinTrackers } from "./trackers";
import { buildDefaultQueryDocument } from "./view-helpers";

export { defaultUserPreferences, normalizeUserPreferences } from "@ryot/contract/auth-middleware";
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
type EntitySchemaRow = { accentColor: string; icon: string; id: string; slug: string };

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
				buildDefaultQueryDocument([entitySchema.slug], {
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
	const librarySchema = entitySchemas.find((s) => s.slug === "library");

	if (!librarySchema) {
		yield* Effect.logWarning(
			"Missing builtin library entity schema; skipping library entity creation",
		);
		return;
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
		return;
	}

	yield* dbEffect(() =>
		db.insert(schema.entity).values({
			userId,
			properties: {},
			name: "Library",
			externalId: null,
			sandboxScriptId: null,
			entitySchemaId: librarySchema.id,
		}),
	);
});

const performBootstrap = Effect.fn(function* (userId: string) {
	const trackers = yield* createBuiltinTrackers(userId);
	const entitySchemas = yield* listBuiltinEntitySchemas;
	yield* createTrackerEntitySchemaLinks(trackers, entitySchemas);
	yield* createBuiltinSavedViews(userId, trackers, entitySchemas);
	yield* ensureLibraryEntity(userId, entitySchemas);
	yield* Effect.logInfo("Bootstrap complete", { userId });
});

export const bootstrapNewUser = (userId: string) =>
	Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		yield* runner(performBootstrap(userId));
	}).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));
