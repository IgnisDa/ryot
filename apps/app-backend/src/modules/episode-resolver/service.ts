import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { EpisodeResolverRepository } from "./repository";

const resolveUniqueCandidate = <E, R>(candidates: Effect.Effect<ReadonlyArray<EntityId>, E, R>) =>
	Effect.gen(function* () {
		const matches = yield* candidates;
		return matches.length === 1 ? (matches[0] ?? null) : null;
	});

export class EpisodeResolverService extends Effect.Service<EpisodeResolverService>()(
	"EpisodeResolverService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* EpisodeResolverRepository;

			const resolvePodcastEpisode = Effect.fn("EpisodeResolverService.resolvePodcastEpisode")(
				function* (input: { userId: UserId; episodeNumber: number; podcastEntityId: EntityId }) {
					return yield* resolveUniqueCandidate(
						runWithDb(repository.findPodcastEpisodeCandidates(input)),
					);
				},
			);

			const resolveShowEpisode = Effect.fn("EpisodeResolverService.resolveShowEpisode")(
				function* (input: {
					userId: UserId;
					seasonNumber: number;
					episodeNumber: number;
					showEntityId: EntityId;
				}) {
					return yield* resolveUniqueCandidate(
						runWithDb(repository.findShowEpisodeCandidates(input)),
					);
				},
			);

			return { resolveShowEpisode, resolvePodcastEpisode };
		}),
	},
) {}
