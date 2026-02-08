import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type { UpdateTrackerStateBody } from "@ryot/contract/modules/trackers/schemas";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";

import { TrackersRepository, type TrackerStateRow } from "./repository";

const merge = (
	definition: NonNullable<ReturnType<DefinitionRegistry["getTracker"]>>,
	state?: TrackerStateRow | null,
	defaultSortOrder = 0,
) => ({
	...definition,
	config: state?.config ?? {},
	isDisabled: state?.isDisabled ?? false,
	sortOrder: state?.sortOrder ?? defaultSortOrder,
});

export class TrackersService extends Effect.Service<TrackersService>()("TrackersService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* TrackersRepository;
		const definitions = yield* DefinitionRegistry;
		const list = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			includeDisabled: boolean,
		) {
			const states = yield* runWithDb(repository.listStates(user.id));
			const bySlug = new Map(states.map((state) => [state.trackerSlug, state]));
			return Object.values(definitions.getSnapshot().trackers)
				.map((definition, index) => merge(definition, bySlug.get(definition.slug), index))
				.filter((tracker) => includeDisabled || !tracker.isDisabled)
				.sort((left, right) => left.sortOrder - right.sortOrder);
		});
		const updateState = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			trackerSlug: string,
			payload: UpdateTrackerStateBody,
		) {
			const definition = definitions.getTracker(trackerSlug);
			if (!definition) {
				return yield* notFound("Tracker not found");
			}
			const current = yield* runWithDb(repository.getState(user.id, trackerSlug));
			const defaultSortOrder = Object.keys(definitions.getSnapshot().trackers).indexOf(trackerSlug);
			const state = yield* runWithDb(
				repository.upsertState({
					userId: user.id,
					trackerSlug,
					config: payload.config ?? current?.config ?? {},
					sortOrder: payload.sortOrder ?? current?.sortOrder ?? defaultSortOrder,
					isDisabled: payload.isDisabled ?? current?.isDisabled ?? false,
				}),
			);
			return merge(definition, state, defaultSortOrder);
		});
		return { list, updateState };
	}),
}) {}
