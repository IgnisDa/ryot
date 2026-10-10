import { afterEach, describe, expect, it } from "@effect/vitest";
import { fireEvent } from "@testing-library/dom";
import { Effect, Result } from "effect";
import { act, type ReactNode, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
	defineEntityPresentation,
	EntityPresentationRegistryProvider,
	EntityResults,
	type EntityPresentationRegistration,
	type EntityPresentationSource,
	type EntityReference,
} from "./entity-results";
import type { EntityInterest, EntityUpdate, RyotClientAdapter } from "./index";
import { createPluginNavigationStore } from "./navigation/store";
import { RyotProvider, usePageRefresh } from "./react";
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

const presentationSources = (
	sources: Readonly<Record<string, EntityPresentationSource>>,
): ReadonlyMap<string, EntityPresentationSource> => new Map(Object.entries(sources));

const presentationsFor = (...entityIds: readonly string[]) =>
	presentationSources(
		Object.fromEntries(entityIds.map((entityId) => [entityId, { value: `Source ${entityId}` }])),
	);

const presentationsAt = (references: readonly EntityReference[], revision: number) =>
	presentationSources(
		Object.fromEntries(references.map(({ entityId }) => [entityId, { revision }])),
	);

const presentationRevision = (source: EntityPresentationSource | undefined) =>
	typeof source?.revision === "number" ? source.revision : -1;

const unusedPresentationLoader = () => Effect.die("Unexpected presentation loader");

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
		registerShortcut: () => () => undefined,
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
		entry: { index: 0, key: "home", location: { path: "/", search: "", kind: "route" } },
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
				leading: "none",
				edgeBack: false,
				entry: { key, index, location: { path, search: "", kind: "route" } },
			}),
		);
	return { draw, clock, navigate, container };
};

const flush = (clock: Clock) =>
	Effect.replicateEffect(
		Effect.promise(() => Promise.resolve(clock.advance(0))),
		6,
		{ discard: true },
	);

const clickRetry = (container: HTMLElement) => {
	const button = container.querySelector("button");
	expect(button).not.toBeNull();
	if (button) {
		act(() => {
			fireEvent.click(button);
		});
	}
};

afterEach(() => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	const disposing = clocks;
	clocks = [];
	return Effect.runPromise(
		Effect.andThen(
			Effect.forEach(disposing, (clock) => Effect.promise(() => clock.dispose()), {
				discard: true,
				concurrency: "unbounded",
			}),
			Effect.sync(() => {
				globalThis.IntersectionObserver = originalIntersectionObserver;
				document.body.innerHTML = "";
			}),
		),
	);
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
				disconnected: false,
				targets: this.targets,
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

const gridPage = () => {
	const references = Array.from({ length: 20 }, (_, index) => reference(String(index)));
	return (
		<EntityResults
			layout="grid"
			viewContext={null}
			references={references}
			presentations={presentationsFor(...references.map(({ entityId }) => entityId))}
		/>
	);
};

const gridFor = (
	references: readonly EntityReference[],
	presentations = presentationsFor(...references.map(({ entityId }) => entityId)),
) => (
	<EntityResults
		layout="grid"
		viewContext={null}
		references={references}
		presentations={presentations}
	/>
);

const listFor = (
	references: readonly EntityReference[],
	presentations = presentationsFor(...references.map(({ entityId }) => entityId)),
) => (
	<EntityResults
		layout="list"
		viewContext={null}
		references={references}
		presentations={presentations}
	/>
);

const RefreshableResults = ({
	references,
}: {
	readonly references: readonly EntityReference[];
}) => {
	const [revision, setRevision] = useState(0);
	usePageRefresh(() => Effect.sync(() => setRevision((current) => current + 1)));
	return gridFor(references, presentationsAt(references, revision));
};

describe("EntityResults", () => {
	it.live("loads and caches one lazy definition per provider", () =>
		Effect.gen(function* () {
			let definitionLoad:
				| PromiseWithResolvers<ReturnType<typeof defineEntityPresentation<string>>>
				| undefined;
			let definitionLoads = 0;
			let preparations = 0;
			let mounts = 0;
			const definition = defineEntityPresentation<string>({
				loader: unusedPresentationLoader,
				component: function Presentation({ data }) {
					useState(() => {
						mounts++;
					});
					return <p>{data}</p>;
				},
				prepare: ({ sources, references }) => {
					preparations++;
					expect([...sources.keys()]).toEqual(references.map(({ entityId }) => entityId));
					return Result.succeed(
						Object.fromEntries(references.map(({ entityId }) => [entityId, entityId])),
					);
				},
			});
			const registration: EntityPresentationRegistration = {
				layout: "grid",
				ownerPluginId: "owner",
				entitySchemaSlug: "item",
				load: () => {
					definitionLoads++;
					definitionLoad =
						Promise.withResolvers<ReturnType<typeof defineEntityPresentation<string>>>();
					return definitionLoad.promise;
				},
			};
			const { draw, clock, container } = render([registration], gridPage());
			yield* flush(clock);
			expect(definitionLoads).toBe(1);
			expect(preparations).toBe(0);
			expect(container.querySelectorAll('[role="status"]')).toHaveLength(20);
			act(() => definitionLoad?.resolve(definition));
			yield* flush(clock);
			expect({ mounts, preparations, definitionLoads }).toEqual({
				mounts: 20,
				preparations: 1,
				definitionLoads: 1,
			});
			draw(null);
			draw(gridPage());
			yield* flush(clock);
			expect(definitionLoads).toBe(1);
			expect(preparations).toBe(2);
			expect(mounts).toBe(40);
			act(() => roots[0]?.unmount());
			roots = [];
			const fresh = render([registration], gridPage());
			yield* flush(fresh.clock);
			expect(definitionLoads).toBe(2);
		}),
	);

	it.live("uses a stable linked fallback after a definition load failure", () =>
		Effect.gen(function* () {
			let attempts = 0;
			const registration: EntityPresentationRegistration = {
				layout: "list",
				ownerPluginId: "owner",
				entitySchemaSlug: "item",
				load: () => {
					attempts++;
					return Promise.reject(new Error("offline"));
				},
			};
			const item = listFor([reference("one")]);
			const { draw, clock, container } = render([registration], item);
			yield* flush(clock);
			expect(container.textContent).toContain("This presentation is unavailable.");
			expect(container.querySelector('a[href="/e/one"]')).not.toBeNull();
			expect(container.querySelector("button")).toBeNull();
			draw(null);
			draw(item);
			yield* flush(clock);
			expect(attempts).toBe(1);
		}),
	);

	it.live("loads presentation data when embedded sources are unavailable", () =>
		Effect.gen(function* () {
			let loads = 0;
			const registration: EntityPresentationRegistration = {
				layout: "grid",
				ownerPluginId: "owner",
				entitySchemaSlug: "item",
				load: () =>
					Promise.resolve(
						defineEntityPresentation<string>({
							component: ({ data }) => <p>{data}</p>,
							prepare: () => Result.fail(new Error("Embedded source was not expected")),
							loader: ({ references }) => {
								loads++;
								return Effect.succeed(
									Object.fromEntries(
										references.map(({ entityId }) => [entityId, `Loaded ${entityId}`]),
									),
								);
							},
						}),
					),
			};
			const { clock, container } = render(
				[registration],
				<EntityResults
					layout="grid"
					viewContext={null}
					presentations={new Map()}
					references={[reference("one")]}
				/>,
			);
			yield* flush(clock);
			expect(loads).toBe(1);
			expect(container.textContent).toBe("Loaded one");
		}),
	);

	it.live("uses the exact owner, schema, and layout while preserving visible order", () =>
		Effect.gen(function* () {
			const loads: string[] = [];
			const requests: Array<{
				readonly sourceIds: readonly string[];
				readonly ids: readonly string[];
			}> = [];
			const presentation = (label: string) =>
				defineEntityPresentation<string>({
					loader: unusedPresentationLoader,
					component: ({ data, reference: entityReference }) => (
						<p>{`${label}:${entityReference.entityId}:${data}`}</p>
					),
					prepare: ({ sources, references }) => {
						requests.push({
							sourceIds: [...sources.keys()],
							ids: references.map(({ entityId }) => entityId),
						});
						return Result.succeed({ a: "first", b: "second" });
					},
				});
			const registration = (
				label: string,
				ownerPluginId: string,
				entitySchemaSlug: string,
				layout: "grid" | "list",
			) => ({
				layout,
				ownerPluginId,
				entitySchemaSlug,
				load: () => {
					loads.push(label);
					return Promise.resolve(presentation(label));
				},
			});
			const registrations = [
				registration("wrong-owner", "other", "item", "grid"),
				registration("wrong-schema", "owner", "other", "grid"),
				registration("wrong-layout", "owner", "item", "list"),
				registration("exact", "owner", "item", "grid"),
			];
			const references = [reference("b"), reference("a")];
			const { clock, container } = render(
				registrations,
				<EntityResults
					layout="grid"
					references={references}
					viewContext={{ savedViewId: "view" }}
					presentations={presentationsFor("a", "b")}
				/>,
			);
			yield* flush(clock);
			expect(loads).toEqual(["exact"]);
			expect(requests).toEqual([{ ids: ["a", "b"], sourceIds: ["a", "b"] }]);
			expect(container.textContent).toBe("exact:b:secondexact:a:first");
		}),
	);

	it.live("prepares sorted chunks of at most 100 entities", () =>
		Effect.gen(function* () {
			const requests: Array<{
				readonly sourceIds: readonly string[];
				readonly ids: readonly string[];
			}> = [];
			const registration = {
				ownerPluginId: "owner",
				layout: "grid" as const,
				entitySchemaSlug: "item",
				load: () =>
					Promise.resolve(
						defineEntityPresentation<string>({
							loader: unusedPresentationLoader,
							component: ({ data }) => <p>{data}</p>,
							prepare: ({ sources, references }) => {
								const ids = references.map(({ entityId }) => entityId);
								requests.push({ ids, sourceIds: [...sources.keys()] });
								return Result.succeed(Object.fromEntries(ids.map((id) => [id, id])));
							},
						}),
					),
			};
			const references = Array.from({ length: 201 }, (_, index) =>
				reference(String(200 - index).padStart(3, "0")),
			);
			const { clock } = render([registration], gridFor(references));
			yield* flush(clock);
			expect(requests.map(({ ids }) => ids.length)).toEqual([100, 100, 1]);
			expect(requests.every(({ ids }) => ids.length <= 100)).toBe(true);
			for (const { ids, sourceIds } of requests) {
				expect(ids).toEqual(sourceIds);
			}
			expect(requests.flatMap(({ ids }) => ids)).toEqual(
				references.map(({ entityId }) => entityId).sort(),
			);
		}),
	);

	it.live("contains failed, thrown, malformed, and missing preparation results", () =>
		Effect.gen(function* () {
			const registration = {
				ownerPluginId: "owner",
				layout: "list" as const,
				entitySchemaSlug: "item",
				load: () =>
					Promise.resolve(
						defineEntityPresentation<string>({
							loader: unusedPresentationLoader,
							component: ({ data }) => <p>{data}</p>,
							prepare: ({ references }) => {
								const entityId = references[0]?.entityId ?? "";
								if (entityId === "failed") {
									return Result.fail(new Error("invalid source"));
								}
								if (entityId === "thrown") {
									throw new Error("invalid source");
								}
								if (entityId === "extra") {
									return Result.succeed({ extra: "valid", unrequested: "invalid" });
								}
								return Result.succeed(entityId === "missing" ? {} : { [entityId]: "ready" });
							},
						}),
					),
			};
			const { draw, clock, container } = render([registration], listFor([reference("failed")]));
			yield* flush(clock);
			for (const entityId of ["failed", "thrown", "extra", "missing"]) {
				draw(listFor([reference(entityId)]));
				expect(container.textContent).toContain("This entity could not be loaded.");
				expect(container.querySelector("button")).toBeNull();
				expect(container.querySelector("a")?.getAttribute("href")).toBe(`/e/${entityId}`);
			}
			draw(listFor([reference("valid")]));
			expect(container.textContent).toBe("ready");
		}),
	);

	it.live("contains component errors and retries the error boundary", () =>
		Effect.gen(function* () {
			let renderAttempts = 0;
			const registration = {
				ownerPluginId: "owner",
				layout: "list" as const,
				entitySchemaSlug: "item",
				load: () =>
					Promise.resolve(
						defineEntityPresentation<string>({
							loader: unusedPresentationLoader,
							prepare: () => Result.succeed({ crash: "crash" }),
							component: () => {
								renderAttempts++;
								throw new Error("render failed");
							},
						}),
					),
			};
			const { clock, container } = render([registration], listFor([reference("crash")]));
			yield* flush(clock);
			expect(container.textContent).toContain("This entity could not be displayed.");
			const attemptsBeforeRetry = renderAttempts;
			clickRetry(container);
			expect(renderAttempts).toBeGreaterThan(attemptsBeforeRetry);
			expect(container.textContent).toContain("This entity could not be displayed.");
		}),
	);

	it.live("tracks visible entities and requests a page refresh for entity updates", () =>
		Effect.gen(function* () {
			const observers = installIntersectionObserver();
			const interests: EntityInterest[] = [];
			let completion: ((update: EntityUpdate) => void) | undefined;
			let disposals = 0;
			let preparations = 0;
			const registration = {
				ownerPluginId: "owner",
				layout: "grid" as const,
				entitySchemaSlug: "item",
				load: () =>
					Promise.resolve(
						defineEntityPresentation<string>({
							loader: unusedPresentationLoader,
							component: ({ data }) => <p>{data}</p>,
							prepare: ({ sources, references }) => {
								preparations++;
								return Result.succeed(
									Object.fromEntries(
										references.map(({ entityId }) => [
											entityId,
											`${entityId}:${presentationRevision(sources.get(entityId))}`,
										]),
									),
								);
							},
						}),
					),
			};
			const references = [reference("one"), reference("two")];
			const { draw, clock, navigate, container } = render(
				[registration],
				<RefreshableResults references={references} />,
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
			yield* flush(clock);
			expect(observers).toHaveLength(1);
			const observer = observers[0];
			expect(observer?.root).toBe(
				container.firstElementChild?.firstElementChild?.firstElementChild,
			);
			expect(observer?.targets.size).toBe(2);
			expect(interests.at(-1)).toEqual({ visible: [], foreground: [] });
			expect(preparations).toBe(1);
			const [one, two] = [...(observer?.targets ?? [])];
			if (one && two && observer) {
				act(() => observer.emit(one, true));
				yield* flush(clock);
				expect(interests.at(-1)).toEqual({ foreground: [], visible: ["one"] });
				act(() => completion?.({ entityId: "one", reason: "populated" }));
				yield* Effect.promise(() => clock.advance(499));
				expect(preparations).toBe(1);
				yield* Effect.promise(() => clock.advance(1));
				expect(preparations).toBe(2);
				expect(container.textContent).toContain("one:1");
				act(() => observer.emit(two, false));
				yield* flush(clock);
				expect(interests.at(-1)).toEqual({ foreground: [], visible: ["one"] });
				draw(<RefreshableResults references={[reference("two")]} />);
				yield* flush(clock);
				expect(interests.at(-1)).toEqual({ visible: [], foreground: [] });
				const remaining = [...observer.targets][0];
				if (remaining) {
					act(() => observer.emit(remaining, true));
					yield* flush(clock);
					expect(interests.at(-1)).toEqual({ foreground: [], visible: ["two"] });
				}
				yield* Effect.promise(() => navigate("/inactive", 1, "inactive"));
				yield* flush(clock);
				expect(observer.disconnected).toBe(true);
				yield* Effect.promise(() => navigate("/", 0, "home"));
				yield* flush(clock);
				expect(observers).toHaveLength(2);
				expect(interests.at(-1)).toEqual({ visible: [], foreground: [] });
			}
			act(() => roots[0]?.unmount());
			roots = [];
			expect(observers.every(({ disconnected }) => disconnected)).toBe(true);
			expect(disposals).toBeGreaterThan(0);
		}),
	);

	it.live("re-prepares on page refresh without remounting presentations", () =>
		Effect.gen(function* () {
			const revisions: number[] = [];
			let mounts = 0;
			const Presentation = ({ data }: { readonly data: number }) => {
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
				load: () =>
					Promise.resolve(
						defineEntityPresentation<number>({
							component: Presentation,
							loader: unusedPresentationLoader,
							prepare: ({ sources }) => {
								const revision = presentationRevision(sources.get("one"));
								revisions.push(revision);
								return Result.succeed({ one: revision });
							},
						}),
					),
			};
			const references = [reference("one")];
			const ResultsPage = () => {
				const [revision, setRevision] = useState(0);
				usePageRefresh(() => Effect.sync(() => setRevision((current) => current + 1)));
				return gridFor(references, presentationsAt(references, revision));
			};
			const { clock, container } = render([registration], <ResultsPage />);
			yield* flush(clock);
			const expand = container.querySelector("button");
			expect(expand?.textContent).toBe("Expand");
			if (expand) {
				act(() => {
					fireEvent.click(expand);
				});
			}
			expect(container.textContent).toContain("0:expanded");
			act(() => clock.client.mutationCompleted.hint());
			yield* Effect.promise(() => clock.advance(249));
			expect(revisions).toEqual([0]);
			yield* Effect.promise(() => clock.advance(1));
			expect(revisions).toEqual([0, 1]);
			expect(container.textContent).toContain("1:expanded");
			expect(mounts).toBe(1);
		}),
	);

	it.live("renders the generic fallback without an owned presentation", () =>
		Effect.gen(function* () {
			const fallback = reference("fallback", {
				ownerPluginId: null,
				name: "Fallback name",
				populationStatus: "pending",
			});
			const { clock, container } = render([], gridFor([fallback]));
			yield* flush(clock);
			expect(container.textContent).toContain("item");
			expect(container.textContent).toContain("Fallback name");
			expect(container.querySelector(".animate-sync-pulse")).not.toBeNull();
			expect(container.querySelector("a")?.getAttribute("href")).toBe("/e/fallback");
		}),
	);
});
