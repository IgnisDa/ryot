import { afterEach, describe, expect, it } from "@effect/vitest";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { Effect, Schema } from "effect";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { RyotClientError, type RyotClientAdapter } from "./index";
import {
	createRyotMutation,
	createRyotQuery,
	RyotProvider,
	useRyotMutation,
	useRyotQuery,
	usePluginStorage,
	type RyotMutationResult,
	type RyotQueryResult,
} from "./react";
import { createTestPluginStorage, createTestRyotClock } from "./testing";

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
	return Promise.all(clocks.splice(0).map((clock) => clock.dispose())).then(() => {
		document.body.innerHTML = "";
		return undefined;
	});
});

describe("Effect-native React definitions", () => {
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
				pluginSlug: "fixture",
				output: Schema.String,
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
						pluginSlug: "fixture",
						output: Schema.String,
					});
					return yield* client.operations.invoke({
						input: first,
						slug: "second",
						pluginSlug: "fixture",
						output: Schema.String,
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
			const result = yield* Effect.promise(() => act(() => latest?.mutateAsync("saved")));
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
			yield* Effect.promise(() =>
				act(() => expect(latest?.mutateAsync("failed")).rejects.toMatchObject({ reason: "quota" })),
			);
			expect(container.textContent).toBe("error:quota");
			act(() => latest?.reset());
			expect(container.textContent).toBe("idle:none");
		}),
	);

	it.live("reads and writes storage at the React boundary", () =>
		Effect.gen(function* () {
			const storage = createTestPluginStorage([["fixture:order", { order: "dvd" }]]);
			const clock = makeClock({ accessStorage: storage.accessStorage });
			const schema = Schema.Struct({ order: Schema.Literals(["aired", "dvd"]) });
			const View = () => {
				const value = usePluginStorage({ schema, key: "order", pluginSlug: "fixture" });
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
			expect(storage.entries.get("fixture:order")).toEqual({ order: "aired" });
		}),
	);
});
