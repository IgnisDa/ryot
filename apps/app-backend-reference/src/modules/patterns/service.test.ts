import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { CurrentDb, TransactionRunner, type DbExecutor } from "../../lib/db";
import { type DbError, PatternsDuplicateItem, PatternsRejected } from "../../lib/errors";
import { PatternsRepository } from "./repository";
import { PatternsService, PatternsServiceLive } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@ryot-ref.dev",
} satisfies CurrentUserValue;

const transactionRejected = new PatternsRejected({
	runId: "run-id",
	message: "Patterns rollback requested",
});

const duplicateItem = (query: string) =>
	new PatternsDuplicateItem({
		query,
		message: "Audible item query already exists for this run",
	});

const makeTestLayer = () => {
	const committedWrites: string[] = [];
	const pendingWrites: string[] = [];
	const queries = new Set<string>();

	const write = (value: string) =>
		Effect.sync(() => {
			pendingWrites.push(value);
		});

	const createItem = (runId: string, query: string) =>
		Effect.gen(function* () {
			if (queries.has(query)) {
				return yield* duplicateItem(query);
			}
			queries.add(query);
			pendingWrites.push(`item:${runId}:${query}`);
			return { id: `item-${queries.size}`, query };
		});

	const layer = PatternsServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(
					TransactionRunner,
					<A, E, R>(
						effect: Effect.Effect<A, E, R>,
					): Effect.Effect<A, E | DbError, Exclude<R, CurrentDb>> => {
						pendingWrites.length = 0;
						queries.clear();
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dummy CurrentDb; mock repositories do not access it
						return Effect.provideService(effect, CurrentDb, null as unknown as DbExecutor).pipe(
							Effect.tap(() => Effect.sync(() => committedWrites.push(...pendingWrites))),
						);
					},
				),
				Layer.mock(PatternsRepository, {
					createItem,
					createRun: () => write("run:run-id").pipe(Effect.as({ id: "run-id" })),
					createStep: () => write("step:step-id").pipe(Effect.as({ id: "step-id" })),
				}),
			),
		),
	);

	return { layer, committedWrites };
};

it.effect("commits both writes when the patterns demo succeeds", () => {
	const { layer, committedWrites } = makeTestLayer();

	return Effect.gen(function* () {
		const service = yield* PatternsService;
		const result = yield* service.dbTransaction(user, { mode: "commit" });

		expect(result).toEqual({ runId: "run-id", stepId: "step-id" });
		expect(committedWrites).toEqual(["run:run-id", "step:step-id"]);
	}).pipe(Effect.provide(layer));
});

it.effect("commits the unique constraint demo when the item is unique", () => {
	const { layer, committedWrites } = makeTestLayer();

	return Effect.gen(function* () {
		const service = yield* PatternsService;
		const result = yield* service.uniqueConstraint(user, {
			query: "Dune",
			duplicate: false,
		});

		expect(result).toEqual({
			query: "Dune",
			runId: "run-id",
			itemId: "item-1",
		});
		expect(committedWrites).toEqual(["run:run-id", "item:run-id:Dune"]);
	}).pipe(Effect.provide(layer));
});

it.effect("rolls back the unique constraint demo while preserving the domain failure", () => {
	const { layer, committedWrites } = makeTestLayer();

	return Effect.gen(function* () {
		const service = yield* PatternsService;
		const error = yield* Effect.flip(
			service.uniqueConstraint(user, {
				query: "Dune",
				duplicate: true,
			}),
		);

		expect(error).toBeInstanceOf(PatternsDuplicateItem);
		expect(error).toMatchObject({
			query: "Dune",
			message: "Audible item query already exists for this run",
		});
		expect("constraint" in error).toBe(false);
		expect(committedWrites).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("rolls back both writes while preserving the typed failure", () => {
	const { layer, committedWrites } = makeTestLayer();

	return Effect.gen(function* () {
		const service = yield* PatternsService;
		const error = yield* Effect.flip(service.dbTransaction(user, { mode: "rollback" }));

		expect(error).toEqual(transactionRejected);
		expect(committedWrites).toEqual([]);
	}).pipe(Effect.provide(layer));
});
