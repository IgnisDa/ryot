import { afterEach, describe, expect, it } from "@effect/vitest";
import type { EntityWatch } from "@ryot-app/plugin-client-contract";
import { waitFor } from "@testing-library/dom";
import { Effect } from "effect";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ActiveScreenContext } from "../active-screen";
import type { EntityUpdate } from "../client/adapter";
import { RyotClientError } from "../client/errors";
import { createRyotQuery, type RyotQueryOptions } from "../queries/definitions";
import { type RyotQueryResult, useRyotQuery } from "../queries/hooks";
import { RyotProvider } from "../queries/provider";
import { createTestRyotClock } from "../testing";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];
const clocks: ReturnType<typeof createTestRyotClock>[] = [];
const entityWatch: RyotQueryOptions<string, string>["entityWatch"] = ({ data, input }) => ({
	foreground: [input],
	visible: data ? [data] : [],
});
const mountQueries = (
	options: {
		readonly interested?: boolean;
		readonly initialData?: string;
		readonly cancelOnUnmount?: boolean;
	} = {},
) => {
	const watches: Array<{
		readonly interests: EntityWatch[];
		readonly hint: (update: EntityUpdate) => void;
		disposed: boolean;
	}> = [];
	const requests: Array<{
		readonly signal: AbortSignal;
		readonly resume: (result: Effect.Effect<string, RyotClientError>) => void;
	}> = [];
	const clock = createTestRyotClock({
		watchEntities: (interest, hint) => {
			const watch = { hint, disposed: false, interests: [interest] };
			watches.push(watch);
			return {
				update: (next) => watch.interests.push(next),
				dispose: () => {
					watch.disposed = true;
				},
			};
		},
	});
	clocks.push(clock);
	const initialData = options.initialData;
	const query = createRyotQuery<string, string>(
		() =>
			Effect.callback<string, RyotClientError>((resume, signal) => {
				requests.push({ resume, signal });
			}),
		{
			cancelOnUnmount: options.cancelOnUnmount ?? false,
			...(initialData === undefined ? {} : { initialData: () => initialData }),
			...(options.interested === false ? {} : { entityWatch }),
		},
	);
	const results = new Map<string, RyotQueryResult<string>>();
	const View = ({ id, refreshOnMutation }: { id: string; refreshOnMutation: boolean }) => {
		const result = useRyotQuery(query, "root", { refreshOnMutation });
		useEffect(() => {
			results.set(id, result);
		});
		return <p>{result.data ?? "pending"}</p>;
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const render = (
		consumers: readonly {
			readonly id: string;
			readonly active?: boolean;
			readonly refreshOnMutation?: boolean;
		}[],
	) => {
		act(() =>
			root.render(
				<RyotProvider runtime={clock.runtime}>
					{consumers.map(({ id, active = true, refreshOnMutation = true }) => (
						<ActiveScreenContext.Provider key={id} value={active}>
							<View id={id} refreshOnMutation={refreshOnMutation} />
						</ActiveScreenContext.Provider>
					))}
				</RyotProvider>,
			),
		);
	};
	const hintEntity = () =>
		act(() => watches.at(-1)?.hint({ entityId: "root", reason: "projection-updated" }));
	return { clock, render, watches, results, requests, hintEntity };
};

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	return Effect.runPromise(
		Effect.andThen(
			Effect.forEach(clocks.splice(0), (clock) => Effect.promise(() => clock.dispose()), {
				discard: true,
				concurrency: "unbounded",
			}),
			Effect.sync(() => {
				document.body.innerHTML = "";
			}),
		),
	);
});

describe("automatic query refresh", () => {
	it.live("coalesces entity and page demand during initial and follow-up requests", () =>
		Effect.gen(function* () {
			const { clock, render, watches, results, requests, hintEntity } = mountQueries();
			render([{ id: "view" }]);
			expect(requests).toHaveLength(1);
			expect(results.get("view")).toMatchObject({ isPending: true, isFetching: true });
			hintEntity();
			hintEntity();
			clock.client.mutationCompleted.hint();
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(500));
			expect(requests).toHaveLength(1);
			expect(requests[0]?.signal.aborted).toBe(false);

			act(() => requests[0]?.resume(Effect.succeed("first")));
			yield* Effect.promise(() => clock.advance(0));
			expect(requests).toHaveLength(2);
			expect(results.get("view")).toMatchObject({
				data: "first",
				isPending: false,
				isFetching: true,
			});
			yield* Effect.promise(() => clock.advance(500));
			expect(requests).toHaveLength(2);

			hintEntity();
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(250));
			expect(requests).toHaveLength(2);
			expect(requests[1]?.signal.aborted).toBe(false);
			act(() => requests[1]?.resume(Effect.fail(new RyotClientError("transport"))));
			yield* Effect.promise(() => waitFor(() => expect(results.get("view")?.isError).toBe(true)));
			expect(results.get("view")?.data).toBe("first");
			expect(watches[0]?.interests.at(-1)).toEqual({ visible: ["first"], foreground: ["root"] });
			yield* Effect.promise(() => clock.advance(0));
			expect(requests).toHaveLength(3);
			act(() => requests[2]?.resume(Effect.succeed("current")));
			yield* Effect.promise(() => clock.advance(1000));
			expect(requests).toHaveLength(3);
			expect(results.get("view")).toMatchObject({ data: "current", isFetching: false });
			expect(watches).toHaveLength(1);
			expect(watches[0]?.interests.at(-1)).toEqual({ foreground: ["root"], visible: ["current"] });
		}),
	);

	it.live("lets manual refetch supersede work without consuming in-flight automatic demand", () =>
		Effect.gen(function* () {
			const { clock, render, results, requests, hintEntity } = mountQueries({
				initialData: "seed",
			});
			render([{ id: "view" }]);
			hintEntity();
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(250));
			expect(requests).toHaveLength(1);
			hintEntity();
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(250));
			act(() => results.get("view")?.refetch());
			expect(requests).toHaveLength(2);
			expect(requests[0]?.signal.aborted).toBe(true);
			act(() => requests[0]?.resume(Effect.succeed("stale")));
			yield* Effect.promise(() => clock.advance(1000));
			expect(requests).toHaveLength(2);
			expect(results.get("view")?.data).toBe("seed");
			expect(requests[1]?.signal.aborted).toBe(false);
			act(() => requests[1]?.resume(Effect.succeed("manual")));
			yield* Effect.promise(() => clock.advance(0));
			expect(requests).toHaveLength(3);
			expect(results.get("view")?.data).toBe("manual");
			act(() => requests[2]?.resume(Effect.succeed("automatic")));
			yield* Effect.promise(() => clock.advance(1000));
			expect(requests).toHaveLength(3);
			expect(results.get("view")?.data).toBe("automatic");
		}),
	);

	it.live(
		"shares one watch across mixed page-refresh opt-ins and keeps entity demand independent",
		() =>
			Effect.gen(function* () {
				const { clock, render, watches, results, requests, hintEntity } = mountQueries({
					initialData: "seed",
				});
				render([{ id: "on" }, { id: "off", refreshOnMutation: false }]);
				expect(watches).toHaveLength(1);
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(250));
				expect(requests).toHaveLength(1);
				render([{ id: "off", refreshOnMutation: false }]);
				expect(watches[0]?.disposed).toBe(false);
				act(() => requests[0]?.resume(Effect.succeed("first")));
				yield* Effect.promise(() => clock.advance(500));
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(250));
				expect(requests).toHaveLength(1);
				expect(results.get("off")).toMatchObject({ data: "first", isFetching: false });
				expect(watches).toHaveLength(1);
				expect(watches[0]?.disposed).toBe(false);
				expect(watches[0]?.interests.at(-1)).toEqual({ visible: ["first"], foreground: ["root"] });
				hintEntity();
				yield* Effect.promise(() => clock.advance(249));
				expect(requests).toHaveLength(1);
				yield* Effect.promise(() => clock.advance(1));
				expect(requests).toHaveLength(2);
				act(() => requests[1]?.resume(Effect.succeed("entity")));
				yield* Effect.promise(() => clock.advance(0));
				render([{ id: "off", refreshOnMutation: true }]);
				expect(watches).toHaveLength(1);
				expect(watches[0]?.disposed).toBe(false);
				yield* Effect.promise(() => clock.advance(500));
				expect(requests).toHaveLength(2);
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(250));
				expect(requests).toHaveLength(3);
			}),
	);

	it.live(
		"withdraws hidden interests and coalesces activation catch-up behind a running request",
		() =>
			Effect.gen(function* () {
				const { clock, render, watches, requests, hintEntity } = mountQueries({
					initialData: "seed",
				});
				render([{ id: "first" }, { id: "second", active: false }]);
				expect(watches).toHaveLength(1);
				hintEntity();
				yield* Effect.promise(() => clock.advance(250));
				expect(requests).toHaveLength(1);
				render([
					{ id: "first", active: false },
					{ id: "second", active: false },
				]);
				expect(watches[0]?.disposed).toBe(true);
				expect(requests[0]?.signal.aborted).toBe(false);
				hintEntity();
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(500));
				render([{ id: "first", active: false }, { id: "second" }]);
				expect(watches).toHaveLength(2);
				yield* Effect.promise(() => clock.advance(500));
				expect(requests).toHaveLength(1);
				act(() => requests[0]?.resume(Effect.succeed("first")));
				yield* Effect.promise(() => clock.advance(249));
				expect(requests).toHaveLength(1);
				yield* Effect.promise(() => clock.advance(1));
				expect(requests).toHaveLength(2);
				act(() => requests[1]?.resume(Effect.succeed("caught-up")));
				yield* Effect.promise(() => clock.advance(1000));
				expect(requests).toHaveLength(2);
			}),
	);

	it.live("consumes page generations once across shared hidden consumers and remounts", () =>
		Effect.gen(function* () {
			const { clock, render, requests } = mountQueries({ interested: false, initialData: "seed" });
			render([{ id: "first" }, { id: "second", active: false }]);
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(250));
			expect(requests).toHaveLength(1);
			act(() => requests[0]?.resume(Effect.succeed("first")));
			yield* Effect.promise(() => clock.advance(0));
			render([
				{ id: "first", active: false },
				{ id: "second", active: false },
			]);
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(500));
			expect(requests).toHaveLength(1);
			render([{ id: "first" }, { id: "second" }]);
			yield* Effect.promise(() => clock.advance(249));
			expect(requests).toHaveLength(1);
			yield* Effect.promise(() => clock.advance(1));
			expect(requests).toHaveLength(2);
			act(() => requests[1]?.resume(Effect.succeed("caught-up")));
			yield* Effect.promise(() => clock.advance(1000));
			expect(requests).toHaveLength(2);
			render([]);
			render([{ id: "new" }]);
			yield* Effect.promise(() => clock.advance(500));
			expect(requests).toHaveLength(2);
			render([]);
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(250));
			render([{ id: "last" }]);
			yield* Effect.promise(() => clock.advance(250));
			expect(requests).toHaveLength(3);
		}),
	);

	it.live(
		"catches up a cached interested query once on remount and cancels its final queued hint",
		() =>
			Effect.gen(function* () {
				const { clock, render, watches, requests, hintEntity } = mountQueries({
					initialData: "seed",
				});
				render([{ id: "first" }]);
				render([]);
				expect(watches[0]?.disposed).toBe(true);
				render([{ id: "second" }]);
				expect(watches).toHaveLength(2);
				yield* Effect.promise(() => clock.advance(249));
				expect(requests).toHaveLength(0);
				yield* Effect.promise(() => clock.advance(1));
				expect(requests).toHaveLength(1);
				act(() => requests[0]?.resume(Effect.succeed("fresh")));
				yield* Effect.promise(() => clock.advance(1000));
				expect(requests).toHaveLength(1);
				hintEntity();
				clock.client.mutationCompleted.hint();
				render([]);
				expect(watches[1]?.disposed).toBe(true);
				yield* Effect.promise(() => clock.advance(1000));
				expect(requests).toHaveLength(1);
			}),
	);

	it.live(
		"interrupts cancel-on-unmount work only after final release and drops queued demand",
		() =>
			Effect.gen(function* () {
				const { clock, render, watches, requests, hintEntity } = mountQueries({
					initialData: "seed",
					cancelOnUnmount: true,
				});
				render([{ id: "first" }, { id: "second" }]);
				hintEntity();
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(250));
				expect(requests).toHaveLength(1);
				hintEntity();
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(250));
				render([{ id: "second" }]);
				expect(watches[0]?.disposed).toBe(false);
				expect(requests[0]?.signal.aborted).toBe(false);
				render([]);
				yield* Effect.promise(() => waitFor(() => expect(requests[0]?.signal.aborted).toBe(true)));
				expect(watches[0]?.disposed).toBe(true);
				act(() => requests[0]?.resume(Effect.succeed("late")));
				hintEntity();
				clock.client.mutationCompleted.hint();
				yield* Effect.promise(() => clock.advance(1000));
				expect(requests).toHaveLength(1);
			}),
	);
});
