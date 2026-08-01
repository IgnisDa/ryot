import { fireEvent } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
	defineEntityPresentation,
	EntityPresentationRegistryProvider,
	EntityResults,
	type EntityPresentationRegistration,
	type EntityReference,
} from "./entity-results";
import { RyotProvider } from "./react";
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

const render = (registrations: readonly EntityPresentationRegistration[], children: ReactNode) => {
	const clock = createTestRyotClock({
		navigate: () => undefined,
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
	});
	clocks.push(clock);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	const draw = (next: ReactNode) =>
		act(() =>
			root.render(
				<RyotProvider runtime={clock.runtime}>
					<EntityPresentationRegistryProvider registrations={registrations}>
						{next}
					</EntityPresentationRegistryProvider>
				</RyotProvider>,
			),
		);
	draw(children);
	return { clock, container, draw };
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
	document.body.innerHTML = "";
});

describe("EntityResults", () => {
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
