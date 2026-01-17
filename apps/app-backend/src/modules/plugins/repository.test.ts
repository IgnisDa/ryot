import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";

import { PluginRepository } from "./repository";

const makeLayer = (input: {
	statuses?: Array<string>;
	entityRows?: ReadonlyArray<{ id: string }>;
}) => {
	const db = {
		select: () => ({
			from: () => ({
				where: () => ({ limit: () => Promise.resolve(input.entityRows ?? []) }),
			}),
		}),
		update: () => ({
			set: ({ status }: { status: string }) => ({
				where: () => {
					input.statuses?.push(status);
					return Promise.resolve();
				},
			}),
		}),
	};
	return PluginRepository.Default.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);
};

it.effect("detects entity references to plugin schema slugs", () =>
	Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(yield* repository.hasEntityReferences([])).toBe(false);
		expect(yield* repository.hasEntityReferences(["fixture-entity"])).toBe(true);
	}).pipe(Effect.provide(makeLayer({ entityRows: [{ id: "entity-id" }] }))),
);

it.effect("deactivates a plugin without deleting its script rows", () => {
	const statuses: Array<string> = [];
	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		yield* repository.deactivate("fixture");
		expect(statuses).toEqual(["inactive"]);
	}).pipe(Effect.provide(makeLayer({ statuses })));
});
