import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { EntityId, UserId } from "#lib/schema/brands";
import { dbRunnerLayer, makeMock } from "#lib/test-support/effect";

import { EpisodeResolverRepository } from "./repository";
import { EpisodeResolverService } from "./service";

const userId = UserId.make("user-1");
const showEntityId = EntityId.make("show-1");
const podcastEntityId = EntityId.make("podcast-1");

const makeRepository = (ids: readonly EntityId[], podcastIds: readonly EntityId[] = []) =>
	makeMock<EpisodeResolverRepository>({
		_tag: "EpisodeResolverRepository" as const,
		findShowEpisodeCandidates: () => Effect.succeed(ids),
		findPodcastEpisodeCandidates: () => Effect.succeed(podcastIds),
	});

const makeLayer = (repository: EpisodeResolverRepository) =>
	EpisodeResolverService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, Layer.succeed(EpisodeResolverRepository, repository)),
		),
	);

it.effect("resolves a show episode when exactly one candidate matches", () => {
	const layer = makeLayer(makeRepository([EntityId.make("episode-1")]));

	return Effect.gen(function* () {
		const service = yield* EpisodeResolverService;
		const resolved = yield* service.resolveShowEpisode({
			userId,
			showEntityId,
			seasonNumber: 1,
			episodeNumber: 2,
		});

		expect(resolved).toBe("episode-1");
	}).pipe(Effect.provide(layer));
});

it.effect("returns null when no show episode matches", () => {
	const layer = makeLayer(makeRepository([]));

	return Effect.gen(function* () {
		const service = yield* EpisodeResolverService;
		const resolved = yield* service.resolveShowEpisode({
			userId,
			showEntityId,
			seasonNumber: 1,
			episodeNumber: 99,
		});

		expect(resolved).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("returns null when show episode resolution is ambiguous", () => {
	const layer = makeLayer(makeRepository([EntityId.make("episode-1"), EntityId.make("episode-2")]));

	return Effect.gen(function* () {
		const service = yield* EpisodeResolverService;
		const resolved = yield* service.resolveShowEpisode({
			userId,
			showEntityId,
			seasonNumber: 1,
			episodeNumber: 2,
		});

		expect(resolved).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("resolves a podcast episode when exactly one candidate matches", () => {
	const layer = makeLayer(makeRepository([], [EntityId.make("podcast-episode-1")]));

	return Effect.gen(function* () {
		const service = yield* EpisodeResolverService;
		const resolved = yield* service.resolvePodcastEpisode({
			userId,
			podcastEntityId,
			episodeNumber: 4,
		});

		expect(resolved).toBe("podcast-episode-1");
	}).pipe(Effect.provide(layer));
});

it.effect("returns null when no podcast episode matches", () => {
	const layer = makeLayer(makeRepository([], []));

	return Effect.gen(function* () {
		const service = yield* EpisodeResolverService;
		const resolved = yield* service.resolvePodcastEpisode({
			userId,
			podcastEntityId,
			episodeNumber: 99,
		});

		expect(resolved).toBeNull();
	}).pipe(Effect.provide(layer));
});

it.effect("returns null when podcast episode resolution is ambiguous", () => {
	const layer = makeLayer(
		makeRepository([], [EntityId.make("podcast-episode-1"), EntityId.make("podcast-episode-2")]),
	);

	return Effect.gen(function* () {
		const service = yield* EpisodeResolverService;
		const resolved = yield* service.resolvePodcastEpisode({
			userId,
			podcastEntityId,
			episodeNumber: 4,
		});

		expect(resolved).toBeNull();
	}).pipe(Effect.provide(layer));
});
