import {
	ClientCompositionDocument,
	type ClientCompositionModuleReference,
} from "@ryot-app/contract/modules/pages/schemas";
import { CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID } from "@ryot-app/plugin-client-contract";
import { Effect, Result, Schema } from "effect";
import type { ComponentType } from "react";

import type { AnalyticsSectionProps } from "../analytics/sections";
import { isComponentType } from "../component-type";
import { isEntityPresentationDefinition } from "../presentations/entity-results";
import { loadStylesheet } from "../stylesheets";
import { bootstrapClientPage, bootstrapClientPlugin } from "./application";

export type CompositionDependencies = {
	readonly bootstrapPage: typeof bootstrapClientPage;
	readonly bootstrapPlugin: typeof bootstrapClientPlugin;
	readonly loadStylesheet: (href: string) => Promise<void>;
	readonly loadModule: (specifier: string) => Promise<ClientModule>;
};

type ClientModule = Readonly<Record<string, unknown>>;

const defaultDependencies: CompositionDependencies = {
	loadStylesheet,
	bootstrapPage: bootstrapClientPage,
	bootstrapPlugin: bootstrapClientPlugin,
	loadModule: (specifier) => import(/* @vite-ignore */ specifier),
};

const decodeDescriptor = Schema.decodeUnknownResult(ClientCompositionDocument.fields.descriptor);

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
	const descriptor = decodeDescriptor(parsed);
	if (Result.isFailure(descriptor)) {
		throw new Error("Client composition descriptor has an invalid shape");
	}
	return descriptor.success;
};

const exported = <Value>(
	module: undefined | ClientModule,
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

const loadAnalyticsSection = (
	registration: ClientCompositionDocument["descriptor"]["analyticsSections"][number],
	load: (specifier: string) => Promise<ClientModule>,
	dependencies: CompositionDependencies,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const reference = registration.module;
			if (reference === null) {
				throw new Error("Analytics section unavailable");
			}
			yield* Effect.promise(() =>
				Promise.all(registration.stylesheets.map(dependencies.loadStylesheet)),
			);
			const module = yield* Effect.promise(() => load(reference.specifier));
			return exported(module, reference, (value): value is ComponentType<AnalyticsSectionProps> =>
				isComponentType(value),
			);
		}),
	);

const createModuleLoader = (dependencies: CompositionDependencies) => {
	const modules = new Map<string, Promise<ClientModule>>();
	return (specifier: string) => {
		const cached = modules.get(specifier);
		if (cached) {
			return cached;
		}
		const loading = Effect.runPromise(
			Effect.promise(() => dependencies.loadModule(specifier)).pipe(
				Effect.onExit((exit) =>
					exit._tag === "Success"
						? Effect.void
						: Effect.sync(() => {
								modules.delete(specifier);
							}),
				),
			),
		);
		modules.set(specifier, loading);
		return loading;
	};
};

export const bootstrapComposition = (
	dependencies: CompositionDependencies = defaultDependencies,
): Promise<void> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const descriptor = readDescriptor();
			const load = createModuleLoader(dependencies);
			const moduleReferences =
				descriptor.application === "page"
					? [descriptor.entry]
					: [
							...(descriptor.routes.home === undefined ? [] : [descriptor.routes.home]),
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
			const analyticsSections = descriptor.analyticsSections.map((registration) => ({
				slug: registration.slug,
				name: registration.name,
				icon: registration.icon,
				ownerPluginId: registration.ownerPluginId,
				load:
					registration.module === null
						? null
						: () => loadAnalyticsSection(registration, load, dependencies),
			}));

			if (descriptor.application === "page") {
				dependencies.bootstrapPage(component(descriptor.entry), {
					analyticsSections,
					entityPresentations,
				});
				return;
			}
			const { home, routes, notFound } = descriptor.routes;
			dependencies.bootstrapPlugin(
				{
					...(home === undefined ? {} : { home: { component: component(home) } }),
					routes: routes.map((route) => ({ path: route.path, component: component(route.module) })),
					...(notFound === undefined ? {} : { notFound: component(notFound) }),
				},
				{ analyticsSections, entityPresentations },
			);
		}),
	);
