import { and, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, TransactionRunner } from "~/lib/db";
import * as schema from "~/lib/db/schema";
import type { DbError } from "~/lib/errors";

import { builtinEntitySchemas } from "./entity-schemas";
import { builtinSavedViews } from "./saved-views";
import { builtinTrackers } from "./trackers";
import { buildDefaultQueryDefinition } from "./view-helpers";

export type UserPreferences = {
	readonly isNsfw: boolean;
	readonly disableIntegrations: boolean;
	readonly languages: {
		readonly providers: ReadonlyArray<{
			readonly source: string;
			readonly preferredLanguage: string;
		}>;
	};
};

export const defaultUserPreferences: UserPreferences = {
	isNsfw: false,
	disableIntegrations: false,
	languages: {
		providers: [
			{ preferredLanguage: "US", source: "audible" },
			{ preferredLanguage: "user_preferred", source: "anilist" },
		],
	},
};

// Step 1: Insert builtin trackers for user; returns { id, slug }[] in slug order.
const createBuiltinTrackers = (userId: string) =>
	Effect.gen(function* () {
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
		const rows = yield* dbEffect(() =>
			db
				.select({ id: schema.tracker.id, slug: schema.tracker.slug })
				.from(schema.tracker)
				.where(and(eq(schema.tracker.userId, userId), inArray(schema.tracker.slug, slugs))),
		);

		return rows;
	});

// Step 2: Load the seeded builtin entity schemas (global, no userId).
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
	return rows;
});

type TrackerRow = { id: string; slug: string };
type EntitySchemaRow = { accentColor: string; icon: string; id: string; slug: string };

// Step 3: Link builtin entity schemas to their corresponding tracker.
const createTrackerEntitySchemaLinks = (trackers: TrackerRow[], entitySchemas: EntitySchemaRow[]) =>
	Effect.gen(function* () {
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

// Step 4: Create the default builtin saved views for the user.
const createBuiltinSavedViews = (
	userId: string,
	trackers: TrackerRow[],
	entitySchemas: EntitySchemaRow[],
) =>
	Effect.gen(function* () {
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

			const queryDefinition =
				view.queryDefinition ??
				(entitySchema
					? buildDefaultQueryDefinition([entitySchema.slug], {
							relationshipJoins: view.relationshipJoins,
						})
					: null);

			if (!queryDefinition) {
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
					name: view.name,
					isBuiltin: true,
					slug: view.slug,
					trackerId: tracker?.id ?? null,
					queryDefinition: queryDefinition as Record<string, unknown>,
					displayConfiguration: view.displayConfiguration as Record<string, unknown>,
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
				.onConflictDoNothing({ target: [schema.savedView.userId, schema.savedView.slug] }),
		);
	});

// Step 5: Ensure the user's library entity exists (idempotent).
const ensureLibraryEntity = (userId: string, entitySchemas: EntitySchemaRow[]) =>
	Effect.gen(function* () {
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

const performBootstrap = (userId: string): Effect.Effect<void, DbError, CurrentDb> =>
	Effect.gen(function* () {
		const trackers = yield* createBuiltinTrackers(userId);
		const entitySchemas = yield* listBuiltinEntitySchemas;
		yield* createTrackerEntitySchemaLinks(trackers, entitySchemas);
		yield* createBuiltinSavedViews(userId, trackers, entitySchemas);
		yield* ensureLibraryEntity(userId, entitySchemas);
		yield* Effect.logInfo("Bootstrap complete", { userId });
	});

export const bootstrapNewUser = (userId: string): Effect.Effect<void, DbError, TransactionRunner> =>
	Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		yield* runner(performBootstrap(userId));
	}).pipe(Effect.withSpan("bootstrapNewUser", { attributes: { userId } }));
