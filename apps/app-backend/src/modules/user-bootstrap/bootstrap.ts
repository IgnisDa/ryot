import { DbError } from "@ryot/contract/errors";
import type { TrackerId } from "@ryot/contract/schema/brands";
import { EntitySchemaId, UserId } from "@ryot/contract/schema/brands";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import { builtinEntitySchemas } from "#modules/builtins/entity-schemas";
import { builtinSavedViews } from "#modules/builtins/saved-views";
import { builtinTrackers } from "#modules/builtins/trackers";
import { EntitiesService } from "#modules/entities/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { TrackersService } from "#modules/trackers/service";

const createBuiltinTrackers = Effect.fn(function* (
	userId: string,
	trackersService: TrackersService,
) {
	const trackers = builtinTrackers();

	if (trackers.length === 0) {
		return [];
	}

	const user = { id: UserId.make(userId) };
	for (const tracker of trackers) {
		yield* trackersService
			.create(user, { ...tracker, isBuiltin: true })
			.pipe(Effect.catchTag("Conflict", () => Effect.void));
	}

	const builtinSlugs = new Set(trackers.map((tracker) => tracker.slug));
	return (yield* trackersService.list(user, true))
		.filter((tracker) => tracker.isBuiltin && builtinSlugs.has(tracker.slug))
		.map(({ id, slug }) => ({ id, slug }));
});

const listBuiltinEntitySchemas = Effect.gen(function* () {
	const db = yield* CurrentDb;
	const rows = yield* dbEffect(() =>
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

	return rows.map((row) => ({
		accentColor: row.accentColor,
		icon: row.icon,
		id: EntitySchemaId.make(row.id),
		slug: row.slug,
	}));
});

export const acquireBootstrapLock = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	yield* dbEffect(() =>
		db.execute(sql`select pg_advisory_xact_lock(hashtext(${`builtins:bootstrap:${userId}`}))`),
	);
});

type TrackerRow = { id: TrackerId; slug: string };
type EntitySchemaRow = { accentColor: string; icon: string; id: EntitySchemaId; slug: string };

const createTrackerEntitySchemaLinks = Effect.fn(function* (
	trackers: TrackerRow[],
	entitySchemas: EntitySchemaRow[],
	trackersService: TrackersService,
) {
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

	for (const link of links) {
		yield* trackersService.linkEntitySchema(link);
	}
});

const createBuiltinSavedViews = Effect.fn(function* (
	userId: UserId,
	trackers: TrackerRow[],
	entitySchemas: EntitySchemaRow[],
	savedViewsService: SavedViewsService,
) {
	const views = builtinSavedViews();

	if (views.length === 0) {
		return;
	}

	for (const view of views) {
		const tracker = view.trackerSlug
			? trackers.find((t) => t.slug === view.trackerSlug)
			: undefined;
		const entitySchema = view.entitySchemaSlug
			? entitySchemas.find((es) => es.slug === view.entitySchemaSlug)
			: undefined;

		if (view.trackerSlug && !tracker) {
			continue;
		}
		if (view.entitySchemaSlug && !entitySchema) {
			continue;
		}

		const icon = view.icon ?? entitySchema?.icon;
		const accentColor = view.accentColor ?? entitySchema?.accentColor;

		if (!icon || !accentColor) {
			continue;
		}

		const queryDocument = entitySchema
			? (view.queryDocument ??
				buildDefaultSavedViewQueryDocument({
					schemas: [entitySchema.slug],
					requireInLibrary: view.requireInLibrary,
				}))
			: null;

		if (!queryDocument) {
			continue;
		}

		yield* savedViewsService
			.create(
				{ id: userId },
				{
					icon,
					accentColor,
					queryDocument,
					name: view.name,
					isBuiltin: true,
					slug: view.slug,
					trackerId: tracker?.id,
					displayConfiguration: view.displayConfiguration,
				},
			)
			.pipe(
				Effect.catchTag("BadRequest", (error) =>
					error.message === "A saved view with this name already exists"
						? Effect.void
						: Effect.fail(error),
				),
			);
	}
});

const ensureLibraryEntity = Effect.fn(function* (
	userId: UserId,
	entitySchemas: EntitySchemaRow[],
	entitiesService: EntitiesService,
) {
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

	yield* entitiesService
		.create({
			userId,
			scope: "user",
			properties: {},
			name: "Library",
			entitySchemaId: librarySchema.id,
		})
		.pipe(
			Effect.mapError((error) =>
				error._tag === "NotFound" ? new DbError({ message: error.message }) : error,
			),
		);
});

const readBootstrapMarker = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	const [row] = yield* dbEffect(() =>
		db
			.select({ bootstrapCompletedAt: schema.user.bootstrapCompletedAt })
			.from(schema.user)
			.where(eq(schema.user.id, userId))
			.for("update"),
	);
	return row?.bootstrapCompletedAt ?? null;
});

const markBootstrapComplete = Effect.fn(function* (userId: string) {
	const db = yield* CurrentDb;
	yield* dbEffect(() =>
		db
			.update(schema.user)
			.set({ bootstrapCompletedAt: new Date() })
			.where(eq(schema.user.id, userId)),
	);
});

export const performBootstrap = Effect.fn(function* (userId: string) {
	const user = UserId.make(userId);
	yield* acquireBootstrapLock(userId);
	const trackersService = yield* TrackersService;
	const entitiesService = yield* EntitiesService;
	const savedViewsService = yield* SavedViewsService;
	const completedAt = yield* readBootstrapMarker(userId);
	if (completedAt !== null) {
		yield* Effect.logInfo(`Bootstrap already complete for user: ${userId}`);
		return;
	}
	const trackers = yield* createBuiltinTrackers(userId, trackersService);
	const entitySchemas = yield* listBuiltinEntitySchemas;
	yield* createTrackerEntitySchemaLinks(trackers, entitySchemas, trackersService);
	yield* createBuiltinSavedViews(user, trackers, entitySchemas, savedViewsService);
	yield* ensureLibraryEntity(user, entitySchemas, entitiesService);
	yield* markBootstrapComplete(userId);
	yield* Effect.logInfo(`Bootstrap complete for user: ${userId}`);
});

export const bootstrapNewUser = (userId: string) =>
	Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		yield* runner(performBootstrap(userId));
	}).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));
