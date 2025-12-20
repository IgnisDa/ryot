import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/db/service";

import { EpisodeResolverRepository } from "./repository";

export class EpisodeResolverService extends Effect.Service<EpisodeResolverService>()(
	"EpisodeResolverService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* EpisodeResolverRepository;

			const resolvePodcastEpisode = Effect.fn("EpisodeResolverService.resolvePodcastEpisode")(
				function* (input: { userId: UserId; episodeNumber: number; podcastEntityId: EntityId }) {
					const candidates = yield* runWithDb(repository.findPodcastEpisodeCandidates(input));

					return candidates.length === 1 ? (candidates[0] ?? null) : null;
				},
			);

			const resolveShowEpisode = Effect.fn("EpisodeResolverService.resolveShowEpisode")(
				function* (input: {
					userId: UserId;
					seasonNumber: number;
					episodeNumber: number;
					showEntityId: EntityId;
				}) {
					const candidates = yield* runWithDb(repository.findShowEpisodeCandidates(input));

					return candidates.length === 1 ? (candidates[0] ?? null) : null;
				},
			);

			return { resolveShowEpisode, resolvePodcastEpisode };
		}),
	},
) {}
