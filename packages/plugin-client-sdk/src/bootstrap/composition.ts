import {
	ClientCompositionDocument,
	type ClientCompositionModuleReference,
} from "@ryot-app/contract/modules/pages/schemas";
import { CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID } from "@ryot-app/plugin-client-contract";
import { Effect, Schema } from "effect";

import { isComponentType } from "../component-type";
import { isEntityPresentationDefinition } from "../presentations/entity-results";
import { loadStylesheet } from "../stylesheets";
import { bootstrapClientPage, bootstrapClientPlugin } from "./application";

type ClientModule = Readonly<Record<string, unknown>>;

export type CompositionDependencies = {
	readonly bootstrapPage: typeof bootstrapClientPage;
	readonly bootstrapPlugin: typeof bootstrapClientPlugin;
	readonly loadModule: (specifier: string) => Promise<ClientModule>;
	readonly loadStylesheet: (href: string) => Promise<void>;
};

const defaultDependencies: CompositionDependencies = {
	loadStylesheet,
	bootstrapPage: bootstrapClientPage,
	bootstrapPlugin: bootstrapClientPlugin,
	loadModule: (specifier) => import(/* @vite-ignore */ specifier),
};

const decodeDescriptor = Schema.decodeUnknownSync(ClientCompositionDocument.fields.descriptor);

const readDescriptor = () => {
	const element = document.getElementById(CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID);
	if (!(element instanceof HTMLScriptElement) || element.type !== "application/json") {
		throw new Error("Client composition descriptor is missing or has an invalid type");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(element.textContent);
	} catch {
		throw new Error("Client composition descriptor is not valid JSON");
	}
	try {
		return decodeDescriptor(parsed);
	} catch {
		throw new Error("Client composition descriptor has an invalid shape");
	}
};

const exported = <Value>(
	module: ClientModule | undefined,
	{ binding, specifier }: ClientCompositionModuleReference,
	isValue: (value: unknown) => value is Value,
): Value => {
	if (module === undefined || !Object.hasOwn(module, binding)) {
		throw new Error(`Client composition export is missing: ${specifier}#${binding}`);
	}
	const value = module[binding];
	if (!isValue(value)) {
		throw new Error(`Client composition export is invalid: ${specifier}#${binding}`);
	}
	return value;
};

const loadPresentation = (
	registration: ClientCompositionDocument["descriptor"]["automaticRegistry"][number],
	load: (specifier: string) => Promise<ClientModule>,
	dependencies: CompositionDependencies,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* Effect.promise(() =>
				Promise.all(registration.stylesheets.map(dependencies.loadStylesheet)),
			);
			const module = yield* Effect.promise(() => load(registration.module.specifier));
			return exported(module, registration.module, isEntityPresentationDefinition);
		}),
	);

export const bootstrapComposition = (
	dependencies: CompositionDependencies = defaultDependencies,
): Promise<void> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const descriptor = readDescriptor();
			const modulePromisesBySpecifier = new Map<string, Promise<ClientModule>>();
			const load = (specifier: string) => {
				const cached = modulePromisesBySpecifier.get(specifier);
				if (cached) {
					return cached;
				}
				const loading = dependencies.loadModule(specifier);
				modulePromisesBySpecifier.set(specifier, loading);
				return loading;
			};
			const moduleReferences =
				descriptor.application === "page"
					? [descriptor.entry]
					: [
							descriptor.routes.home,
							...descriptor.routes.routes.map((route) => route.module),
							...(descriptor.routes.notFound === undefined ? [] : [descriptor.routes.notFound]),
						];
			const modules = new Map(
				yield* Effect.forEach(
					new Set(moduleReferences.map(({ specifier }) => specifier)),
					(specifier) =>
						Effect.promise(() => load(specifier)).pipe(
							Effect.map((module) => [specifier, module] as const),
						),
					{ concurrency: "unbounded" },
				),
			);
			const component = (reference: ClientCompositionModuleReference) =>
				exported(modules.get(reference.specifier), reference, isComponentType);
			const entityPresentations = descriptor.automaticRegistry.map((registration) => ({
				layout: registration.layout,
				ownerPluginId: registration.ownerPluginId,
				entitySchemaSlug: registration.entitySchemaSlug,
				load: () => loadPresentation(registration, load, dependencies),
			}));

			if (descriptor.application === "page") {
				dependencies.bootstrapPage(component(descriptor.entry), { entityPresentations });
				return;
			}
			const { home, routes, notFound } = descriptor.routes;
			dependencies.bootstrapPlugin(
				{
					home: { component: component(home) },
					routes: routes.map((route) => ({ path: route.path, component: component(route.module) })),
					...(notFound === undefined ? {} : { notFound: component(notFound) }),
				},
				{ entityPresentations },
			);
		}),
	);
