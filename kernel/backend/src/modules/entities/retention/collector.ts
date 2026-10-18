import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";

import { EntityRetentionRepository } from "./repository";

const distinctUnits = (units: ReadonlyMap<string, ReadonlyArray<string>>) => [
	...new Map(
		[...units.values()].map((members) => [sortBy(members, (id) => id).join("\0"), members]),
	).values(),
];

export class EntityGraphCollector extends Context.Service<EntityGraphCollector>()(
	"EntityGraphCollector",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntityRetentionRepository;

			const runBatch = Effect.fn("EntityGraphCollector.runBatch")(function* (limit: number) {
				return yield* session.transaction(
					Effect.gen(function* () {
						if (yield* repository.hasActiveBackup()) {
							return { deferred: 0, collected: 0 };
						}
						const seeds = yield* repository.listDue(limit);
						if (seeds.length === 0) {
							return { deferred: 0, collected: 0 };
						}
						const catalog = yield* repository.loadCatalog();
						const candidates = distinctUnits(yield* repository.compositionUnits(catalog, seeds));
						const locked = yield* repository.lockMembers(candidates.flat());
						const units = candidates.filter((members) => members.every((id) => locked.has(id)));
						const live = yield* repository.liveIds(catalog, units.flat());
						const unreferenced = units.filter((members) => !members.some((id) => live.has(id)));

						const deadMembers = new Set(unreferenced.flat());
						const edges = yield* repository.referenceNeighbors(catalog, [...deadMembers]);
						const neighbors = [...new Set(edges.map(({ neighborId }) => neighborId))].filter(
							(id) => !deadMembers.has(id),
						);
						const liveNeighbors = yield* repository.liveIds(catalog, neighbors);
						const pending = neighbors.filter((id) => !liveNeighbors.has(id));
						const neighborUnits = yield* repository.compositionUnits(catalog, pending);
						const liveNeighborMembers = yield* repository.liveIds(
							catalog,
							[...new Set([...neighborUnits.values()].flat())].filter((id) => !deadMembers.has(id)),
						);
						for (const [neighbor, members] of neighborUnits) {
							if (members.some((id) => liveNeighborMembers.has(id))) {
								liveNeighbors.add(neighbor);
							}
						}

						const referencedMembers = new Set(
							edges.flatMap(({ memberId, neighborId }) =>
								liveNeighbors.has(neighborId) ? [memberId] : [],
							),
						);
						const collected = unreferenced.filter(
							(members) => !members.some((id) => referencedMembers.has(id)),
						);
						const collectedIds = new Set(collected.flat());
						const retained = units.flat().filter((id) => !collectedIds.has(id));
						yield* repository.retain(retained);
						const count = yield* repository.collect({
							ids: [...collectedIds],
							survivingNeighbors: [
								...new Set(
									edges.flatMap(({ memberId, neighborId }) =>
										collectedIds.has(memberId) && !collectedIds.has(neighborId) ? [neighborId] : [],
									),
								),
							],
						});
						return { collected: count, deferred: retained.length };
					}),
				);
			});

			return { runBatch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
