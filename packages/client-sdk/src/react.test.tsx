import { waitFor } from "@testing-library/dom";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveScreenContext } from "./active-screen";
import { createRyotClient, RyotClientError, type EntityInterest, type EntityUpdate } from "./index";
import {
	createRyotMutation,
	createRyotQuery,
	RyotProvider,
	type RyotMutationResult,
	type RyotQueryResult,
	useRyotMutation,
	useRyotQuery,
	useEntityRefresh,
} from "./react";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const client = createRyotClient({ query: () => Promise.resolve({}) });
let roots: Root[] = [];

const render = (children: ReactNode, providerClient = client) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() => root.render(<RyotProvider client={providerClient}>{children}</RyotProvider>));
	return container;
};

afterEach(() => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("useRyotQuery", () => {
	it("preserves initial hydration through StrictMode effect reattachment", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const interestClient = createRyotClient({
			query: () => Promise.resolve({}),
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
					<RyotProvider client={interestClient}>
						<View />
					</RyotProvider>
				</StrictMode>,
			),
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(container.textContent).toBe("0");
		expect(calls).toBe(0);
	});

	it.each([false, true])(
		"catches up once on a cached remount without duplicating first load (hydrated: %s)",
		async (hydrated) => {
			vi.useFakeTimers();
			let calls = 0;
			let watches = 0;
			let disposals = 0;
			const interestClient = createRyotClient({
				query: () => Promise.resolve({}),
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
			const container = render(views, interestClient);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(500);
			});
			const initialCalls = hydrated ? 0 : 1;
			expect(calls).toBe(initialCalls);
			expect(container.textContent).toBe(hydrated ? "00" : "11");
			expect(watches).toBe(1);
			act(() => roots[0]?.render(<RyotProvider client={interestClient}>{null}</RyotProvider>));
			expect(disposals).toBe(1);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(100);
			});
			act(() => roots[0]?.render(<RyotProvider client={interestClient}>{views}</RyotProvider>));
			expect(container.textContent).toBe(hydrated ? "00" : "11");
			expect(watches).toBe(2);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(249);
			});
			expect(calls).toBe(initialCalls);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1);
			});
			expect(calls).toBe(initialCalls + 1);
			expect(container.textContent).toBe(hydrated ? "11" : "22");
			await act(async () => {
				await vi.advanceTimersByTimeAsync(500);
			});
			expect(calls).toBe(initialCalls + 1);
		},
	);

	it("coalesces document foreground refresh for active consumers only", async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const interestClient = createRyotClient({
			query: () => Promise.resolve({}),
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
			interestClient,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(calls).toEqual(["active", "hidden"]);
		const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
		try {
			act(() => {
				Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
				document.dispatchEvent(new Event("visibilitychange"));
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(250);
			});
			expect(calls).toEqual(["active", "hidden"]);
			act(() => {
				Object.defineProperty(document, "visibilityState", {
					configurable: true,
					value: "visible",
				});
				document.dispatchEvent(new Event("visibilitychange"));
				document.dispatchEvent(new Event("visibilitychange"));
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(250);
			});
			expect(calls).toEqual(["active", "hidden", "active"]);
		} finally {
			if (visibility) {
				Object.defineProperty(document, "visibilityState", visibility);
			} else {
				Reflect.deleteProperty(document, "visibilityState");
			}
		}
	});

	it("does not cancel a request started after an interest refresh was queued", async () => {
		vi.useFakeTimers();
		let hint!: (event: EntityUpdate) => void;
		let latest: RyotQueryResult<number> | undefined;
		const interestClient = createRyotClient({
			query: () => Promise.resolve({}),
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
		render(<View />, interestClient);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		act(() => hint({ entityId: "root", reason: "populated" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(249);
		});
		act(() => latest?.refetch());
		expect(requests).toHaveLength(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(501);
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.signal.aborted).toBe(false);
		await act(async () => {
			requests[0]?.resolve(1);
			await vi.advanceTimersByTimeAsync(250);
		});
		expect(requests).toHaveLength(2);
		await act(async () => {
			requests[1]?.resolve(2);
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(requests).toHaveLength(2);
	});

	it("shares interest owners, retains successful dependencies, and follows in-flight hints once", async () => {
		vi.useFakeTimers();
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
		const interestClient = createRyotClient({ watchEntities, query: () => Promise.resolve({}) });
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
			interestClient,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(watches).toBe(1);
		expect(updates[0]).toEqual({ foreground: ["root"], visible: [] });
		act(() => {
			hint({ entityId: "root", reason: "populated" });
			hint({ entityId: "root", reason: "translated" });
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.signal.aborted).toBe(false);
		await act(async () => {
			requests[0]?.resolve(["child"]);
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(container.textContent).toBe("childchild");
		expect(updates.at(-1)).toEqual({ foreground: ["root"], visible: ["child"] });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
		expect(requests).toHaveLength(2);
		await act(async () => {
			requests[1]?.reject(new Error("offline"));
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(requests).toHaveLength(2);
		expect(updates.at(-1)).toEqual({ foreground: ["root"], visible: ["child"] });
		act(() => roots[0]?.unmount());
		roots = [];
		expect(disposals).toBe(1);
	});

	it("removes hidden demand without canceling work and explicitly catches up on reactivation", async () => {
		vi.useFakeTimers();
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
		const interestClient = createRyotClient({ watchEntities, query: () => Promise.resolve({}) });
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
		const container = render(tree(true), interestClient);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		act(() => roots[0]?.render(<RyotProvider client={interestClient}>{tree(false)}</RyotProvider>));
		expect(disposals).toBe(1);
		expect(requests[0]?.signal.aborted).toBe(false);
		await act(async () => {
			requests[0]?.resolve(1);
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(container.textContent).toBe("1");
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(requests).toHaveLength(1);
		act(() => roots[0]?.render(<RyotProvider client={interestClient}>{tree(true)}</RyotProvider>));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
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
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider client={client}>
					<View />
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(signal).toBeDefined());

		act(() => root.render(<RyotProvider client={client}>{null}</RyotProvider>));

		await waitFor(() => expect(signal?.aborted).toBe(true));
	});

	it("retains default query data across consumer unmounts", async () => {
		let calls = 0;
		const query = createRyotQuery(() => Promise.resolve(++calls));
		const View = () => <p>{useRyotQuery(query).data ?? "pending"}</p>;
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider client={client}>
					<View />
				</RyotProvider>,
			),
		);
		await waitFor(() => expect(container.textContent).toBe("1"));

		act(() => root.render(<RyotProvider client={client}>{null}</RyotProvider>));
		act(() =>
			root.render(
				<RyotProvider client={client}>
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
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<>
					<RyotProvider client={client}>
						<View />
					</RyotProvider>
					<RyotProvider client={client}>
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
		vi.useFakeTimers();
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
		const interestClient = createRyotClient({ watchEntities, query: () => Promise.resolve({}) });
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
		render(<View identity="a" blocked />, interestClient);
		act(() => hint({ entityId: "a", reason: "populated" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(refreshes).toBe(0);
		act(() =>
			roots[0]?.render(
				<RyotProvider client={interestClient}>
					<View identity="a" blocked={false} />
				</RyotProvider>,
			),
		);
		expect(watches).toBe(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
		expect(refreshes).toBe(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(refreshes).toBe(1);
		act(() => hint({ entityId: "a", reason: "translated" }));
		act(() =>
			roots[0]?.render(
				<RyotProvider client={interestClient}>
					<View identity="b" blocked={false} />
				</RyotProvider>,
			),
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
		expect(refreshes).toBe(1);
		expect(disposals).toBe(1);
		act(() => hint({ entityId: "b", reason: "populated" }));
		act(() => roots[0]?.unmount());
		roots = [];
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
		expect(refreshes).toBe(1);
	});

	it("does not crash on transient transport failures", () => {
		const interestClient = createRyotClient({
			query: () => Promise.resolve({}),
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
		expect(render(<View />, interestClient).textContent).toBe("available");
		expect(refreshes).toBe(0);
	});
});

describe("useRyotMutation", () => {
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
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() =>
			root.render(
				<RyotProvider client={client}>
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
