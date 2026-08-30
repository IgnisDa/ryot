import { fireEvent } from "@testing-library/dom";
import { act, type ReactNode, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	defineEntityPresentation,
	EntityPresentationRegistryProvider,
	EntityResults,
	type EntityPresentationRegistration,
	type EntityReference,
} from "./entity-results";
import type { EntityInterest, EntityUpdate, RyotClientAdapter } from "./index";
import { createPluginNavigationStore } from "./navigation/store";
import { RyotProvider } from "./react";
import { createPluginRouteResolver, PluginRouter } from "./routing";
import { createTestRyotClock } from "./testing";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const reference = (
	entityId: string,
	overrides: Partial<EntityReference> = {},
): EntityReference => ({
	entityId,
	ownerPluginId: "owner",
	entitySchemaSlug: "item",
	populationStatus: "ready",
	name: `Entity ${entityId}`,
	translationStatus: "ready",
	...overrides,
});

type Clock = ReturnType<typeof createTestRyotClock>;
let roots: Root[] = [];
let clocks: Clock[] = [];
const originalIntersectionObserver = globalThis.IntersectionObserver;
const Inactive = () => null;

const render = (
	registrations: readonly EntityPresentationRegistration[],
	children: ReactNode,
	adapter: Partial<RyotClientAdapter> = {},
) => {
	let current = children;
	const listeners = new Set<() => void>();
	const Screen = () =>
		useSyncExternalStore(
			(listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			() => current,
			() => current,
		);
	const store = createPluginNavigationStore(
		createPluginRouteResolver({
			home: { component: Screen },
			routes: [{ path: "/inactive", component: Inactive }],
		}),
	);
	const navigation = {
		back: () => undefined,
		subscribe: store.subscribe,
		openDrawer: () => undefined,
		publishTitle: () => undefined,
		getSnapshot: store.getSnapshot,
		completeTransition: store.completeTransition,
	};
	const clock = createTestRyotClock(
		{
			navigate: () => undefined,
			watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
			...adapter,
		},
		navigation,
	);
	clocks.push(clock);
	store.setLocation({
		compact: false,
		leading: "none",
		edgeBack: false,
		entry: { index: 0, key: "home", location: { kind: "route", path: "/", search: "" } },
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const draw = (next: ReactNode) =>
		act(() => {
			current = next;
			for (const listener of listeners) {
				listener();
			}
		});
	act(() => {
		root.render(
			<RyotProvider runtime={clock.runtime}>
				<EntityPresentationRegistryProvider registrations={registrations}>
					<PluginRouter />
				</EntityPresentationRegistryProvider>
			</RyotProvider>,
		);
	});
	const navigate = (path: string, index: number, key: string) =>
		act(() =>
			store.setLocation({
				compact: false,
				edgeBack: false,
				leading: "none",
				entry: { index, key, location: { kind: "route", path, search: "" } },
			}),
		);
	return { clock, container, draw, navigate };
};

const flush = async (clock: Clock, turns = 6) => {
	if (turns > 0) {
		await clock.advance(0);
		await flush(clock, turns - 1);
	}
};

const clickRetry = (container: HTMLElement) => {
	const button = container.querySelector("button");
	expect(button).not.toBeNull();
	if (button) {
		act(() => {
			fireEvent.click(button);
		});
	}
};

afterEach(async () => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	await Promise.all(clocks.map((clock) => clock.dispose()));
	clocks = [];
	globalThis.IntersectionObserver = originalIntersectionObserver;
	document.body.innerHTML = "";
});

const installIntersectionObserver = () => {
	type Record = {
		readonly root: Element | Document | null;
		readonly targets: Set<Element>;
		disconnected: boolean;
		emit: (target: Element, isIntersecting: boolean) => void;
	};
	const records: Record[] = [];
	class RecordingIntersectionObserver implements IntersectionObserver {
		readonly root: Element | Document | null;
		readonly rootMargin = "0px";
		readonly scrollMargin = "0px";
		readonly thresholds = [0];
		readonly targets = new Set<Element>();
		private readonly record: Record;
		constructor(
			private readonly callback: IntersectionObserverCallback,
			options: IntersectionObserverInit = {},
		) {
			this.root = options.root ?? null;
			this.record = {
				root: this.root,
				targets: this.targets,
				disconnected: false,
				emit: (target, isIntersecting) => this.emit(target, isIntersecting),
			};
			records.push(this.record);
		}
		disconnect() {
			this.record.disconnected = true;
			this.targets.clear();
		}
		observe(target: Element) {
			this.targets.add(target);
		}
		takeRecords() {
			return [];
		}
		unobserve(target: Element) {
			this.targets.delete(target);
		}
		private emit(target: Element, isIntersecting: boolean) {
			const rect = target.getBoundingClientRect();
			this.callback(
				[
					{
						target,
						time: 0,
						isIntersecting,
						boundingClientRect: rect,
						intersectionRatio: isIntersecting ? 1 : 0,
						intersectionRect: isIntersecting ? rect : new DOMRectReadOnly(),
						rootBounds: this.root instanceof Element ? this.root.getBoundingClientRect() : null,
					},
				],
				this,
			);
		}
	}
	globalThis.IntersectionObserver = RecordingIntersectionObserver;
	return records;
};

describe("EntityResults", () => {
	it("declares only intersecting entities from the shared screen root and cleans up", async () => {
		const observers = installIntersectionObserver();
		const interests: EntityInterest[] = [];
		let completion: ((update: EntityUpdate) => void) | undefined;
		let disposals = 0;
		let loads = 0;
		let mounts = 0;
		const Presentation = ({ data }: { readonly data: string }) => {
			useState(() => {
				mounts++;
			});
			return <p>{data}</p>;
		};
		const registration = {
			ownerPluginId: "owner",
			layout: "grid" as const,
			entitySchemaSlug: "item",
			definition: defineEntityPresentation({
				component: Presentation,
				loader: ({ references }) => {
					loads++;
					return Promise.resolve(
						Object.fromEntries(references.map(({ entityId }) => [entityId, entityId])),
					);
				},
			}),
		};
		const { clock, container, draw, navigate } = render(
			[registration],
			<EntityResults
				layout="grid"
				viewContext={null}
				references={[reference("one"), reference("two")]}
			/>,
			{
				watchEntities: (interest, listener) => {
					interests.push(interest);
					completion = listener;
					return {
						update: (next) => interests.push(next),
						dispose: () => {
							disposals++;
						},
					};
				},
			},
		);
		await flush(clock);
		expect(observers).toHaveLength(1);
		const observer = observers[0];
		expect(observer?.root).toBe(container.firstElementChild?.firstElementChild);
		expect(observer?.targets.size).toBe(2);
		expect(interests.at(-1)).toEqual({ foreground: [], visible: [] });
		expect({ loads, mounts }).toEqual({ loads: 1, mounts: 2 });
		const [one, two] = [...(observer?.targets ?? [])];
		if (one && two && observer) {
			act(() => observer.emit(one, true));
			await flush(clock);
			expect(interests.at(-1)).toEqual({ foreground: [], visible: ["one"] });
			act(() => completion?.({ entityId: "one", reason: "populated" }));
			await clock.advance(499);
			expect(loads).toBe(1);
			await clock.advance(1);
			expect(loads).toBe(2);
			expect({ loads, mounts }).toEqual({ loads: 2, mounts: 2 });
			act(() => observer.emit(two, false));
			await flush(clock);
			expect(interests.at(-1)).toEqual({ foreground: [], visible: ["one"] });
			draw(<EntityResults layout="grid" viewContext={null} references={[reference("two")]} />);
			await flush(clock);
			expect(interests.at(-1)).toEqual({ foreground: [], visible: [] });
			const remaining = [...observer.targets][0];
			if (remaining) {
				act(() => observer.emit(remaining, true));
				await flush(clock);
				expect(interests.at(-1)).toEqual({ foreground: [], visible: ["two"] });
			}
			await navigate("/inactive", 1, "inactive");
			await flush(clock);
			expect(observer.disconnected).toBe(true);
			await navigate("/", 0, "home");
			await flush(clock);
			expect(observers).toHaveLength(2);
			expect(interests.at(-1)).toEqual({ foreground: [], visible: [] });
		}
		act(() => roots[0]?.unmount());
		roots = [];
		expect(observers.every(({ disconnected }) => disconnected)).toBe(true);
		expect(disposals).toBeGreaterThan(0);
	});

	it("uses the exact owner, schema, and layout while preserving visible order", async () => {
		const requests: Array<{
			readonly ids: readonly string[];
			readonly resolve: (value: Readonly<Record<string, string>>) => void;
		}> = [];
		const presentation = (label: string) =>
			defineEntityPresentation({
				loader: ({ references }) =>
					new Promise<Readonly<Record<string, string>>>((resolve) =>
						requests.push({ ids: references.map(({ entityId }) => entityId), resolve }),
					),
				component: ({ data }) => <p>{`${label}:${data}`}</p>,
			});
		const registrations = [
			{
				layout: "grid",
				ownerPluginId: "other",
				entitySchemaSlug: "item",
				definition: presentation("wrong-owner"),
			},
			{
				layout: "grid",
				ownerPluginId: "owner",
				entitySchemaSlug: "other",
				definition: presentation("wrong-schema"),
			},
			{
				layout: "list",
				ownerPluginId: "owner",
				entitySchemaSlug: "item",
				definition: presentation("wrong-layout"),
			},
			{
				layout: "grid",
				ownerPluginId: "owner",
				entitySchemaSlug: "item",
				definition: presentation("exact"),
			},
		] as const;
		const { clock, container } = render(
			registrations,
			<EntityResults
				layout="grid"
				viewContext={{ savedViewId: "view" }}
				references={[reference("b"), reference("a")]}
			/>,
		);
		await flush(clock);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.ids).toEqual(["a", "b"]);
		act(() => requests[0]?.resolve({ b: "second", a: "first" }));
		await flush(clock);
		expect(container.textContent).toBe("exact:secondexact:first");
	});

	it("chunks sorted IDs at 100 and admits only four batches at once", async () => {
		const requests: Array<{
			readonly ids: readonly string[];
			readonly resolve: (value: Readonly<Record<string, string>>) => void;
		}> = [];
		const registrations = Array.from({ length: 5 }, (_, index) => ({
			layout: "grid" as const,
			entitySchemaSlug: "item",
			ownerPluginId: `owner-${index}`,
			definition: defineEntityPresentation({
				loader: ({ references }) =>
					new Promise<Readonly<Record<string, string>>>((resolve) =>
						requests.push({ ids: references.map(({ entityId }) => entityId), resolve }),
					),
				component: ({ data }) => <p>{data}</p>,
			}),
		}));
		const many = Array.from({ length: 201 }, (_, index) =>
			reference(String(200 - index).padStart(3, "0"), { ownerPluginId: "owner-0" }),
		);
		const extras = registrations
			.slice(1)
			.map((registration, index) =>
				reference(`extra-${index}`, { ownerPluginId: registration.ownerPluginId }),
			);
		const { clock } = render(
			registrations,
			<EntityResults layout="grid" references={[...many, ...extras]} viewContext={null} />,
		);
		await flush(clock);
		expect(requests).toHaveLength(4);
		expect(
			requests
				.slice(0, 3)
				.map(({ ids }) => ids.length)
				.sort((a, b) => a - b),
		).toEqual([1, 100, 100]);
		for (const { ids } of requests.slice(0, 3)) {
			expect(ids).toEqual([...ids].sort());
		}
		act(() => requests[0]?.resolve(Object.fromEntries(requests[0].ids.map((id) => [id, id]))));
		await flush(clock);
		expect(requests).toHaveLength(5);
	});

	it("releases scheduler slots after synchronous loader failures", async () => {
		const calls: string[] = [];
		const registrations = Array.from({ length: 5 }, (_, index) => ({
			layout: "grid" as const,
			entitySchemaSlug: "item",
			ownerPluginId: `owner-${index}`,
			definition: defineEntityPresentation({
				loader: ({ references }) => {
					const id = references[0]?.entityId ?? "";
					calls.push(id);
					if (index < 4) {
						throw new Error("synchronous failure");
					}
					return Promise.resolve({ [id]: "healthy" });
				},
				component: ({ data }) => <p>{data}</p>,
			}),
		}));
		const { clock, container } = render(
			registrations,
			<EntityResults
				layout="grid"
				viewContext={null}
				references={registrations.map((registration, index) =>
					reference(`entity-${index}`, { ownerPluginId: registration.ownerPluginId }),
				)}
			/>,
		);

		await flush(clock);
		expect(calls).toEqual(["entity-0", "entity-1", "entity-2", "entity-3", "entity-4"]);
		expect(container.textContent).toContain("healthy");
	});

	it("deduplicates consumers and cancels obsolete batch inputs", async () => {
		const requests: Array<{
			readonly signal: AbortSignal;
			readonly id: string;
			readonly resolve: (value: Readonly<Record<string, string>>) => void;
		}> = [];
		const registration = {
			ownerPluginId: "owner",
			layout: "grid" as const,
			entitySchemaSlug: "item",
			definition: defineEntityPresentation({
				loader: ({ references, signal }) =>
					new Promise<Readonly<Record<string, string>>>((resolve) =>
						requests.push({ id: references[0]?.entityId ?? "", signal, resolve }),
					),
				component: ({ data }) => <p>{data}</p>,
			}),
		};
		const one = <EntityResults layout="grid" references={[reference("one")]} viewContext={null} />;
		const { clock, container, draw } = render(
			[registration],
			<>
				{one}
				{one}
			</>,
		);
		await flush(clock);
		expect(requests).toHaveLength(1);
		draw(<EntityResults layout="grid" references={[reference("two")]} viewContext={null} />);
		await flush(clock);
		expect(requests[0]?.signal.aborted).toBe(true);
		expect(requests).toHaveLength(2);
		act(() => {
			requests[1]?.resolve({ two: "current" });
			requests[0]?.resolve({ one: "stale" });
		});
		await flush(clock);
		expect(container.textContent).toBe("current");
	});

	it("keeps presentation state and prior data when a refresh fails", async () => {
		const requests: Array<{
			readonly resolve: (value: Readonly<Record<string, string>>) => void;
			readonly reject: (error: Error) => void;
		}> = [];
		let mounts = 0;
		const Presentation = ({ data }: { readonly data: string }) => {
			const [expanded, setExpanded] = useState(false);
			useState(() => {
				mounts++;
			});
			return (
				<section>
					<p>{`${data}:${expanded ? "expanded" : "collapsed"}`}</p>
					<button type="button" onClick={() => setExpanded(true)}>
						Expand
					</button>
				</section>
			);
		};
		const registration = {
			ownerPluginId: "owner",
			layout: "grid" as const,
			entitySchemaSlug: "item",
			definition: defineEntityPresentation({
				loader: () =>
					new Promise<Readonly<Record<string, string>>>((resolve, reject) =>
						requests.push({ resolve, reject }),
					),
				component: Presentation,
			}),
		};
		const { clock, container } = render(
			[registration],
			<EntityResults layout="grid" references={[reference("one")]} viewContext={null} />,
		);
		await flush(clock);
		act(() => requests[0]?.resolve({ one: "old" }));
		await flush(clock);
		const expand = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Expand",
		);
		expect(expand).toBeDefined();
		if (expand) {
			act(() => {
				fireEvent.click(expand);
			});
		}
		expect(container.textContent).toContain("old:expanded");
		act(() => clock.client.mutationCompleted.hint());
		await clock.advance(250);
		expect(requests).toHaveLength(2);
		act(() => requests[1]?.reject(new Error("offline")));
		await flush(clock);
		expect(container.textContent).toContain("Refresh failed.");
		expect(container.textContent).toContain("old:expanded");
		expect(mounts).toBe(1);
		const retry = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Retry",
		);
		expect(retry).toBeDefined();
		if (retry) {
			act(() => {
				fireEvent.click(retry);
			});
		}
		await flush(clock);
		expect(requests).toHaveLength(3);
		act(() => requests[2]?.resolve({ one: "new" }));
		await flush(clock);
		expect(container.textContent).toContain("new:expanded");
		expect(container.textContent).not.toContain("Refresh failed.");
		expect(mounts).toBe(1);
	});

	it("contains missing providers, missing items, batch errors, and render errors with retry", async () => {
		let calls = 0;
		let renderAttempts = 0;
		const registration = {
			ownerPluginId: "owner",
			entitySchemaSlug: "item",
			layout: "list" as const,
			definition: defineEntityPresentation({
				loader: ({ references }) => {
					if (references[0]?.entityId === "extra") {
						return Promise.resolve({ unrequested: "extra" });
					}
					calls++;
					if (calls === 1) {
						return Promise.reject(new Error("offline"));
					}
					return Promise.resolve(references[0]?.entityId === "missing" ? {} : { crash: "crash" });
				},
				component: ({ data }) => {
					if (data === "crash") {
						renderAttempts++;
						throw new Error("render failed");
					}
					return <p>{data}</p>;
				},
			}),
		};
		const { clock, container, draw } = render(
			[registration],
			<EntityResults layout="list" references={[reference("batch")]} viewContext={null} />,
		);
		await flush(clock);
		expect(container.textContent).toContain("could not be loaded");
		clickRetry(container);
		await flush(clock);
		draw(<EntityResults layout="list" references={[reference("extra")]} viewContext={null} />);
		await flush(clock);
		expect(container.textContent).toContain("could not be loaded");
		draw(<EntityResults layout="list" references={[reference("missing")]} viewContext={null} />);
		await flush(clock);
		expect(container.textContent).toContain("did not return this entity");
		draw(<EntityResults layout="list" references={[reference("crash")]} viewContext={null} />);
		await flush(clock);
		expect(container.textContent).toContain("could not be displayed");
		const attemptsBeforeRetry = renderAttempts;
		clickRetry(container);
		expect(renderAttempts).toBeGreaterThan(attemptsBeforeRetry);
		expect(container.textContent).toContain("could not be displayed");
		draw(
			<EntityResults
				layout="grid"
				viewContext={null}
				references={[
					reference("fallback", {
						name: "Fallback name",
						ownerPluginId: null,
						populationStatus: "pending",
					}),
				]}
			/>,
		);
		expect(container.textContent).toBe("Fallback nameSyncing...");
		expect(container.querySelector("a")?.getAttribute("href")).toBe("/e/fallback");
	});
});
