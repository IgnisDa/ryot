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

const createModuleLoader = (dependencies: CompositionDependencies) => {
	const modules = new Map<string, Promise<ClientModule>>();
	return (specifier: string) =>
		Effect.promise(() => {
			const cached = modules.get(specifier);
			if (cached) {
				return cached;
			}
			const loading = dependencies.loadModule(specifier);
			modules.set(specifier, loading);
			return loading;
		}).pipe(
			Effect.onError(() =>
				Effect.sync(() => {
					modules.delete(specifier);
				}),
			),
		);
};

const createExportLoader =
	(dependencies: CompositionDependencies, load: ReturnType<typeof createModuleLoader>) =>
	<Value>(
		reference: ClientCompositionModuleReference,
		stylesheets: ReadonlyArray<string>,
		isValue: (value: unknown) => value is Value,
	) =>
		Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.forEach(
					stylesheets,
					(href) => Effect.promise(() => dependencies.loadStylesheet(href)),
					{ discard: true, concurrency: "unbounded" },
				);
				return exported(yield* load(reference.specifier), reference, isValue);
			}),
		);

const isAnalyticsSection = (value: unknown): value is ComponentType<AnalyticsSectionProps> =>
	isComponentType(value);

export const bootstrapComposition = (
	dependencies: CompositionDependencies = defaultDependencies,
): Promise<void> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const descriptor = readDescriptor();
			const load = createModuleLoader(dependencies);
			const loadExport = createExportLoader(dependencies, load);
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
					(specifier) => load(specifier).pipe(Effect.map((module) => [specifier, module] as const)),
					{ concurrency: "unbounded" },
				),
			);
			const component = (reference: ClientCompositionModuleReference) =>
				exported(modules.get(reference.specifier), reference, isComponentType);
			const entityPresentations = descriptor.automaticRegistry.map((registration) => ({
				layout: registration.layout,
				ownerPluginId: registration.ownerPluginId,
				entitySchemaSlug: registration.entitySchemaSlug,
				load: () =>
					loadExport(registration.module, registration.stylesheets, isEntityPresentationDefinition),
			}));

			if (descriptor.application === "page") {
				dependencies.bootstrapPage(component(descriptor.entry), {
					entityPresentations,
					analyticsSections: descriptor.analyticsSections.map(
						({ module, stylesheets, ...section }) => ({
							...section,
							load:
								module === null ? null : () => loadExport(module, stylesheets, isAnalyticsSection),
						}),
					),
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
				{ entityPresentations },
			);
		}),
	);
