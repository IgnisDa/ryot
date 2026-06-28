import { waitFor } from "@testing-library/dom";
import { Schema } from "effect";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ActiveScreenContext } from "./active-screen";
import {
	RyotClientError,
	type EntityInterest,
	type EntityUpdate,
	type RyotClientAdapter,
} from "./index";
import {
	createRyotMutation,
	createRyotQuery,
	RyotProvider,
	type RyotMutationResult,
	type RyotQueryResult,
	useRyotMutation,
	useRyotQuery,
	useEntityRefresh,
	usePageRefresh,
	usePageRefreshRequest,
} from "./react";
import { createTestRyotClock } from "./testing";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type TestClock = ReturnType<typeof createTestRyotClock>;

let roots: Root[] = [];
let clocks: TestClock[] = [];
let plain: TestClock | undefined;

const makeClock = (overrides: Partial<RyotClientAdapter> = {}) => {
	const clock = createTestRyotClock(overrides);
	clocks.push(clock);
	return clock;
};

let refetch: () => void = () => undefined;
const plainClock = () => (plain ??= makeClock());
const activeScreen = (active: boolean, children: ReactNode) => (
	<ActiveScreenContext.Provider value={active}>{children}</ActiveScreenContext.Provider>
);

const render = (children: ReactNode, runtime = plainClock().runtime) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<RyotProvider runtime={runtime}>{children}</RyotProvider>));
	return container;
};

afterEach(async () => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	plain = undefined;
	await Promise.all(clocks.map((clock) => clock.dispose()));
	clocks = [];
	document.body.innerHTML = "";
});

describe("useRyotQuery", () => {
	it("preserves initial hydration through StrictMode effect reattachment", async () => {
		let calls = 0;
		const clock = makeClock({
			watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		});
		const query = createRyotQuery(() => Promise.resolve(++calls), {
			initialData: () => 0,
			entityInterest: () => ({ foreground: ["root"], visible: [] }),
		});
		const View = () => <p>{useRyotQuery(query).data}</p>;
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<StrictMode>
					<RyotProvider runtime={clock.runtime}>
						<View />
					</RyotProvider>
				</StrictMode>,
			),
		);
		await clock.advance(500);
		expect(container.textContent).toBe("0");
		expect(calls).toBe(0);
	});

	it.each([false, true])(
		"catches up once on a cached remount without duplicating first load (hydrated: %s)",
		async (hydrated) => {
			let calls = 0;
			let watches = 0;
			let disposals = 0;
			const clock = makeClock({
				watchEntities: () => {
					watches++;
					return {
						update: () => undefined,
						dispose: () => {
							disposals++;
						},
					};
				},
			});
			const query = createRyotQuery<{ id: string }, number>(() => Promise.resolve(++calls), {
				...(hydrated ? { initialData: () => 0 } : {}),
				entityInterest: ({ input }) => ({ foreground: [input.id], visible: [] }),
			});
			const View = () => <p>{useRyotQuery(query, { id: "root" }).data ?? "pending"}</p>;
			const views = (
				<>
					<View />
					<View />
				</>
			);
			const container = render(views, clock.runtime);
			await clock.advance(500);
			const initialCalls = hydrated ? 0 : 1;
			expect(calls).toBe(initialCalls);
			expect(container.textContent).toBe(hydrated ? "00" : "11");
			expect(watches).toBe(1);
			act(() => roots[0]?.render(<RyotProvider runtime={clock.runtime}>{null}</RyotProvider>));
			expect(disposals).toBe(1);
			await clock.advance(100);
			act(() => roots[0]?.render(<RyotProvider runtime={clock.runtime}>{views}</RyotProvider>));
			expect(container.textContent).toBe(hydrated ? "00" : "11");
			expect(watches).toBe(2);
			await clock.advance(249);
			expect(calls).toBe(initialCalls);
			await clock.advance(1);
			expect(calls).toBe(initialCalls + 1);
			expect(container.textContent).toBe(hydrated ? "11" : "22");
			await clock.advance(500);
			expect(calls).toBe(initialCalls + 1);
		},
	);

	it("coalesces iframe focus and host page refresh for active consumers only", async () => {
		const calls: string[] = [];
		const clock = makeClock({
			watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		});
		const query = createRyotQuery<string, string>(
			({ input }) => {
				calls.push(input);
				return Promise.resolve(input);
			},
			{ entityInterest: ({ input }) => ({ foreground: [input], visible: [] }) },
		);
		const View = ({ id }: { id: string }) => <p>{useRyotQuery(query, id).data}</p>;
		render(
			<>
				<View id="active" />
				<View id="active" />
				<ActiveScreenContext.Provider value={false}>
					<View id="hidden" />
				</ActiveScreenContext.Provider>
			</>,
			clock.runtime,
		);
		await clock.advance(0);
		expect(calls).toEqual(["active", "hidden"]);
		const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
		try {
			act(() => {
				Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
				document.dispatchEvent(new Event("visibilitychange"));
			});
			await clock.advance(250);
			expect(calls).toEqual(["active", "hidden"]);
			act(() => {
				Object.defineProperty(document, "visibilityState", {
					configurable: true,
					value: "visible",
				});
				document.dispatchEvent(new Event("visibilitychange"));
				document.dispatchEvent(new Event("visibilitychange"));
				clock.client.mutationCompleted.hint();
			});
			await clock.advance(250);
			expect(calls).toEqual(["active", "hidden", "active"]);
		} finally {
			if (visibility) {
				Object.defineProperty(document, "visibilityState", visibility);
			} else {
				Reflect.deleteProperty(document, "visibilityState");
			}
		}
	});

	it("catches an ordinary query up once after page hints while inactive", async () => {
		let calls = 0;
		const clock = makeClock();
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const view = <View />;
		const container = render(activeScreen(true, view), clock.runtime);
		await clock.advance(0);
		expect(container.textContent).toBe("1");

		act(() =>
			roots[0]?.render(
				<RyotProvider runtime={clock.runtime}>{activeScreen(false, view)}</RyotProvider>,
			),
		);
		act(() => {
			clock.client.mutationCompleted.hint();
			clock.client.mutationCompleted.hint();
		});
		await clock.advance(500);
		expect(calls).toBe(1);

		act(() =>
			roots[0]?.render(
				<RyotProvider runtime={clock.runtime}>{activeScreen(true, view)}</RyotProvider>,
			),
		);
		await clock.advance(249);
		expect(calls).toBe(1);
		await clock.advance(1);
		expect(calls).toBe(2);
		expect(container.textContent).toBe("2");
	});

	it("does not cancel a request started after an interest refresh was queued", async () => {
		let hint!: (event: EntityUpdate) => void;
		let latest: RyotQueryResult<number> | undefined;
		const clock = makeClock({
			watchEntities: (_interest, listener) => {
				hint = listener;
				return { update: () => undefined, dispose: () => undefined };
			},
		});
		const requests: Array<{ signal: AbortSignal; resolve: (value: number) => void }> = [];
		const query = createRyotQuery(
			({ signal }) => new Promise<number>((resolve) => requests.push({ signal, resolve })),
			{
				initialData: () => 0,
				entityInterest: () => ({ foreground: ["root"], visible: [] }),
			},
		);
		const View = () => {
			latest = useRyotQuery(query);
			return <p>{latest.data}</p>;
		};
		render(<View />, clock.runtime);
		await clock.advance(0);
		act(() => hint({ entityId: "root", reason: "populated" }));
		await clock.advance(249);
		act(() => latest?.refetch());
		expect(requests).toHaveLength(1);
		await clock.advance(501);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.signal.aborted).toBe(false);
		act(() => {
			requests[0]?.resolve(1);
		});
		await clock.advance(250);
		expect(requests).toHaveLength(2);
		act(() => {
			requests[1]?.resolve(2);
		});
		await clock.advance(500);
		expect(requests).toHaveLength(2);
	});

	it("shares interest owners, retains successful dependencies, and follows in-flight hints once", async () => {
		const updates: EntityInterest[] = [];
		let watches = 0;
		let disposals = 0;
		let hint!: (event: EntityUpdate) => void;
		const watchEntities = (interest: EntityInterest, listener: typeof hint) => {
			watches++;
			updates.push(interest);
			hint = listener;
			return {
				dispose: () => {
					disposals++;
				},
				update: (next: EntityInterest) => {
					updates.push(next);
				},
			};
		};
		const clock = makeClock({ watchEntities });
		const requests: Array<{
			resolve: (value: string[]) => void;
			reject: (error: Error) => void;
			signal: AbortSignal;
		}> = [];
		const query = createRyotQuery(
			({ signal }) =>
				new Promise<string[]>((resolve, reject) => requests.push({ resolve, reject, signal })),
			{
				entityInterest: ({ data }) => ({ foreground: ["root"], visible: data ?? [] }),
			},
		);
		const View = () => <p>{useRyotQuery(query).data?.join(",") ?? "pending"}</p>;
		const container = render(
			<>
				<View />
				<View />
			</>,
			clock.runtime,
		);
		await clock.advance(0);
		expect(watches).toBe(1);
		expect(updates[0]).toEqual({ foreground: ["root"], visible: [] });
		act(() => {
			hint({ entityId: "root", reason: "populated" });
			hint({ entityId: "root", reason: "translated" });
		});
		await clock.advance(1000);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.signal.aborted).toBe(false);
		act(() => {
			requests[0]?.resolve(["child"]);
		});
		await clock.advance(0);
		expect(container.textContent).toBe("childchild");
		expect(updates.at(-1)).toEqual({ foreground: ["root"], visible: ["child"] });
		await clock.advance(250);
		expect(requests).toHaveLength(2);
		act(() => {
			requests[1]?.reject(new Error("offline"));
		});
		await clock.advance(1000);
		expect(requests).toHaveLength(2);
		expect(container.textContent).toBe("childchild");
		expect(updates.at(-1)).toEqual({ foreground: ["root"], visible: ["child"] });
		act(() => roots[0]?.unmount());
		roots = [];
		expect(disposals).toBe(1);
	});

	it("removes hidden demand without canceling work and explicitly catches up on reactivation", async () => {
		let watches = 0;
		let disposals = 0;
		const watchEntities = () => {
			watches++;
			return {
				dispose: () => {
					disposals++;
				},
				update: () => undefined,
			};
		};
		const clock = makeClock({ watchEntities });
		const requests: Array<{ resolve: (value: number) => void; signal: AbortSignal }> = [];
		const query = createRyotQuery(
			({ signal }) => new Promise<number>((resolve) => requests.push({ signal, resolve })),
			{
				cancelOnUnmount: true,
				entityInterest: () => ({ foreground: ["root"], visible: [] }),
			},
		);
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const view = <View />;
		const tree = (active: boolean) => (
			<ActiveScreenContext.Provider value={active}>{view}</ActiveScreenContext.Provider>
		);
		const container = render(tree(true), clock.runtime);
		await clock.advance(0);
		act(() => roots[0]?.render(<RyotProvider runtime={clock.runtime}>{tree(false)}</RyotProvider>));
		expect(disposals).toBe(1);
		expect(requests[0]?.signal.aborted).toBe(false);
		act(() => {
			requests[0]?.resolve(1);
		});
		await clock.advance(0);
		expect(container.textContent).toBe("1");
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await clock.advance(500);
		expect(requests).toHaveLength(1);
		act(() => roots[0]?.render(<RyotProvider runtime={clock.runtime}>{tree(true)}</RyotProvider>));
		await clock.advance(250);
		expect(watches).toBe(2);
		expect(requests).toHaveLength(2);
		expect(container.textContent).toBe("1");
	});

	it("runs a parameterized query and exposes success", async () => {
		const query = createRyotQuery<string, string>(({ input }) => Promise.resolve(input));
		const View = () => {
			const result = useRyotQuery(query, "ready");
			return <p>{`${result.status}:${result.data ?? "none"}`}</p>;
		};
		const container = render(<View />);

		await waitFor(() => expect(container.textContent).toBe("success:ready"));
	});

	it("exposes Promise failures as plain errors", async () => {
		const query = createRyotQuery(() => Promise.reject(new Error("offline")));
		const View = () => {
			const result = useRyotQuery(query);
			return <p>{`${result.status}:${result.error?.message ?? "none"}`}</p>;
		};
		const container = render(<View />);

		await waitFor(() => expect(container.textContent).toBe("error:offline"));
	});

	it("refetches on demand", async () => {
		let calls = 0;
		let latest: RyotQueryResult<number> | undefined;
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => {
			latest = useRyotQuery(query);
			return <p>{latest.data ?? "pending"}</p>;
		};
		const container = render(<View />);
		await waitFor(() => expect(container.textContent).toBe("1"));

		act(() => latest?.refetch());

		await waitFor(() => expect(container.textContent).toBe("2"));
	});

	it("shares hydrated refresh events and replaces consecutive requests", async () => {
		const signals: AbortSignal[] = [];
		const resolveRequests: Array<(value: string) => void> = [];
		let latest: RyotQueryResult<string> | undefined;
		const query = createRyotQuery(
			({ signal }) => {
				signals.push(signal);
				return new Promise<string>((resolve) => resolveRequests.push(resolve));
			},
			{ initialData: () => "hydrated" },
		);
		const View = ({ capture = false }: { capture?: boolean }) => {
			const result = useRyotQuery(query);
			if (capture) {
				latest = result;
			}
			return <p>{result.data ?? "pending"}</p>;
		};
		const container = render(
			<>
				<View capture />
				<View />
			</>,
		);

		expect(container.textContent).toBe("hydratedhydrated");
		expect(signals).toHaveLength(0);

		act(() => latest?.refetch());
		await waitFor(() => expect(signals).toHaveLength(1));
		act(() => latest?.refetch());
		await waitFor(() => expect(signals).toHaveLength(2));
		expect(signals[0]?.aborted).toBe(true);

		await act(async () => {
			resolveRequests[1]?.("event-2");
			await Promise.resolve();
		});
		await waitFor(() => expect(container.textContent).toBe("event-2event-2"));
		await act(async () => {
			resolveRequests[0]?.("stale-event-1");
			await Promise.resolve();
		});
		expect(container.textContent).toBe("event-2event-2");
	});

	it("deduplicates subscribers in one provider", async () => {
		let calls = 0;
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const container = render(
			<>
				<View />
				<View />
			</>,
		);

		await waitFor(() => expect(container.textContent).toBe("11"));
		expect(calls).toBe(1);
	});

	it("deduplicates structurally equal object inputs", async () => {
		let calls = 0;
		const query = createRyotQuery<{ readonly page: number }, number>(({ input }) => {
			calls++;
			return Promise.resolve(input.page);
		});
		const View = () => <p>{useRyotQuery(query, { page: 1 }).data ?? "pending"}</p>;
		const container = render(
			<>
				<View />
				<View />
			</>,
		);

		await waitFor(() => expect(container.textContent).toBe("11"));
		expect(calls).toBe(1);
	});

	it("refreshes active queries after a direct capability mutation", async () => {
		let calls = 0;
		const clock = makeClock({
			invokeOperation: () => Promise.resolve("saved"),
		});
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const container = render(<View />, clock.runtime);
		await clock.advance(0);

		await clock.client.operations.invoke({
			input: {},
			slug: "save",
			pluginSlug: "fixture",
			output: Schema.String,
		});
		await clock.advance(249);
		expect(calls).toBe(1);
		await clock.advance(1);

		expect(calls).toBe(2);
		expect(container.textContent).toBe("2");
	});

	it("retains one pending page hint while a query refresh is running", async () => {
		const requests: Array<(value: number) => void> = [];
		const clock = makeClock();
		const query = createRyotQuery(() => new Promise<number>((resolve) => requests.push(resolve)));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		render(<View />, clock.runtime);
		await clock.advance(0);
		act(() => requests[0]?.(1));
		await clock.advance(0);

		act(() => clock.client.mutationCompleted.hint());
		await clock.advance(250);
		expect(requests).toHaveLength(2);
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
			clock.client.mutationCompleted.hint();
		});
		await clock.advance(500);
		expect(requests).toHaveLength(2);
		act(() => requests[1]?.(2));
		await clock.advance(0);
		expect(requests).toHaveLength(3);
	});

	it("runs arbitrary active-page refresh callbacks through the shared registry", async () => {
		let refreshes = 0;
		const clock = makeClock();
		const View = () => {
			usePageRefresh(() => {
				refreshes++;
			});
			return null;
		};
		render(<View />, clock.runtime);

		act(() => clock.client.mutationCompleted.hint());
		await clock.advance(250);

		expect(refreshes).toBe(1);
		act(() => {
			clock.client.mutationCompleted.hint();
			roots[0]?.unmount();
		});
		roots = [];
		await clock.advance(250);
		expect(refreshes).toBe(1);
	});

	it("catches an arbitrary page callback up once after inactive hints", async () => {
		let refreshes = 0;
		const clock = makeClock();
		const View = () => {
			usePageRefresh(() => {
				refreshes++;
			});
			return null;
		};
		const view = <View />;
		render(activeScreen(true, view), clock.runtime);
		act(() =>
			roots[0]?.render(
				<RyotProvider runtime={clock.runtime}>{activeScreen(false, view)}</RyotProvider>,
			),
		);
		act(() => {
			clock.client.mutationCompleted.hint();
			clock.client.mutationCompleted.hint();
		});
		await clock.advance(500);
		expect(refreshes).toBe(0);

		act(() =>
			roots[0]?.render(
				<RyotProvider runtime={clock.runtime}>{activeScreen(true, view)}</RyotProvider>,
			),
		);
		await clock.advance(250);
		expect(refreshes).toBe(1);
	});

	it("requests a page refresh without publishing mutation completion", async () => {
		let request: () => void = refetch;
		let refreshes = 0;
		let mutationHints = 0;
		const clock = makeClock();
		clock.client.mutationCompleted.subscribe(() => mutationHints++);
		const View = () => {
			request = usePageRefreshRequest();
			usePageRefresh(() => {
				refreshes++;
			});
			return null;
		};
		render(<View />, clock.runtime);

		act(() => request());
		await clock.advance(250);

		expect(refreshes).toBe(1);
		expect(mutationHints).toBe(0);
	});

	it("lets replay-controlled queries opt out of the automatic page refresh", async () => {
		let calls = 0;
		const clock = makeClock();
		const query = createRyotQuery<string, number>(() => Promise.resolve(++calls));
		const View = () => {
			const result = useRyotQuery(query, "page", { refreshOnMutation: false });
			refetch = result.refetch;
			usePageRefresh(result.refetch);
			return <p>{result.data ?? "pending"}</p>;
		};
		const container = render(<View />, clock.runtime);
		await clock.advance(0);

		act(() => clock.client.mutationCompleted.hint());
		await clock.advance(250);

		expect(calls).toBe(2);
		expect(container.textContent).toBe("2");
		act(() => refetch());
		await clock.advance(0);
		expect(calls).toBe(3);
	});

	it("cancels opted-in in-flight queries when the final consumer unmounts", async () => {
		let signal: AbortSignal | undefined;
		const query = createRyotQuery(
			({ signal: requestSignal }) => {
				signal = requestSignal;
				return new Promise<never>((_resolve, reject) => {
					requestSignal.addEventListener("abort", () => reject(requestSignal.reason), {
						once: true,
					});
				});
			},
			{ cancelOnUnmount: true },
		);
		const View = () => <p>{useRyotQuery(query).status}</p>;
		const { runtime } = plainClock();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider runtime={runtime}>
					<View />
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(signal).toBeDefined());

		act(() => root.render(<RyotProvider runtime={runtime}>{null}</RyotProvider>));

		await waitFor(() => expect(signal?.aborted).toBe(true));
	});

	it("retains default query data across consumer unmounts", async () => {
		let calls = 0;
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const { runtime } = plainClock();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider runtime={runtime}>
					<View />
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(container.textContent).toBe("1"));

		act(() => root.render(<RyotProvider runtime={runtime}>{null}</RyotProvider>));
		act(() =>
			root.render(
				<RyotProvider runtime={runtime}>
					<View />
				</RyotProvider>,
			),
		);

		await waitFor(() => expect(container.textContent).toBe("1"));
		expect(calls).toBe(1);
	});

	it("isolates caches between providers", async () => {
		let calls = 0;
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).status}</p>;
		const { runtime } = plainClock();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<>
					<RyotProvider runtime={runtime}>
						<View />
					</RyotProvider>
					<RyotProvider runtime={runtime}>
						<View />
					</RyotProvider>
				</>,
			),
		);

		await waitFor(() => expect(container.textContent).toBe("successsuccess"));
		expect(calls).toBe(2);
	});
});

describe("useEntityRefresh", () => {
	it("holds blocked hints, uses a stable watch, and clears queued work on identity changes", async () => {
		let hint!: (event: EntityUpdate) => void;
		let watches = 0;
		let refreshes = 0;
		let disposals = 0;
		const watchEntities = (_interest: EntityInterest, listener: typeof hint) => {
			watches++;
			hint = listener;
			return {
				dispose: () => {
					disposals++;
				},
				update: () => undefined,
			};
		};
		const clock = makeClock({ watchEntities });
		const onRefresh = () => {
			refreshes++;
			return Promise.reject(new Error("offline"));
		};
		const View = ({ identity, blocked }: { identity: string; blocked: boolean }) => {
			useEntityRefresh({
				identity,
				blocked,
				onRefresh,
				interest: { foreground: [identity], visible: [] },
			});
			return null;
		};
		render(<View identity="a" blocked />, clock.runtime);
		act(() => hint({ entityId: "a", reason: "populated" }));
		await clock.advance(500);
		expect(refreshes).toBe(0);
		act(() =>
			roots[0]?.render(
				<RyotProvider runtime={clock.runtime}>
					<View identity="a" blocked={false} />
				</RyotProvider>,
			),
		);
		expect(watches).toBe(1);
		await clock.advance(250);
		expect(refreshes).toBe(1);
		await clock.advance(1000);
		expect(refreshes).toBe(1);
		act(() => hint({ entityId: "a", reason: "translated" }));
		act(() =>
			roots[0]?.render(
				<RyotProvider runtime={clock.runtime}>
					<View identity="b" blocked={false} />
				</RyotProvider>,
			),
		);
		await clock.advance(250);
		expect(refreshes).toBe(1);
		expect(disposals).toBe(1);
		act(() => hint({ entityId: "b", reason: "populated" }));
		act(() => roots[0]?.unmount());
		roots = [];
		await clock.advance(250);
		expect(refreshes).toBe(1);
	});

	it("does not crash on transient transport failures", () => {
		const clock = makeClock({
			watchEntities: () => {
				throw new RyotClientError("transport");
			},
		});
		let refreshes = 0;
		const onRefresh = () => {
			refreshes++;
			return Promise.resolve();
		};
		const View = () => {
			useEntityRefresh({
				onRefresh,
				blocked: false,
				identity: "root",
				interest: { foreground: ["root"], visible: [] },
			});
			return <p>available</p>;
		};
		expect(render(<View />, clock.runtime).textContent).toBe("available");
		expect(refreshes).toBe(0);
	});
});

describe("useRyotMutation", () => {
	it("does not duplicate the capability mutation-completed hint", async () => {
		let hints = 0;
		let latest: RyotMutationResult<void, string> | undefined;
		const clock = makeClock({ invokeOperation: () => Promise.resolve("saved") });
		clock.client.mutationCompleted.subscribe(() => hints++);
		const mutation = createRyotMutation(({ client }) =>
			client.operations.invoke({
				input: {},
				slug: "save",
				pluginSlug: "fixture",
				output: Schema.String,
			}),
		);
		const View = () => {
			latest = useRyotMutation(mutation);
			return null;
		};
		render(<View />, clock.runtime);

		await act(() => latest?.mutateAsync());

		expect(hints).toBe(1);
	});

	it("tracks pending, success, reset, and error state", async () => {
		let resolve!: (value: string) => void;
		let shouldFail = false;
		let latest: RyotMutationResult<string, string> | undefined;
		const mutation = createRyotMutation<string, string>(({ input: _input }) => {
			if (shouldFail) {
				return Promise.reject(new Error("denied"));
			}
			return new Promise<string>((resolvePromise) => {
				resolve = resolvePromise;
			});
		});
		const View = () => {
			latest = useRyotMutation(mutation);
			return <p>{`${latest.status}:${latest.data ?? latest.error?.message ?? "none"}`}</p>;
		};
		const container = render(<View />);
		expect(container.textContent).toBe("idle:none");
		if (!latest) {
			throw new Error("Mutation hook did not render");
		}
		const mutationResult = latest;

		let pending!: Promise<string>;
		await act(async () => {
			pending = mutationResult.mutateAsync("saved");
			await Promise.resolve();
		});
		expect(container.textContent).toBe("pending:none");
		await act(async () => {
			resolve("saved");
			await pending;
		});
		expect(container.textContent).toBe("success:saved");

		act(() => mutationResult.reset());
		expect(container.textContent).toBe("idle:none");

		shouldFail = true;
		let failure!: Promise<string>;
		await act(async () => {
			failure = mutationResult.mutateAsync("failed");
			await failure.catch(() => undefined);
		});
		await expect(failure).rejects.toThrow("denied");
		await waitFor(() => expect(container.textContent).toBe("error:denied"));
	});

	it("serves a fresh query from cache when the app returns to the foreground", async () => {
		let calls = 0;
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const { runtime } = plainClock();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider runtime={runtime}>
					<View />
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(container.textContent).toBe("1"));

		act(() => {
			Object.defineProperty(document, "visibilityState", {
				value: "visible",
				configurable: true,
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(container.textContent).toBe("1");
		expect(calls).toBe(1);
	});
});
