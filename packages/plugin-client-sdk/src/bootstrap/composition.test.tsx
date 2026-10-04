import { afterEach, describe, expect, it } from "@effect/vitest";
import { CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID } from "@ryot-app/plugin-client-contract";
import { Effect } from "effect";

import { bootstrapComposition, type CompositionDependencies } from "./composition";

const reference = (specifier: string, binding = "default") => ({ binding, specifier });

const mountDescriptor = (descriptor: unknown, type = "application/json") => {
	const element = document.createElement("script");
	element.type = type;
	element.id = CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID;
	element.textContent = typeof descriptor === "string" ? descriptor : JSON.stringify(descriptor);
	document.head.append(element);
};

const noopDisposable = { dispose: () => undefined };
const Home = () => null;
const About = () => null;
const Missing = () => null;
const presentation = { component: Home, prepare: () => ({}), loader: () => Effect.succeed({}) };

type Recorded = {
	readonly loaded: string[];
	readonly stylesheets: string[];
	readonly pages: { component: unknown; options: unknown }[];
	readonly plugins: { definition: unknown; options: unknown }[];
};

const harness = (
	modules: Record<string, Record<string, unknown>>,
): { readonly dependencies: CompositionDependencies; readonly recorded: Recorded } => {
	const recorded: Recorded = { pages: [], loaded: [], plugins: [], stylesheets: [] };
	return {
		recorded,
		dependencies: {
			loadStylesheet: (href) => {
				recorded.stylesheets.push(href);
				return Promise.resolve();
			},
			bootstrapPage: (component, options) => {
				recorded.pages.push({ options, component });
				return noopDisposable;
			},
			loadModule: (specifier) => {
				recorded.loaded.push(specifier);
				return Promise.resolve(modules[specifier] ?? {});
			},
			bootstrapPlugin: (definition, options) => {
				recorded.plugins.push({ options, definition });
				return noopDisposable;
			},
		},
	};
};

const rejects = (message: string, dependencies: CompositionDependencies) =>
	Effect.promise(() =>
		expect(bootstrapComposition(dependencies)).rejects.toThrow(new Error(message).message),
	);

afterEach(() => {
	document.head.innerHTML = "";
});

describe("composition bootstrap", () => {
	it.effect("rejects a missing descriptor element", () =>
		rejects(
			"Client composition descriptor is missing or has an invalid type",
			harness({}).dependencies,
		),
	);

	it.effect("rejects a descriptor element with the wrong type", () =>
		Effect.gen(function* () {
			mountDescriptor({}, "text/plain");
			yield* rejects(
				"Client composition descriptor is missing or has an invalid type",
				harness({}).dependencies,
			);
		}),
	);

	it.effect("rejects a descriptor that is not JSON", () =>
		Effect.gen(function* () {
			mountDescriptor("{not json");
			yield* rejects("Client composition descriptor is not valid JSON", harness({}).dependencies);
		}),
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
		it.effect(`rejects an invalid shape: ${name}`, () =>
			Effect.gen(function* () {
				mountDescriptor(descriptor);
				const { recorded, dependencies } = harness({});
				yield* rejects("Client composition descriptor has an invalid shape", dependencies);
				expect(recorded.loaded).toEqual([]);
			}),
		);
	}

	it.effect("bootstraps a page with its entry component", () =>
		Effect.gen(function* () {
			mountDescriptor({
				application: "page",
				automaticRegistry: [],
				entry: reference("/page.js", "Home"),
			});
			const { recorded, dependencies } = harness({ "/page.js": { Home } });
			yield* Effect.promise(() => bootstrapComposition(dependencies));
			expect(recorded.pages).toEqual([{ component: Home, options: { entityPresentations: [] } }]);
			expect(recorded.plugins).toEqual([]);
		}),
	);

	it.effect("bootstraps a plugin with routes, loading each specifier once", () =>
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
	);

	it.effect("omits notFound when the descriptor has none", () =>
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
	);

	it.effect("rejects a missing export with its specifier and binding", () =>
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
	);

	it.effect("loads presentations lazily with their stylesheets and shared module loads", () =>
		Effect.gen(function* () {
			mountDescriptor({
				application: "page",
				entry: reference("/page.js", "Home"),
				automaticRegistry: [
					{
						layout: "grid",
						ownerPluginId: "owner",
						entitySchemaSlug: "book",
						stylesheets: ["/a.css", "/b.css"],
						module: reference("/page.js", "bookGrid"),
					},
					{
						layout: "list",
						stylesheets: [],
						ownerPluginId: "owner",
						entitySchemaSlug: "book",
						module: reference("/page.js", "absent"),
					},
				],
			});
			const { recorded, dependencies } = harness({ "/page.js": { Home, bookGrid: presentation } });
			yield* Effect.promise(() => bootstrapComposition(dependencies));
			expect(recorded.stylesheets).toEqual([]);
			const options = recorded.pages[0]?.options;
			const registrations =
				typeof options === "object" && options !== null && "entityPresentations" in options
					? options.entityPresentations
					: undefined;
			expect(registrations).toHaveLength(2);
			if (!Array.isArray(registrations)) {
				return;
			}
			const [grid, list] = registrations;
			expect(grid).toMatchObject({ layout: "grid", ownerPluginId: "owner" });
			yield* Effect.promise(() => expect(grid.load()).resolves.toBe(presentation));
			expect(recorded.stylesheets).toEqual(["/a.css", "/b.css"]);
			expect(recorded.loaded).toEqual(["/page.js"]);
			yield* Effect.promise(() =>
				expect(list.load()).rejects.toThrow(
					"Client composition export is missing: /page.js#absent",
				),
			);
			expect(recorded.loaded).toEqual(["/page.js"]);
		}),
	);
});
