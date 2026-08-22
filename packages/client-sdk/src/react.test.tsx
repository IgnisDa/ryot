import { waitFor } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { createRyotClient } from "./index";
import {
	createRyotMutation,
	createRyotQuery,
	RyotProvider,
	type RyotMutationResult,
	type RyotQueryResult,
	useRyotMutation,
	useRyotQuery,
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
	document.body.innerHTML = "";
});

describe("useRyotQuery", () => {
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
});
