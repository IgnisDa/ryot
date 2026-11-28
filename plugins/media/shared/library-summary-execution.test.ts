import { expect } from "bun:test";

import {
	ascending,
	column,
	defineRecipe,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import {
	executeRecipe,
	foldLibrarySummary,
	insertEntities,
	insertEpisodicTitle,
	insertEvents,
	insertRelationships,
	linkToLibrary,
	markLibrarySummary,
	mediaDatabaseLayer,
	type MediaEvent,
	mediaReference,
	type MediaUser,
	moveAiring,
	utcDay,
} from "../tests/media-database";
import {
	librarySummaryKind,
	librarySummaryRefresh,
	librarySummarySourceRecipe,
} from "./library-summary";
import {
	episodicEpisodeCounts,
	type EpisodicKindConfig,
	episodicLifecycleExpressions,
	EpisodicLifecycleStateSchema,
	episodicNextUpInclude,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { episodicByLifecycleStateRecipe } from "./lifecycle-list-recipes";
import { podcastRecipes } from "./podcast-recipes";
import { showRecipes } from "./show-recipes";

const kinds = { show: showEpisodicKindConfig, podcast: podcastEpisodicKindConfig };
type Kind = keyof typeof kinds;

/** The state and counts computed live from history and episodes, as the fold computes them. */
const liveRecipe = (config: EpisodicKindConfig, ids: readonly string[]) => {
	const entity = table("entity", "entity");
	const lifecycle = episodicLifecycleExpressions(config, entity, "live");
	const counts = episodicEpisodeCounts(config, entity, "live", lifecycle.aired);
	return defineRecipe({
		queries: {
			items: selectedRows(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(
					column(entity, "id"),
					ids.map((id) => literal(id)),
				),
				selection: {
					id: selectedField(column(entity, "id"), Schema.String),
					airedEpisodes: selectedField(counts.airedEpisodes, Schema.Finite),
					state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					watchedEpisodes: selectedField(counts.watchedEpisodes, Schema.Finite),
					upcomingEpisodes: selectedField(counts.upcomingEpisodes, Schema.Finite),
					inProgressEpisodes: selectedField(counts.inProgressEpisodes, Schema.Finite),
				},
			}),
		},
	});
};

const presentationRecipe = (kind: Kind, ids: readonly string[]) => {
	const entity = table("entity", "entity");
	const source = { show: showRecipes, podcast: podcastRecipes }[kind].presentationSource;
	return defineRecipe({
		queries: {
			items: source.query({
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(
					column(entity, "id"),
					ids.map((id) => literal(id)),
				),
			}),
		},
	});
};

const presented = (user: MediaUser, kind: Kind, ids: readonly string[]) =>
	Effect.map(executeRecipe(user, presentationRecipe(kind, ids), {}), ({ items }) =>
		items.items.map(
			({ id, state, airedEpisodes, watchedEpisodes, upcomingEpisodes, inProgressEpisodes }) => ({
				state,
				airedEpisodes,
				id: String(id),
				watchedEpisodes,
				upcomingEpisodes,
				inProgressEpisodes,
			}),
		),
	);

const live = (user: MediaUser, kind: Kind, ids: readonly string[]) =>
	Effect.map(executeRecipe(user, liveRecipe(kinds[kind], ids), {}), ({ items }) => items.items);

/** Asserts the presentation equals the live computation, as it does after a fold, and returns it. */
const expectLive = (user: MediaUser, kind: Kind, ids: readonly string[]) =>
	Effect.gen(function* () {
		const shown = yield* presented(user, kind, ids);
		expect(shown).toEqual([...(yield* live(user, kind, ids))]);
		return shown;
	});

const liveNextUpRecipe = (config: EpisodicKindConfig, id: string) => {
	const entity = table("entity", "entity");
	return defineRecipe({
		queries: {
			items: selectedRows(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), [literal(id)]),
				selection: { id: selectedField(column(entity, "id"), Schema.String) },
				include: {
					nextUp: episodicNextUpInclude(config, entity, (episode) => ({
						id: selectedField(column(episode, "id"), Schema.String),
					})),
				},
			}),
		},
	});
};

const states = [
	"untracked",
	"backlog",
	"in_progress",
	"on_hold",
	"dropped",
	"complete",
	"caught_up",
] as const;

/** The next episode the lifecycle list shows for one in-library title. */
const listedNextUp = (user: MediaUser, kind: Kind, entityId: string) =>
	Effect.map(
		executeRecipe(
			user,
			episodicByLifecycleStateRecipe({ config: kinds[kind], reference: mediaReference }),
			{ entityId, states: [...states] },
		),
		({ items }) => {
			expect(items).toHaveLength(1);
			const id = items[0]?.nextUp?.id;
			return id === undefined ? null : String(id);
		},
	);

/** Asserts the lifecycle list's next episode equals the live next-up and returns its ID. */
const expectNextUpLive = (user: MediaUser, kind: Kind, entityId: string) =>
	Effect.gen(function* () {
		const nextUp = yield* listedNextUp(user, kind, entityId);
		const { items } = yield* executeRecipe(user, liveNextUpRecipe(kinds[kind], entityId), {});
		expect(nextUp).toBe(items.items[0]?.nextUp.items[0]?.id ?? null);
		return nextUp;
	});

/** Lifecycle events on `parent`'s episodes, a minute apart from `day` days after today. */
const watch = (
	slug: "complete" | "progress",
	parent: string,
	episodes: readonly string[],
	day: number,
	user: MediaUser = "owner",
): MediaEvent[] =>
	episodes.map((entityId, index) => ({
		slug,
		user,
		entityId,
		sessionEntityId: parent,
		id: `${slug}:${user}:${entityId}`,
		occurredAt: utcDay(day + index / 1440),
	}));

const hours = (count: number) => new Date(Date.now() + count * 3_600_000);

layer(mediaDatabaseLayer("media_library_summary"), { excludeTestServices: true })((test) => {
	test.effect(
		"presents stored show counts and next episodes equal to live ones after each fold through history, new episodes and releases",
		() =>
			Effect.gen(function* () {
				yield* insertEpisodicTitle("series", "show", [
					{ days: -20, id: "series-e1" },
					{ days: -10, id: "series-e2" },
					{ id: "series-e3" },
					{ days: 3, season: 2, id: "series-e4" },
					{ days: 10, season: 2, id: "series-e5" },
					{ days: -15, season: 0, id: "series-special" },
				]);
				yield* linkToLibrary("owner", "in-media-library", ["series"]);
				const fold = foldLibrarySummary("owner", "series", "show");
				yield* fold;
				expect(yield* expectLive("owner", "show", ["series"])).toEqual([
					{
						id: "series",
						airedEpisodes: 3,
						state: "untracked",
						watchedEpisodes: 0,
						upcomingEpisodes: 2,
						inProgressEpisodes: 0,
					},
				]);
				expect(yield* expectNextUpLive("owner", "show", "series")).toBeNull();

				yield* insertEvents([
					...watch("complete", "series", ["series-e1", "series-e2"], -30),
					...watch("progress", "series", ["series-e3"], -29),
				]);
				yield* fold;
				expect(yield* expectLive("owner", "show", ["series"])).toEqual([
					{
						id: "series",
						airedEpisodes: 3,
						watchedEpisodes: 2,
						upcomingEpisodes: 2,
						state: "in_progress",
						inProgressEpisodes: 1,
					},
				]);
				expect(yield* expectNextUpLive("owner", "show", "series")).toBe("series-e3");

				yield* insertEvents(watch("complete", "series", ["series-e3"], -28));
				expect(yield* listedNextUp("owner", "show", "series")).toBe("series-e3");
				expect((yield* presented("owner", "show", ["series"]))[0]).toMatchObject({
					watchedEpisodes: 2,
					inProgressEpisodes: 1,
				});
				yield* fold;
				expect((yield* expectLive("owner", "show", ["series"]))[0]).toMatchObject({
					state: "caught_up",
					watchedEpisodes: 3,
					inProgressEpisodes: 0,
				});
				expect(yield* expectNextUpLive("owner", "show", "series")).toBeNull();

				yield* insertEntities([
					{
						id: "series-e6",
						slug: "show-episode",
						publishDate: utcDay(-1),
						properties: { episodeNumber: 4 },
					},
				]);
				yield* insertRelationships([
					{ source: "series-s1", target: "series-e6", slug: "show-season-to-show-episode" },
				]);
				yield* fold;
				expect((yield* expectLive("owner", "show", ["series"]))[0]).toMatchObject({
					airedEpisodes: 4,
					state: "in_progress",
				});
				expect(yield* expectNextUpLive("owner", "show", "series")).toBe("series-e6");
				yield* insertEvents(watch("complete", "series", ["series-e6"], -1));
				yield* fold;
				expect((yield* expectLive("owner", "show", ["series"]))[0]).toMatchObject({
					state: "caught_up",
				});

				yield* moveAiring({ days: -1, user: "owner", parentId: "series", entityId: "series-e4" });
				yield* fold;
				expect(yield* expectLive("owner", "show", ["series"])).toEqual([
					{
						id: "series",
						airedEpisodes: 5,
						watchedEpisodes: 4,
						upcomingEpisodes: 1,
						state: "in_progress",
						inProgressEpisodes: 0,
					},
				]);
				expect(yield* expectNextUpLive("owner", "show", "series")).toBe("series-e4");
			}),
	);

	test.effect(
		"presents stored podcast counts and next episodes equal to live ones once the fold an airing refreshes runs",
		() =>
			Effect.gen(function* () {
				yield* insertEpisodicTitle("cast", "podcast", [
					{ days: -30, id: "cast-e1" },
					{ days: -3, id: "cast-e2" },
					{ days: 4, id: "cast-e3" },
				]);
				yield* linkToLibrary("owner", "in-media-library", ["cast"]);
				yield* insertEvents([
					...watch("complete", "cast", ["cast-e1"], -20),
					...watch("progress", "cast", ["cast-e2"], -2),
				]);
				yield* foldLibrarySummary("owner", "cast", "podcast");
				expect(yield* expectLive("owner", "podcast", ["cast"])).toEqual([
					{
						id: "cast",
						airedEpisodes: 2,
						watchedEpisodes: 1,
						upcomingEpisodes: 1,
						state: "in_progress",
						inProgressEpisodes: 1,
					},
				]);
				yield* moveAiring({ days: 0, user: "owner", parentId: "cast", entityId: "cast-e3" });
				expect((yield* presented("owner", "podcast", ["cast"]))[0]).toMatchObject({
					airedEpisodes: 2,
					upcomingEpisodes: 1,
				});
				yield* foldLibrarySummary("owner", "cast", "podcast");
				expect(yield* expectNextUpLive("owner", "podcast", "cast")).toBe("cast-e2");
				expect((yield* expectLive("owner", "podcast", ["cast"]))[0]).toMatchObject({
					airedEpisodes: 3,
					upcomingEpisodes: 0,
				});
				expect(yield* expectNextUpLive("owner", "podcast", "cast")).toBe("cast-e2");
				yield* insertEvents(watch("complete", "cast", ["cast-e2"], -1));
				yield* foldLibrarySummary("owner", "cast", "podcast");
				expect(yield* expectNextUpLive("owner", "podcast", "cast")).toBe("cast-e3");
			}),
	);

	test.effect(
		"counts an episode the user watched before it aired once the fold its release refreshes runs",
		() =>
			Effect.gen(function* () {
				yield* insertEpisodicTitle("early", "show", [
					{ days: -5, id: "early-e1" },
					{ days: 3, id: "early-e2" },
					{ days: 9, id: "early-e3" },
				]);
				yield* linkToLibrary("owner", "in-media-library", ["early"]);
				yield* insertEvents(watch("complete", "early", ["early-e1", "early-e2"], -4));
				yield* foldLibrarySummary("owner", "early", "show");
				expect(yield* expectLive("owner", "show", ["early"])).toEqual([
					{
						id: "early",
						airedEpisodes: 1,
						state: "caught_up",
						watchedEpisodes: 1,
						upcomingEpisodes: 2,
						inProgressEpisodes: 0,
					},
				]);
				yield* moveAiring({ days: -1, user: "owner", parentId: "early", entityId: "early-e2" });
				expect((yield* presented("owner", "show", ["early"]))[0]).toMatchObject({
					airedEpisodes: 1,
					watchedEpisodes: 1,
				});
				yield* foldLibrarySummary("owner", "early", "show");
				expect(yield* expectLive("owner", "show", ["early"])).toEqual([
					{
						id: "early",
						airedEpisodes: 2,
						state: "caught_up",
						watchedEpisodes: 2,
						upcomingEpisodes: 1,
						inProgressEpisodes: 0,
					},
				]);
			}),
	);

	test.effect(
		"stores the earliest timed release as the next one and keeps a caught-up summary until the fold that release refreshes shows the new episode",
		() =>
			Effect.gen(function* () {
				const airingAt = hours(2);
				const laterAt = hours(3);
				yield* insertEpisodicTitle("tonight", "show", [
					{ days: -5, id: "tonight-e1" },
					{ days: 0, airingAt, id: "tonight-e2" },
					{ days: 0, id: "tonight-e3", airingAt: laterAt },
					{ days: 7, id: "tonight-e4" },
				]);
				yield* linkToLibrary("owner", "in-media-library", ["tonight"]);
				yield* insertEvents(watch("complete", "tonight", ["tonight-e1", "tonight-e3"], -4));
				expect(yield* foldLibrarySummary("owner", "tonight", "show")).toMatchObject({
					airedEpisodes: 1,
					upcomingEpisodes: 3,
					lifecycleState: "caught_up",
					nextRelease: { instant: airingAt.toISOString() },
				});
				const caughtUp = {
					id: "tonight",
					airedEpisodes: 1,
					watchedEpisodes: 1,
					upcomingEpisodes: 3,
					inProgressEpisodes: 0,
					state: "caught_up" as const,
				};
				expect(yield* expectLive("owner", "show", ["tonight"])).toEqual([caughtUp]);
				expect(yield* expectNextUpLive("owner", "show", "tonight")).toBeNull();

				yield* moveAiring({
					user: "owner",
					parentId: "tonight",
					airingAt: hours(-1),
					entityId: "tonight-e2",
				});
				expect(yield* presented("owner", "show", ["tonight"])).toEqual([caughtUp]);
				expect(yield* listedNextUp("owner", "show", "tonight")).toBeNull();
				expect(yield* foldLibrarySummary("owner", "tonight", "show")).toMatchObject({
					lifecycleState: "in_progress",
					nextRelease: { instant: laterAt.toISOString() },
				});
			}),
	);

	test.effect(
		"refolds a title when its next release arrives: at a timed release's instant, else from a dated one's day",
		() =>
			Effect.gen(function* () {
				const airingAt = utcDay(2 + 20 / 24);
				yield* insertEpisodicTitle("dated", "show", [
					{ days: -5, id: "dated-e1" },
					{ days: 4, id: "dated-e2" },
					{ days: 6, id: "dated-e3", airingAt: utcDay(6) },
				]);
				yield* insertEpisodicTitle("timed", "show", [
					{ days: 2, airingAt, id: "timed-e1" },
					{ days: 3, id: "timed-e2" },
				]);
				yield* insertEpisodicTitle("finished", "show", [{ days: -5, id: "finished-e1" }]);
				const rows = yield* executeRecipe(
					"owner",
					librarySummarySourceRecipe({ kind: librarySummaryKind("show") }),
					{ entityIds: ["dated", "timed", "finished"] },
				);
				expect(rows.map((row) => [row.id, librarySummaryRefresh(row)])).toEqual([
					["dated", { date: utcDay(4).toISOString().slice(0, 10) }],
					["finished", undefined],
					["timed", { instant: airingAt.toISOString() }],
				]);
			}),
	);

	test.effect(
		"presents the stored summary while it is pending or failed, and the live one until a title first folds",
		() =>
			Effect.gen(function* () {
				yield* insertEpisodicTitle("queued", "show", [
					{ days: -9, id: "queued-e1" },
					{ days: -6, id: "queued-e2" },
					{ days: -3, id: "queued-e3" },
				]);
				yield* linkToLibrary("owner", "in-media-library", ["queued"]);
				yield* insertEvents(watch("complete", "queued", ["queued-e1"], -8));
				expect(yield* expectLive("owner", "show", ["queued"])).toEqual([
					{
						id: "queued",
						airedEpisodes: 3,
						watchedEpisodes: 1,
						upcomingEpisodes: 0,
						state: "in_progress",
						inProgressEpisodes: 0,
					},
				]);
				expect(yield* expectNextUpLive("owner", "show", "queued")).toBe("queued-e2");
				yield* foldLibrarySummary("owner", "queued", "show");
				yield* insertEvents(watch("complete", "queued", ["queued-e2"], -5));
				for (const status of ["pending", "failed"] as const) {
					yield* markLibrarySummary("owner", "queued", status);
					expect((yield* presented("owner", "show", ["queued"]))[0]).toMatchObject({
						watchedEpisodes: 1,
					});
					expect(yield* listedNextUp("owner", "show", "queued")).toBe("queued-e2");
				}
			}),
	);

	test.effect(
		"presents titles outside the user's library live when the user has history on them, and untracked otherwise",
		() =>
			Effect.gen(function* () {
				for (const title of ["elsewhere", "sessionless", "unwatched"]) {
					yield* insertEpisodicTitle(title, "show", [
						{ days: -5, id: `${title}-e1` },
						{ days: 5, id: `${title}-e2` },
					]);
				}
				yield* linkToLibrary("other", "in-media-library", ["elsewhere", "unwatched"]);
				yield* insertEvents([
					...watch("complete", "elsewhere", ["elsewhere-e1"], -4, "other"),
					...watch("complete", "elsewhere", ["elsewhere-e1"], -4),
					...watch("complete", "unwatched", ["unwatched-e1"], -4, "other"),
					{
						slug: "complete",
						occurredAt: utcDay(-4),
						entityId: "sessionless-e1",
						id: "complete:owner:sessionless-e1",
					},
				]);
				yield* foldLibrarySummary("other", "elsewhere", "show");
				expect(
					yield* expectLive("owner", "show", ["elsewhere", "sessionless", "unwatched"]),
				).toEqual([
					{
						id: "elsewhere",
						airedEpisodes: 1,
						state: "caught_up",
						watchedEpisodes: 1,
						upcomingEpisodes: 1,
						inProgressEpisodes: 0,
					},
					{
						airedEpisodes: 1,
						id: "sessionless",
						state: "untracked",
						watchedEpisodes: 1,
						upcomingEpisodes: 1,
						inProgressEpisodes: 0,
					},
					{
						id: "unwatched",
						airedEpisodes: 1,
						state: "untracked",
						watchedEpisodes: 0,
						upcomingEpisodes: 1,
						inProgressEpisodes: 0,
					},
				]);
				expect(yield* expectLive("other", "show", ["elsewhere"])).toEqual([
					{
						id: "elsewhere",
						airedEpisodes: 1,
						state: "caught_up",
						watchedEpisodes: 1,
						upcomingEpisodes: 1,
						inProgressEpisodes: 0,
					},
				]);
			}),
	);
});
