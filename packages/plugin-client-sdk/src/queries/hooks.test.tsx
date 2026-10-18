import { afterEach, describe, expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { Effect, Schema } from "effect";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { RyotClientAdapter } from "../client/adapter";
import { RyotClientError } from "../client/errors";
import { createTestPluginStorage, createTestRyotClock } from "../testing";
import { createRyotMutation, createRyotQuery } from "./definitions";
import {
	useRyotMutation,
	useRyotQuery,
	type RyotMutationResult,
	type RyotQueryResult,
} from "./hooks";
import { nextPageCursor, paginationItems } from "./pagination";
import { useRyotInfiniteQuery } from "./pagination-hook";
import { RyotProvider } from "./provider";
import { usePluginStorage } from "./storage";
import type { RyotSubmission } from "./submission";
import { useRyotSubmission } from "./submission-hook";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
type TestClock = ReturnType<typeof createTestRyotClock>;
const roots: Root[] = [];
const clocks: TestClock[] = [];
const makeClock = (adapter: Partial<RyotClientAdapter> = {}) => {
	const clock = createTestRyotClock(adapter);
	clocks.push(clock);
	return clock;
};
const render = (children: ReactNode, clock = makeClock(), hostServices?: unknown) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<RyotProvider runtime={clock.runtime} hostServices={hostServices}>
				{children}
			</RyotProvider>,
		),
	);
	return { root, clock, container };
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

describe("Effect-native React definitions", () => {
	it.live("refreshes pending results until the query becomes ready", () =>
		Effect.gen(function* () {
			const requests: Array<(pending: boolean) => void> = [];
			const query = createRyotQuery<undefined, { readonly pending: boolean }>(
				() =>
					Effect.callback((resume) => {
						requests.push((pending) => resume(Effect.succeed({ pending })));
					}),
				{ refreshWhile: ({ data }) => data.pending },
			);
			const View = () => {
				const result = useRyotQuery(query, undefined);
				return <p>{result.data?.pending === false ? "ready" : "pending"}</p>;
			};
			const clock = makeClock();
			const { container } = render(<View />, clock);
			act(() => requests[0]?.(true));
			yield* Effect.promise(() => clock.advance(999));
			expect(requests).toHaveLength(1);
			yield* Effect.promise(() => clock.advance(1));
			expect(requests).toHaveLength(2);
			act(() => requests[1]?.(false));
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("ready")));
			yield* Effect.promise(() => clock.advance(3000));
			expect(requests).toHaveLength(2);
		}),
	);

	it.live(
		"interrupts superseded pagination requests even when the base query normally stays cached",
		() =>
			Effect.gen(function* () {
				type Page = {
					readonly items: readonly string[];
					readonly pageInfo: { readonly nextCursor: string | null };
				};
				const requests: Array<{
					readonly selection: string;
					readonly signal: AbortSignal;
					readonly resume: (page: Page) => void;
				}> = [];
				const query = createRyotQuery<
					{ readonly selection: string; readonly after: string | null },
					Page
				>(({ input }) =>
					Effect.callback<Page>((resume, signal) => {
						requests.push({
							signal,
							selection: input.selection,
							resume: (page) => resume(Effect.succeed(page)),
						});
					}),
				);
				const View = ({ selection }: { readonly selection: string }) => {
					const result = useRyotInfiniteQuery(query, selection, {
						initialPageParam: null,
						getNextPageParam: nextPageCursor,
						getPageInput: (input, after: string | null) => ({ after, selection: input }),
					});
					return <p>{result.data?.items.join(",") ?? "pending"}</p>;
				};
				const { root, clock, container } = render(<View selection="old" />);
				expect(requests[0]?.selection).toBe("old");
				act(() => {
					root.render(
						<RyotProvider runtime={clock.runtime}>
							<View selection="new" />
						</RyotProvider>,
					);
				});
				yield* Effect.promise(() => waitFor(() => expect(requests[0]?.signal.aborted).toBe(true)));
				expect(requests[1]?.selection).toBe("new");
				act(() => requests[0]?.resume({ items: ["stale"], pageInfo: { nextCursor: null } }));
				expect(container.textContent).toBe("pending");
				act(() => requests[1]?.resume({ items: ["current"], pageInfo: { nextCursor: null } }));
				yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("current")));
			}),
	);
	it.live("keeps pagination idle through an atomic background refresh of all loaded pages", () =>
		Effect.gen(function* () {
			type Page = {
				readonly items: readonly string[];
				readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
			};
			const requests: Array<{
				readonly after: string | null;
				readonly resume: (page: Page) => void;
			}> = [];
			const query = createRyotQuery<string | null, Page>(
				({ input: after }) =>
					Effect.callback<Page>((resume) => {
						requests.push({ after, resume: (page) => resume(Effect.succeed(page)) });
					}),
				{ cancelOnUnmount: true },
			);
			const View = () => {
				const result = useRyotInfiniteQuery(query, undefined, {
					initialPageParam: null,
					getNextPageParam: nextPageCursor,
					getPageInput: (_, after: string | null) => after,
				});
				return (
					<>
						<p>
							{paginationItems(
								result.pages,
								(page) => page.items,
								(item) => item,
							).join(",")}
						</p>
						<button disabled={result.isFetching} onClick={result.fetchNextPage}>
							{result.isFetchingNextPage ? "Loading more" : "Load more"}
						</button>
						<output>{result.isRefreshing ? "refreshing" : "idle"}</output>
					</>
				);
			};
			const clock = makeClock();
			const { container } = render(<View />, clock);
			act(() =>
				requests[0]?.resume({ items: ["first"], pageInfo: { hasMore: true, nextCursor: "older" } }),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(container.querySelector("p")?.textContent).toBe("first")),
			);
			act(() => {
				fireEvent.click(getByRole(container, "button", { name: "Load more" }));
			});
			expect(getByRole(container, "button", { name: "Loading more" })).toBeTruthy();
			expect(requests[1]?.after).toBe("older");
			act(() =>
				requests[1]?.resume({ items: ["second"], pageInfo: { hasMore: true, nextCursor: "last" } }),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(container.querySelector("p")?.textContent).toBe("first,second")),
			);
			clock.client.mutationCompleted.hint();
			yield* Effect.promise(() => clock.advance(250));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(3)));
			expect(getByRole(container, "button", { name: "Load more" })).toBeTruthy();
			expect(container.querySelector("output")?.textContent).toBe("refreshing");
			act(() =>
				requests[2]?.resume({
					items: ["first updated"],
					pageInfo: { hasMore: true, nextCursor: "fresh" },
				}),
			);
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(4)));
			expect(requests[3]?.after).toBe("fresh");
			expect(container.querySelector("p")?.textContent).toBe("first,second");
			expect(getByRole(container, "button", { name: "Load more" })).toBeTruthy();
			act(() =>
				requests[3]?.resume({
					items: ["second updated"],
					pageInfo: { hasMore: false, nextCursor: null },
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(container.querySelector("p")?.textContent).toBe("first updated,second updated"),
				),
			);
			expect(container.querySelector("output")?.textContent).toBe("idle");
		}),
	);
	it.live(
		"retains a submission through transport and incomplete results before accepting a new one",
		() =>
			Effect.gen(function* () {
				const attempts: RyotSubmission<{ value: number }>[] = [];
				let identity = 0;
				const mutation = createRyotMutation<RyotSubmission<{ value: number }>, boolean>(
					({ input }) =>
						Effect.suspend(() => {
							attempts.push(input);
							return attempts.length === 1
								? Effect.fail(new RyotClientError("transport"))
								: Effect.succeed(attempts.length >= 3);
						}),
				);
				const View = () => {
					const submission = useRyotSubmission(mutation, {
						isComplete: (complete) => complete,
						createId: () => `submission-${++identity}`,
					});
					return (
						<>
							<p>{submission.status}</p>
							<button
								onClick={() => {
									submission.submit({ value: 0 });
									submission.submit({ value: 1 });
								}}
							>
								Submit
							</button>
							<button onClick={submission.retry}>Retry</button>
						</>
					);
				};
				const { container } = render(<View />);
				fireEvent.click(getByRole(container, "button", { name: "Submit" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(container.querySelector("p")?.textContent).toBe("retained")),
				);
				expect(attempts).toHaveLength(1);
				fireEvent.click(getByRole(container, "button", { name: "Retry" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						expect(attempts).toHaveLength(2);
						expect(container.querySelector("p")?.textContent).toBe("retained");
					}),
				);
				fireEvent.click(getByRole(container, "button", { name: "Retry" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(container.querySelector("p")?.textContent).toBe("idle")),
				);
				const submittedAt = attempts[0]?.submittedAt;
				expect(attempts).toEqual(
					Array.from({ length: 3 }, () => ({
						submittedAt,
						input: { value: 0 },
						submissionId: "submission-1",
					})),
				);
				fireEvent.click(getByRole(container, "button", { name: "Submit" }));
				yield* Effect.promise(() => waitFor(() => expect(attempts).toHaveLength(4)));
				expect(attempts[3]?.submissionId).toBe("submission-2");
			}),
	);

	it.live("shares a query atom and refetches it on demand", () =>
		Effect.gen(function* () {
			let calls = 0;
			let latest: RyotQueryResult<number> | undefined;
			const query = createRyotQuery(() => Effect.sync(() => ++calls));
			const View = () => {
				const result = useRyotQuery(query);
				useEffect(() => {
					latest = result;
				});
				return <p>{result.data ?? "pending"}</p>;
			};
			const { container } = render(
				<>
					<View />
					<View />
				</>,
			);
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("11")));
			expect(calls).toBe(1);
			act(() => latest?.refetch());
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("22")));
		}),
	);

	it.live(
		"supplies host services and keeps query cache identity stable across service changes",
		() =>
			Effect.gen(function* () {
				type HostServices = { readonly value: string };
				let calls = 0;
				let latest: RyotQueryResult<string> | undefined;
				const query = createRyotQuery<{ readonly page: number }, string, HostServices>(
					({ input, hostServices }) =>
						Effect.sync(() => {
							calls++;
							return `${hostServices.value}:${input.page}`;
						}),
				);
				const View = () => {
					const result = useRyotQuery(query, { page: 1 });
					useEffect(() => {
						latest = result;
					});
					return <p>{result.data ?? "pending"}</p>;
				};
				const clock = makeClock();
				const { root, container } = render(<View />, clock, { value: "first" });
				yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("first:1")));
				act(() =>
					root.render(
						<RyotProvider runtime={clock.runtime} hostServices={{ value: "second" }}>
							<View />
						</RyotProvider>,
					),
				);
				expect(calls).toBe(1);
				act(() => latest?.refetch());
				yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("second:1")));
			}),
	);

	it.live(
		"retains loaded data through pending and failed refreshes without leaking across inputs",
		() =>
			Effect.gen(function* () {
				const requests: Array<{
					readonly input: string;
					readonly resume: (result: Effect.Effect<string, RyotClientError>) => void;
				}> = [];
				let latest: RyotQueryResult<string> | undefined;
				const query = createRyotQuery<string, string>(({ input }) =>
					Effect.callback<string, RyotClientError>((resume) => {
						requests.push({ input, resume });
					}),
				);
				const View = ({ input }: { readonly input: string }) => {
					const result = useRyotQuery(query, input);
					useEffect(() => {
						latest = result;
					});
					return <p>{result.data ?? "loading"}</p>;
				};
				const { root, clock, container } = render(<View input="first" />);
				expect(container.textContent).toBe("loading");
				act(() => requests[0]?.resume(Effect.succeed("loaded")));
				yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("loaded")));
				act(() => latest?.refetch());
				expect(requests).toHaveLength(2);
				expect(container.textContent).toBe("loaded");
				expect(latest).toMatchObject({ isPending: false, isFetching: true, status: "success" });
				act(() => requests[1]?.resume(Effect.fail(new RyotClientError("transport"))));
				yield* Effect.promise(() => waitFor(() => expect(latest?.isError).toBe(true)));
				expect(container.textContent).toBe("loaded");
				expect(latest).toMatchObject({ isPending: false, isFetching: false });
				act(() => latest?.refetch());
				expect(container.textContent).toBe("loaded");
				act(() => requests[2]?.resume(Effect.succeed("updated")));
				yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("updated")));
				act(() =>
					root.render(
						<RyotProvider runtime={clock.runtime}>
							<View input="second" />
						</RyotProvider>,
					),
				);
				expect(requests.at(-1)?.input).toBe("second");
				expect(container.textContent).toBe("loading");
				expect(latest).toMatchObject({ isPending: true, data: undefined, isFetching: true });
			}),
	);

	it.live("reads the provider clock on each execution without changing query identity", () =>
		Effect.gen(function* () {
			const clock = makeClock();
			let latest: RyotQueryResult<number> | undefined;
			let calls = 0;
			const query = createRyotQuery(({ schedule }) =>
				Effect.sync(() => {
					calls++;
					return schedule.now();
				}),
			);
			const View = () => {
				const result = useRyotQuery(query);
				useEffect(() => {
					latest = result;
				});
				return <p>{result.data}</p>;
			};
			const { container } = render(<View />, clock);
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("0")));
			yield* Effect.promise(() => clock.advance(1_000));
			expect(container.textContent).toBe("0");
			expect(calls).toBe(1);
			act(() => latest?.refetch());
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("1000")));
			expect(calls).toBe(2);
		}),
	);

	it.live("interrupts superseded requests and ignores their late completion", () =>
		Effect.gen(function* () {
			const requests: Array<{
				readonly signal: AbortSignal;
				readonly resume: (value: string) => void;
			}> = [];
			let latest: RyotQueryResult<string> | undefined;
			const query = createRyotQuery(
				() =>
					Effect.callback<string>((resume, signal) => {
						requests.push({ signal, resume: (value) => resume(Effect.succeed(value)) });
					}),
				{ initialData: () => "hydrated" },
			);
			const View = () => {
				const result = useRyotQuery(query);
				useEffect(() => {
					latest = result;
				});
				return <p>{result.data}</p>;
			};
			const { container } = render(<View />);
			expect(container.textContent).toBe("hydrated");
			act(() => latest?.refetch());
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			act(() => latest?.refetch());
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
			expect(requests[0]?.signal.aborted).toBe(true);
			yield* Effect.promise(() =>
				act(() => {
					requests[1]?.resume("current");
					return Promise.resolve();
				}),
			);
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("current")));
			yield* Effect.promise(() =>
				act(() => {
					requests[0]?.resume("stale");
					return Promise.resolve();
				}),
			);
			expect(container.textContent).toBe("current");
		}),
	);

	it.live("keeps the initial hydration through a query refresh", () =>
		Effect.gen(function* () {
			let calls = 0;
			let latest: RyotQueryResult<number> | undefined;
			const query = createRyotQuery(() => Effect.sync(() => ++calls), { initialData: () => 0 });
			const View = () => {
				const result = useRyotQuery(query);
				useEffect(() => {
					latest = result;
				});
				return <p>{result.data}</p>;
			};
			const { container } = render(<View />);
			expect(container.textContent).toBe("0");
			expect(calls).toBe(0);
			act(() => latest?.refetch());
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("1")));
		}),
	);

	it.live("uses the TestClock-backed refresh schedule after capability mutation", () =>
		Effect.gen(function* () {
			let calls = 0;
			const clock = makeClock({ invokeOperation: () => Effect.succeed("saved") });
			const query = createRyotQuery(() => Effect.sync(() => ++calls));
			const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
			const { container } = render(<View />, clock);
			yield* Effect.promise(() => clock.advance(0));
			yield* clock.client.operations.invoke({
				input: {},
				slug: "save",
				output: Schema.String,
				packageId: "test/fixture",
				inputSchema: Schema.Struct({}),
			});
			yield* Effect.promise(() => clock.advance(249));
			expect(calls).toBe(1);
			yield* Effect.promise(() => clock.advance(1));
			expect(calls).toBe(2);
			expect(container.textContent).toBe("2");
		}),
	);

	it.live("runs a sequential mutation with typed failures and one capability completion hint", () =>
		Effect.gen(function* () {
			let hints = 0;
			let latest: RyotMutationResult<string, string> | undefined;
			const clock = makeClock({ invokeOperation: ({ input }) => Effect.succeed(input) });
			clock.client.mutationCompleted.subscribe(() => hints++);
			const mutation = createRyotMutation<string, string>(({ input, client }) =>
				Effect.gen(function* () {
					const first = yield* client.operations.invoke({
						input,
						slug: "first",
						output: Schema.String,
						packageId: "test/fixture",
						inputSchema: Schema.String,
					});
					return yield* client.operations.invoke({
						input: first,
						slug: "second",
						output: Schema.String,
						packageId: "test/fixture",
						inputSchema: Schema.String,
					});
				}),
			);
			const View = () => {
				const result = useRyotMutation(mutation);
				useEffect(() => {
					latest = result;
				});
				return <p>{result.status}</p>;
			};
			const { container } = render(<View />, clock);
			const context = yield* Effect.context();
			const effect =
				latest?.mutateEffect("saved") ?? Effect.die(new Error("Mutation hook did not mount"));
			const result = yield* Effect.promise(() => act(() => Effect.runPromiseWith(context)(effect)));
			expect(result).toBe("saved");
			expect(container.textContent).toBe("success");
			expect(hints).toBe(2);
		}),
	);

	it.live("surfaces a tagged mutation failure and reset", () =>
		Effect.gen(function* () {
			let latest: RyotMutationResult<string, string> | undefined;
			const mutation = createRyotMutation<string, string>(() =>
				Effect.fail(new RyotClientError("quota")),
			);
			const View = () => {
				const result = useRyotMutation(mutation);
				useEffect(() => {
					latest = result;
				});
				return (
					<p>{`${result.status}:${result.error instanceof RyotClientError ? result.error.reason : "none"}`}</p>
				);
			};
			const { container } = render(<View />);
			const context = yield* Effect.context();
			const effect =
				latest?.mutateEffect("failed") ?? Effect.die(new Error("Mutation hook did not mount"));
			const failure = yield* Effect.promise(() =>
				act(() =>
					Effect.runPromiseWith(context)(
						effect.pipe(Effect.match({ onFailure: (error) => error, onSuccess: (value) => value })),
					),
				),
			);
			expect(failure).toMatchObject({ reason: "quota" });
			expect(container.textContent).toBe("error:quota");
			act(() => latest?.reset());
			expect(container.textContent).toBe("idle:none");
		}),
	);

	it.live("reads and writes storage at the React boundary", () =>
		Effect.gen(function* () {
			const storage = createTestPluginStorage([['["fixture","order"]', { order: "dvd" }]]);
			const clock = makeClock({ accessStorage: storage.accessStorage });
			const schema = Schema.Struct({ order: Schema.Literals(["aired", "dvd"]) });
			const View = () => {
				const value = usePluginStorage({
					schema,
					key: "order",
					pluginId: PluginId.make("fixture"),
				});
				return value.status === "ready" ? (
					<button type="button" onClick={() => void value.set({ order: "aired" })}>
						{value.value?.order ?? "unset"}
					</button>
				) : (
					<p>loading</p>
				);
			};
			const { container } = render(<View />, clock);
			yield* Effect.promise(() => waitFor(() => expect(container.textContent).toBe("dvd")));
			yield* Effect.promise(() =>
				act(() => {
					fireEvent.click(getByRole(container, "button"));
					return Promise.resolve();
				}),
			);
			expect(storage.entries.get('["fixture","order"]')).toEqual({ order: "aired" });
		}),
	);
});
