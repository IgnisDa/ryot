import { afterEach, describe, expect } from "bun:test";

import { CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID } from "@ryot-app/plugin-client-contract";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Result } from "effect";
import { forwardRef, memo } from "react";

import { defineEntityPresentation } from "../presentations/entity-results";
import { bootstrapComposition, type CompositionDependencies } from "./composition";

const reference = (specifier: string, binding = "default") => ({ binding, specifier });

const mountDescriptor = (descriptor: unknown, type = "application/json") => {
	const element = document.createElement("script");
	element.type = type;
	element.id = CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID;
	element.textContent =
		typeof descriptor === "string"
			? descriptor
			: JSON.stringify(
					typeof descriptor === "object" &&
						descriptor !== null &&
						"application" in descriptor &&
						descriptor.application === "page"
						? { analyticsSections: [], ...descriptor }
						: descriptor,
				);
	document.head.append(element);
};

const noopDisposable = { dispose: () => undefined };
const Home = () => null;
const About = () => null;
const Missing = () => null;
const presentation = defineEntityPresentation<string>({
	component: ({ data }) => <p>{data}</p>,
	loader: ({ references }) =>
		Effect.succeed(Object.fromEntries(references.map(({ entityId }) => [entityId, entityId]))),
	prepare: ({ references }) =>
		Result.succeed(Object.fromEntries(references.map(({ entityId }) => [entityId, entityId]))),
});

type Recorded = {
	readonly loaded: string[];
	readonly stylesheets: string[];
	readonly plugins: { options: unknown; definition: unknown }[];
	readonly pages: {
		component: unknown;
		options: Parameters<CompositionDependencies["bootstrapPage"]>[1];
	}[];
};

const harness = (
	modules: Record<string, Record<string, unknown>>,
	failures: { readonly modules?: readonly string[]; readonly stylesheets?: readonly string[] } = {},
): { readonly recorded: Recorded; readonly dependencies: CompositionDependencies } => {
	const recorded: Recorded = { pages: [], loaded: [], plugins: [], stylesheets: [] };
	return {
		recorded,
		dependencies: {
			bootstrapPage: (component, options) => {
				recorded.pages.push({ options, component });
				return noopDisposable;
			},
			bootstrapPlugin: (definition, options) => {
				recorded.plugins.push({ options, definition });
				return noopDisposable;
			},
			loadStylesheet: (href) => {
				recorded.stylesheets.push(href);
				return failures.stylesheets?.includes(href)
					? Promise.reject(new Error(`Stylesheet failed: ${href}`))
					: Promise.resolve();
			},
			loadModule: (specifier) => {
				recorded.loaded.push(specifier);
				return failures.modules?.includes(specifier)
					? Promise.reject(new Error(`Module failed: ${specifier}`))
					: Promise.resolve(modules[specifier] ?? {});
			},
		},
	};
};

const rejects = (message: string, dependencies: CompositionDependencies) =>
	Effect.map(
		Effect.tryPromise(() => bootstrapComposition(dependencies)).pipe(Effect.flip),
		({ cause: error }) => {
			assert(error instanceof Error);
			expect(error.message).toContain(new Error(message).message);
		},
	);

afterEach(() => {
	document.head.innerHTML = "";
});

describe("composition bootstrap", () => {
	it.effect(
		"loads analytics code and styles on demand and retries failed imports independently",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					application: "page",
					automaticRegistry: [],
					entry: reference("/page.js", "Home"),
					analyticsSections: [
						{
							icon: "box",
							slug: "activity",
							name: "Activity",
							ownerPluginId: "private-owner",
							module: reference("/section.js", "activity"),
							stylesheets: ["/dependency.css", "/section.css"],
						},
						{
							icon: "box",
							module: null,
							stylesheets: [],
							slug: "unavailable",
							name: "Unavailable",
							ownerPluginId: "missing-owner",
						},
					],
				});
				const failures = ["/section.js"];
				const { recorded, dependencies } = harness(
					{ "/page.js": { Home }, "/section.js": { activity: About } },
					{ modules: failures },
				);
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.loaded).toEqual(["/page.js"]);
				expect(recorded.stylesheets).toEqual([]);
				const registrations = recorded.pages[0]?.options?.analyticsSections;
				const section = registrations?.[0];
				assert(section?.load);
				const load = section.load;
				expect(section.ownerPluginId).toBe<unknown>("private-owner");
				expect(registrations?.[1]?.load).toBeNull();
				yield* Effect.map(Effect.tryPromise(() => load()).pipe(Effect.flip), ({ cause: error }) => {
					assert(error instanceof Error);
					expect(error.message).toContain("Module failed: /section.js");
				});
				failures.splice(0);
				yield* Effect.map(
					Effect.promise(() => load()),
					(value) => expect(value).toBe(About),
				);
				expect(recorded.loaded).toEqual(["/page.js", "/section.js", "/section.js"]);
				expect(recorded.stylesheets).toEqual([
					"/dependency.css",
					"/section.css",
					"/dependency.css",
					"/section.css",
				]);
			}),
		testTimeout,
	);
	it.effect(
		"rejects a missing descriptor element",
		() =>
			rejects(
				"Client composition descriptor is missing or has an invalid type",
				harness({}).dependencies,
			),
		testTimeout,
	);

	it.effect(
		"rejects a descriptor element with the wrong type",
		() =>
			Effect.gen(function* () {
				mountDescriptor({}, "text/plain");
				yield* rejects(
					"Client composition descriptor is missing or has an invalid type",
					harness({}).dependencies,
				);
			}),
		testTimeout,
	);

	it.effect(
		"rejects a descriptor that is not JSON",
		() =>
			Effect.gen(function* () {
				mountDescriptor("{not json");
				yield* rejects("Client composition descriptor is not valid JSON", harness({}).dependencies);
			}),
		testTimeout,
	);

	const invalidShapes: readonly (readonly [string, unknown])[] = [
		["unknown application", { application: "other", automaticRegistry: [] }],
		["page without entry", { application: "page", automaticRegistry: [] }],
		[
			"page with routes",
			{
				application: "page",
				automaticRegistry: [],
				entry: reference("/a.js"),
				routes: { routes: [], home: reference("/a.js") },
			},
		],
		["plugin-route without routes", { automaticRegistry: [], application: "plugin-route" }],
		[
			"plugin-route with entry",
			{
				automaticRegistry: [],
				entry: reference("/a.js"),
				application: "plugin-route",
				routes: { routes: [], home: reference("/a.js") },
			},
		],
		["empty specifier", { application: "page", entry: reference(""), automaticRegistry: [] }],
		[
			"empty binding",
			{ application: "page", automaticRegistry: [], entry: reference("/a.js", "") },
		],
	];
	for (const [name, descriptor] of invalidShapes) {
		it.effect(
			`rejects an invalid shape: ${name}`,
			() =>
				Effect.gen(function* () {
					mountDescriptor(descriptor);
					const { recorded, dependencies } = harness({});
					yield* rejects("Client composition descriptor has an invalid shape", dependencies);
					expect(recorded.loaded).toEqual([]);
				}),
			testTimeout,
		);
	}

	it.effect(
		"bootstraps a page with its entry component",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					application: "page",
					automaticRegistry: [],
					entry: reference("/page.js", "Home"),
				});
				const { recorded, dependencies } = harness({ "/page.js": { Home } });
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.pages).toEqual([
					{ component: Home, options: { analyticsSections: [], entityPresentations: [] } },
				]);
				expect(recorded.plugins).toEqual([]);
			}),
		testTimeout,
	);

	it.effect(
		"bootstraps a plugin with routes, loading each specifier once",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					automaticRegistry: [],
					application: "plugin-route",
					routes: {
						home: reference("/routes.js", "Home"),
						notFound: reference("/routes.js", "Missing"),
						routes: [{ path: "/about", module: reference("/routes.js", "About") }],
					},
				});
				const { recorded, dependencies } = harness({ "/routes.js": { Home, About, Missing } });
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.loaded).toEqual(["/routes.js"]);
				expect(recorded.pages).toEqual([]);
				expect(recorded.plugins).toEqual([
					{
						options: { entityPresentations: [] },
						definition: {
							notFound: Missing,
							home: { component: Home },
							routes: [{ path: "/about", component: About }],
						},
					},
				]);
			}),
		testTimeout,
	);

	it.effect(
		"omits notFound when the descriptor has none",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					automaticRegistry: [],
					application: "plugin-route",
					routes: { routes: [], home: reference("/routes.js", "Home") },
				});
				const { recorded, dependencies } = harness({ "/routes.js": { Home } });
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.plugins[0]?.definition).toEqual({ routes: [], home: { component: Home } });
			}),
		testTimeout,
	);

	it.effect(
		"bootstraps explicit routes without a home component",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					automaticRegistry: [],
					application: "plugin-route",
					routes: { routes: [{ path: "/items/new", module: reference("/routes.js", "About") }] },
				});
				const { recorded, dependencies } = harness({ "/routes.js": { About } });
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.plugins[0]?.definition).toEqual({
					routes: [{ component: About, path: "/items/new" }],
				});
			}),
		testTimeout,
	);

	it.effect(
		"rejects a missing export with its specifier and binding",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					application: "page",
					automaticRegistry: [],
					entry: reference("/page.js", "Home"),
				});
				const { recorded, dependencies } = harness({ "/page.js": {} });
				yield* rejects("Client composition export is missing: /page.js#Home", dependencies);
				expect(recorded.pages).toEqual([]);
			}),
		testTimeout,
	);

	it.effect(
		"accepts memo and forwardRef components",
		() =>
			Effect.gen(function* () {
				const MemoHome = memo(Home);
				const ForwardedAbout = forwardRef(About);
				mountDescriptor({
					automaticRegistry: [],
					application: "plugin-route",
					routes: {
						home: reference("/routes.js", "MemoHome"),
						routes: [{ path: "/about", module: reference("/routes.js", "ForwardedAbout") }],
					},
				});
				const { recorded, dependencies } = harness({ "/routes.js": { MemoHome, ForwardedAbout } });
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.plugins[0]?.definition).toEqual({
					home: { component: MemoHome },
					routes: [{ path: "/about", component: ForwardedAbout }],
				});
			}),
		testTimeout,
	);

	for (const [name, value] of [
		["plain object", {}],
		["array", []],
		["null", null],
	] as const) {
		it.effect(
			`rejects a present but invalid component export: ${name}`,
			() =>
				Effect.gen(function* () {
					mountDescriptor({
						application: "page",
						automaticRegistry: [],
						entry: reference("/page.js", "Home"),
					});
					const { recorded, dependencies } = harness({ "/page.js": { Home: value } });
					yield* rejects("Client composition export is invalid: /page.js#Home", dependencies);
					expect(recorded.pages).toEqual([]);
				}),
			testTimeout,
		);
	}

	it.effect(
		"rejects when a route module fails to load",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					application: "page",
					automaticRegistry: [],
					entry: reference("/page.js", "Home"),
				});
				const { recorded, dependencies } = harness({}, { modules: ["/page.js"] });
				yield* rejects("Module failed: /page.js", dependencies);
				expect(recorded.pages).toEqual([]);
			}),
		testTimeout,
	);

	it.effect(
		"loads presentations lazily with their stylesheets and shared module loads",
		() =>
			Effect.gen(function* () {
				mountDescriptor({
					application: "page",
					entry: reference("/page.js", "Home"),
					automaticRegistry: [
						{
							layout: "grid",
							ownerPluginId: "owner",
							entitySchemaSlug: "item",
							stylesheets: ["/a.css", "/b.css"],
							module: reference("/page.js", "itemGrid"),
						},
						{
							layout: "list",
							stylesheets: [],
							ownerPluginId: "owner",
							entitySchemaSlug: "item",
							module: reference("/page.js", "absent"),
						},
					],
				});
				const { recorded, dependencies } = harness({
					"/page.js": { Home, itemGrid: presentation },
				});
				yield* Effect.promise(() => bootstrapComposition(dependencies));
				expect(recorded.stylesheets).toEqual([]);
				const options = recorded.pages[0]?.options;
				const registrations = options?.entityPresentations;
				expect(registrations).toHaveLength(2);
				const [grid, list] = registrations ?? [];
				assert(grid && list);
				expect(grid).toMatchObject({ layout: "grid", ownerPluginId: "owner" });
				yield* Effect.map(
					Effect.promise(() => grid.load()),
					(value) => expect(value).toBe(presentation),
				);
				expect(recorded.stylesheets).toEqual(["/a.css", "/b.css"]);
				expect(recorded.loaded).toEqual(["/page.js"]);
				yield* Effect.map(
					Effect.tryPromise(() => list.load()).pipe(Effect.flip),
					({ cause: error }) => {
						assert(error instanceof Error);
						expect(error.message).toContain(
							"Client composition export is missing: /page.js#absent",
						);
					},
				);
				expect(recorded.loaded).toEqual(["/page.js"]);
			}),
		testTimeout,
	);
});

const registrationsFor = (
	modules: Record<string, Record<string, unknown>>,
	failures?: Parameters<typeof harness>[1],
) =>
	Effect.gen(function* () {
		mountDescriptor({
			application: "page",
			entry: reference("/page.js", "Home"),
			automaticRegistry: [
				{
					layout: "grid",
					ownerPluginId: "owner",
					entitySchemaSlug: "item",
					stylesheets: ["/grid.css"],
					module: reference("/presentation.js", "itemGrid"),
				},
			],
		});
		const { recorded, dependencies } = harness({ "/page.js": { Home }, ...modules }, failures);
		yield* Effect.promise(() => bootstrapComposition(dependencies));
		const [page] = recorded.pages;
		const options = page?.options;
		const registrations = options?.entityPresentations;
		const [registration] = registrations ?? [];
		if (registration === undefined || registrations?.length !== 1) {
			throw new Error("Expected one presentation registration");
		}
		return { recorded, load: () => registration.load() };
	});

describe("composition bootstrap presentations", () => {
	it.effect(
		"accepts a memo presentation component",
		() =>
			Effect.gen(function* () {
				const definition = { ...presentation, component: memo(presentation.component) };
				const { load } = yield* registrationsFor({ "/presentation.js": { itemGrid: definition } });
				yield* Effect.map(
					Effect.promise(() => load()),
					(value) => expect(value).toBe(definition),
				);
			}),
		testTimeout,
	);

	for (const [name, value] of [
		["non-callable loader", { ...presentation, loader: {} }],
		["non-callable prepare", { ...presentation, prepare: "prepare" }],
		["plain object component", { ...presentation, component: {} }],
		["missing component", { loader: presentation.loader, prepare: presentation.prepare }],
	] as const) {
		it.effect(
			`rejects a present but invalid presentation export: ${name}`,
			() =>
				Effect.gen(function* () {
					const { load } = yield* registrationsFor({ "/presentation.js": { itemGrid: value } });
					yield* Effect.map(
						Effect.tryPromise(() => load()).pipe(Effect.flip),
						({ cause: error }) => {
							assert(error instanceof Error);
							expect(error.message).toContain(
								"Client composition export is invalid: /presentation.js#itemGrid",
							);
						},
					);
				}),
			testTimeout,
		);
	}

	it.effect(
		"rejects a presentation whose stylesheet fails to load",
		() =>
			Effect.gen(function* () {
				const { load, recorded } = yield* registrationsFor(
					{ "/presentation.js": { itemGrid: presentation } },
					{ stylesheets: ["/grid.css"] },
				);
				yield* Effect.map(Effect.tryPromise(() => load()).pipe(Effect.flip), ({ cause: error }) => {
					assert(error instanceof Error);
					expect(error.message).toContain("Stylesheet failed: /grid.css");
				});
				expect(recorded.loaded).not.toContain("/presentation.js");
			}),
		testTimeout,
	);

	it.effect(
		"rejects a presentation whose module fails to load",
		() =>
			Effect.gen(function* () {
				const { load } = yield* registrationsFor({}, { modules: ["/presentation.js"] });
				yield* Effect.map(Effect.tryPromise(() => load()).pipe(Effect.flip), ({ cause: error }) => {
					assert(error instanceof Error);
					expect(error.message).toContain("Module failed: /presentation.js");
				});
			}),
		testTimeout,
	);
});
