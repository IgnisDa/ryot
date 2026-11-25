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
	mediaDatabaseLayer,
	type MediaEvent,
	mediaReference,
	type MediaUser,
	moveAiring,
	utcDay,
} from "../tests/media-database";
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

/** The state and counts computed live from history and episodes, as presentations did. */
const liveRecipe = (config: EpisodicKindConfig, ids: readonly string[]) => {
	const entity = table("entity", "entity");
	const counts = episodicEpisodeCounts(config, entity, "live");
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
					watchedEpisodes: selectedField(counts.watchedEpisodes, Schema.Finite),
					upcomingEpisodes: selectedField(counts.upcomingEpisodes, Schema.Finite),
					inProgressEpisodes: selectedField(counts.inProgressEpisodes, Schema.Finite),
					state: selectedField(
						episodicLifecycleExpressions(config, entity, "live").state,
						EpisodicLifecycleStateSchema,
					),
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

/** Asserts the presentation equals the live computation and returns it. */
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

layer(mediaDatabaseLayer("media_library_summary"))((test) => {
	test.effect(
		"presents stored show counts and next episodes equal to live ones through history, new episodes and airings",
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
		"presents stored podcast counts and next episodes equal to live ones as an episode airs",
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

	test.effect("presents live progress once an episode the user watched before it aired airs", () =>
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
			yield* moveAiring({
				days: -1,
				tracked: true,
				user: "owner",
				parentId: "early",
				entityId: "early-e2",
			});
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
		"presents titles outside the user's library as untracked with live airing counts",
		() =>
			Effect.gen(function* () {
				yield* insertEpisodicTitle("elsewhere", "show", [
					{ days: -5, id: "elsewhere-e1" },
					{ days: 5, id: "elsewhere-e2" },
				]);
				yield* linkToLibrary("other", "in-media-library", ["elsewhere"]);
				yield* insertEvents([
					...watch("complete", "elsewhere", ["elsewhere-e1"], -4, "other"),
					...watch("complete", "elsewhere", ["elsewhere-e1"], -4),
				]);
				yield* foldLibrarySummary("other", "elsewhere", "show");
				expect(yield* presented("owner", "show", ["elsewhere"])).toEqual([
					{
						id: "elsewhere",
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
