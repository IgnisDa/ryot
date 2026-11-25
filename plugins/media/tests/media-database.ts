import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { stampRyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { fixturePlugin } from "@ryot-app/fixture-plugin";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import * as tables from "@ryot-app/kernel-backend/schema/tables/combined";
import { makeAppConfigLayer } from "@ryot-app/kernel-backend/testing/effect";
import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import type { AuthoredAppSchema } from "@ryot-app/plugin-kit/schema";
import { Effect, Layer, Result } from "effect";

import {
	librarySummaryKind,
	librarySummaryProperties,
	librarySummarySourceRecipe,
} from "../shared/library-summary";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export const mediaPluginId = PluginId.make("media");
export const mediaReference = { kind: "local", pluginId: mediaPluginId } as const;
export const mediaUsers = ["owner", "other"] as const;
export type MediaUser = (typeof mediaUsers)[number];

const day = 86_400_000;
/** `days` after today's UTC midnight, the instant a date-only Media publish date stands for. */
export const utcDay = (days: number) => {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * day);
};

export const libraryId = (user: MediaUser) => `${user}-library`;
export const linkId = (user: MediaUser, entityId: string, slug: string) =>
	`${slug}:${user}:${entityId}`;

const manifest: PluginManifest = {
	crons: [],
	hooks: [],
	scripts: [],
	workflows: [],
	providers: [],
	operations: [],
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	userBootstrap: [],
	importSources: [],
	httpRateLimits: [],
	calendarSources: [],
	relationshipSchemas: [],
	integrationProviders: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	metadata: { ...fixturePlugin.metadata, packageId: PLUGIN_PACKAGE_ID },
};

/** Schemas whose `occursAt` the kernel derives from `publishDate`, as Media declares. */
const datedSchemaSlugs = ["show-episode", "podcast-episode", "movie", "anime", "book"];

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values(mediaUsers.map((id) => ({ id, name: id, email: `media-${id}@test.local` })));
			yield* db
				.insert(tables.plugin)
				.values({ id: mediaPluginId, status: "inactive", packageId: PLUGIN_PACKAGE_ID });
			const { metadata, ...sections } = manifest;
			yield* db
				.insert(tables.pluginRevision)
				.values({
					...sections,
					...metadata,
					manifest,
					id: "media-revision",
					contentHash: "media",
					pluginId: mediaPluginId,
					clientConfigSchema: { fields: {} },
					sandboxAuthority: {
						scriptKinds: {},
						workflowScripts: {},
						packageId: PLUGIN_PACKAGE_ID,
						userBootstrapScriptSlugs: [],
						configSchema: manifest.configSchema,
						schemaScope: {
							eventSchemas: [],
							entitySchemaSlugs: [],
							signalSchemaSlugs: [],
							relationshipSchemaSlugs: [],
						},
					},
				});
			yield* db
				.insert(tables.definitionEntitySchema)
				.values(
					datedSchemaSlugs.map((slug, position) => ({
						slug,
						position,
						icon: "calendar",
						mergeIdentityProperties: [],
						occursAtProperty: "publishDate",
						propertiesSchema: { fields: {} },
						pluginRevisionId: "media-revision",
						name: { key: slug, namespace: "media" },
					})),
				);
			yield* db
				.insert(tables.definitionRelationshipSchema)
				.values({
					position: 0,
					slug: "in-media-library",
					propertiesSchema: { fields: {} },
					pluginRevisionId: "media-revision",
					projection: { propertiesSchema: { fields: {} } },
					name: { namespace: "media", key: "in-media-library" },
				});
			yield* db.execute(
				`update plugin set status = 'active', active_revision_id = 'media-revision' where id = '${mediaPluginId}'`,
			);
			yield* db
				.insert(tables.pluginInstallation)
				.values(
					mediaUsers.map((userId) => ({
						userId,
						isInitialized: true,
						pluginId: mediaPluginId,
						id: `${userId}-installation`,
					})),
				);
			yield* db
				.insert(tables.entity)
				.values(
					mediaUsers.map((userId) => ({
						userId,
						name: "Library",
						id: libraryId(userId),
						entitySchemaSlug: "media-library",
						entitySchemaPluginId: mediaPluginId,
					})),
				);
		}),
	);
});

/** RyotQL over an isolated database holding two users with the Media plugin installed. */
export const mediaDatabaseLayer = (prefix: string) =>
	Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
		Layer.provideMerge(isolatedDatabaseLayer(prefix)),
		Layer.provide(makeAppConfigLayer()),
	);

export type MediaEntity = {
	readonly id: string;
	readonly slug: string;
	readonly name?: string;
	readonly publishDate?: Date;
	readonly properties?: Record<string, unknown>;
};

/** Global Media entities; the kernel derives a dated entity's `occursAt` from its `publishDate`. */
export const insertEntities = (entities: readonly MediaEntity[]) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values(
					entities.map((entity) => ({
						id: entity.id,
						entitySchemaSlug: entity.slug,
						name: entity.name ?? entity.id,
						entitySchemaPluginId: mediaPluginId,
						properties: {
							...(entity.publishDate ? { publishDate: entity.publishDate.toISOString() } : {}),
							...entity.properties,
						},
					})),
				),
		);
	});

export const insertRelationships = (
	relationships: ReadonlyArray<{
		readonly id?: string;
		readonly slug: string;
		readonly source: string;
		readonly target: string;
		readonly user?: MediaUser;
		readonly properties?: Record<string, unknown>;
	}>,
) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.relationship)
				.values(
					relationships.map((relationship) => ({
						userId: relationship.user ?? null,
						sourceEntityId: relationship.source,
						targetEntityId: relationship.target,
						relationshipSchemaSlug: relationship.slug,
						relationshipSchemaPluginId: mediaPluginId,
						properties: relationship.properties ?? {},
						id:
							relationship.id ??
							`${relationship.slug}:${relationship.source}:${relationship.target}`,
					})),
				),
		);
	});

/**
 * A show or podcast with its episodes, numbered in order within each season (season 1 unless
 * given); an episode without `days` has no publish date, and one with `airingAt` a known airtime.
 */
export const insertEpisodicTitle = (
	parent: string,
	kind: "show" | "podcast",
	items: ReadonlyArray<{
		readonly id: string;
		readonly days?: number;
		readonly season?: number;
		readonly airingAt?: Date;
	}>,
) =>
	Effect.gen(function* () {
		const seasons = [...new Set(items.map(({ season }) => season ?? 1))];
		yield* insertEntities([
			{ id: parent, slug: kind },
			...(kind === "show"
				? seasons.map((season) => ({
						slug: "show-season",
						id: `${parent}-s${season}`,
						properties: { seasonNumber: season },
					}))
				: []),
			...items.map(({ id, days, season, airingAt }, index) => ({
				id,
				slug: `${kind}-episode`,
				...(days === undefined ? {} : { publishDate: utcDay(days) }),
				properties: {
					...(airingAt === undefined ? {} : { airingAt: airingAt.toISOString() }),
					episodeNumber:
						items.slice(0, index).filter((item) => (item.season ?? 1) === (season ?? 1)).length + 1,
				},
			})),
		]);
		yield* insertRelationships(
			kind === "show"
				? [
						...seasons.map((season) => ({
							source: parent,
							slug: "show-to-show-season",
							target: `${parent}-s${season}`,
						})),
						...items.map(({ id, season }) => ({
							target: id,
							slug: "show-season-to-show-episode",
							source: `${parent}-s${season ?? 1}`,
						})),
					]
				: items.map(({ id }) => ({
						target: id,
						source: parent,
						slug: "podcast-to-podcast-episode",
					})),
		);
	});

/** Links titles to the user's Media library through `slug`. */
export const linkToLibrary = (user: MediaUser, slug: string, entityIds: readonly string[]) =>
	insertRelationships(
		entityIds.map((entityId) => ({
			slug,
			user,
			source: entityId,
			target: libraryId(user),
			id: linkId(user, entityId, slug),
		})),
	);

export type MediaEvent = {
	readonly id: string;
	readonly slug: string;
	readonly entityId: string;
	readonly occurredAt: Date;
	readonly user?: MediaUser;
	readonly sessionEntityId?: string;
	readonly properties?: Record<string, unknown>;
};

export const insertEvents = (events: readonly MediaEvent[]) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.event)
				.values(
					events.map((event) => ({
						id: event.id,
						entityId: event.entityId,
						createdAt: event.occurredAt,
						eventSchemaSlug: event.slug,
						occurredAt: event.occurredAt,
						userId: event.user ?? "owner",
						eventSchemaPluginId: mediaPluginId,
						properties: event.properties ?? {},
						sessionEntityId: event.sessionEntityId ?? null,
					})),
				),
		);
	});

export const executeRecipe = <Success, Parameters extends AuthoredAppSchema>(
	user: MediaUser,
	recipe: Recipe<Success, Parameters>,
	argumentsValue: Recipe.Arguments<Recipe<Success, Parameters>>,
) =>
	Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser(user, null, "plugin", {
			arguments: argumentsValue,
			source: { kind: "inline", document: stampRyotQLDocument("media", recipe.document) },
		});
		return Result.getOrThrow(recipe.decode(response));
	});

const derivedValueKey = [
	tables.derivedValue.userId,
	tables.derivedValue.kind,
	tables.derivedValue.targetId,
];

/** Stores `value` as the user's `in-media-library` summary for `entityId`, folded and ready. */
export const storeLibrarySummary = (
	user: MediaUser,
	entityId: string,
	value: { readonly [key: string]: JsonValue },
) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const row = {
			userId: user,
			pluginId: mediaPluginId,
			subjectEntityId: entityId,
			pluginRevisionId: "media-revision",
		};
		yield* session.run((db) =>
			Effect.all([
				db
					.insert(tables.derivedValue)
					.values({ ...row, value: {}, kind: "subject", status: "ready", targetId: entityId })
					.onConflictDoUpdate({ target: derivedValueKey, set: { status: "ready" } }),
				db
					.insert(tables.derivedValue)
					.values({
						...row,
						value,
						kind: "relationship",
						targetId: linkId(user, entityId, "in-media-library"),
					})
					.onConflictDoUpdate({ set: { value }, target: derivedValueKey }),
			]),
		);
	});

/**
 * Marks the fold subject `entityId` as a background-lane write leaves it while its fold job is queued,
 * or as a failed job leaves it, keeping its stored summary.
 */
export const markLibrarySummary = (
	user: MediaUser,
	entityId: string,
	status: "failed" | "pending",
) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.execute(
				`update derived_value set status = '${status}' where user_id = '${user}' and kind = 'subject' and target_id = '${entityId}'`,
			),
		);
	});

/**
 * Stores the library summary the `fold.media-history` fold writes for the user's link to
 * `entityId`, computed from the current history and episodes.
 */
export const foldLibrarySummary = (user: MediaUser, entityId: string, slug: string) =>
	Effect.gen(function* () {
		const [summary] = yield* executeRecipe(
			user,
			librarySummarySourceRecipe({ kind: librarySummaryKind(slug) }),
			{ entityIds: [entityId] },
		);
		const value = summary ? librarySummaryProperties(summary) : { lifecycleState: "untracked" };
		yield* storeLibrarySummary(user, entityId, value);
		return value;
	});

/**
 * Moves the earliest upcoming date-only episode of `parentId` to `days` from today, or the earliest
 * timed one to `airingAt`, without folding, which is how time passing looks to a reader: the
 * summary's stored next airing date or instant, which the fold took from that episode, moves with it,
 * as does its next tracked airing when the user has progress on it.
 */
export const moveAiring = (
	input: ({ readonly days: number } | { readonly airingAt: Date }) & {
		readonly user: MediaUser;
		readonly parentId: string;
		readonly entityId: string;
		readonly tracked?: boolean;
	},
) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const timed = "airingAt" in input;
		const at = `'${(timed ? input.airingAt : utcDay(input.days)).toISOString()}'`;
		const stored = (input.tracked ? ["nextAiring", "nextTrackedAiring"] : ["nextAiring"])
			.map((name) => `'${name}${timed ? "At" : "Date"}', ${at}::text`)
			.join(", ");
		const target = linkId(input.user, input.parentId, "in-media-library");
		yield* session.run((db) =>
			Effect.all([
				db.execute(
					`update entity set properties = jsonb_set(properties, '{${timed ? "airingAt" : "publishDate"}}', to_jsonb(${at}::text)) where id = '${input.entityId}'`,
				),
				db.execute(
					`update derived_value set value = value || jsonb_build_object(${stored}) where user_id = '${input.user}' and kind = 'relationship' and target_id = '${target}'`,
				),
			]),
		);
	});
