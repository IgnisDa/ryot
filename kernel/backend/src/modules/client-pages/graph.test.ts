import { expect, it } from "@effect/vitest";
import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { ClientRendererId, PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { fixtureManifest } from "#modules/plugins/test-support";

import type { AvailablePlugin } from "../plugins/runtime-resolver";
import { resolveClientPageGraph } from "./graph";
import { resolvePluginPageTarget } from "./prepare";

const bytes = (value: string) => new TextEncoder().encode(value);

const definition = (
	_entrySource: string,
	overrides: Partial<ClientRendererDefinition> = {},
): ClientRendererDefinition => ({
	files: [],
	pluginDependencies: [],
	entry: "client/page.tsx",
	settingsSchema: { fields: {} },
	automaticEntityPresentations: false,
	...overrides,
});

const plugin = (input: {
	id?: string;
	slug: string;
	sourceHash?: string;
	isDisabled?: boolean;
	scope?: "system" | "user";
	client: NonNullable<PluginManifest["client"]>;
}): AvailablePlugin => {
	const base = fixtureManifest();
	return {
		config: {},
		health: "ready",
		slug: input.slug,
		compiledHashes: {},
		scope: input.scope ?? "system",
		id: input.id ?? `${input.slug}-id`,
		isDisabled: input.isDisabled ?? false,
		installationId: `${input.slug}-installation`,
		sourceHash: input.sourceHash ?? `${input.slug}-source`,
		manifest: {
			...base,
			client: input.client,
			metadata: { ...base.metadata, slug: input.slug, name: input.slug },
			entitySchemas: base.entitySchemas.map((entity) =>
				Object.assign({}, entity, { slug: `${input.slug}-entity` }),
			),
		},
	};
};

const resolve = (
	rendererDefinition: ClientRendererDefinition,
	rendererSource: string,
	plugins: readonly AvailablePlugin[],
	pluginFiles: Readonly<Record<string, Readonly<Record<string, Uint8Array>>>>,
) =>
	resolveClientPageGraph({
		plugins,
		definition: rendererDefinition,
		publishedHash: "renderer-source",
		rendererName: "Composed renderer",
		userId: UserId.make("user-1"),
		rendererId: ClientRendererId.make("renderer-1"),
		rendererFiles: { "client/page.tsx": bytes(rendererSource) },
		loadPluginFiles: (candidate) => Effect.succeed(pluginFiles[candidate.id] ?? null),
	});

it.effect("resolves recursive explicit dependencies to exact installation revisions", () => {
	const media = plugin({
		slug: "media",
		client: {
			apiVersion: 1,
			entry: "client/index.tsx",
			pluginDependencies: ["fixture"],
			exports: {
				card: { kind: "component", entry: "client/card.tsx", automaticEntityPresentations: false },
			},
		},
	});
	const fixture = plugin({
		slug: "fixture",
		scope: "user",
		isDisabled: true,
		client: {
			apiVersion: 1,
			entry: "client/index.tsx",
			pluginDependencies: ["media"],
			exports: {
				badge: {
					kind: "component",
					entry: "client/badge.tsx",
					automaticEntityPresentations: false,
				},
			},
		},
	});
	return Effect.gen(function* () {
		const graph = yield* resolve(
			definition("", { pluginDependencies: [PluginSlug.make("media")] }),
			'import Card from "@ryot-app/plugins/media/card"; export default Card;',
			[fixture, media],
			{
				[media.id]: {
					"client/card.tsx": bytes(
						'import Badge from "@ryot-app/plugins/fixture/badge"; export default Badge;',
					),
				},
				[fixture.id]: { "client/badge.tsx": bytes("export default function Badge() {}") },
			},
		);
		expect(
			graph.identity.contributors.map((item) => item.kind === "plugin" && item.pluginSlug),
		).toEqual([false, "fixture", "media"]);
		expect(graph.identity.selectedExports).toEqual([
			"@ryot-app/plugins/fixture/badge",
			"@ryot-app/plugins/media/card",
		]);
		const [rendererContributor, fixtureContributor, mediaContributor] = graph.identity.contributors;
		expect(graph.compilerInput.contributorOrder).toEqual([
			rendererContributor?.namespace,
			fixtureContributor?.namespace,
			mediaContributor?.namespace,
		]);
		expect(graph.contributors).toContainEqual({
			kind: "plugin",
			pluginId: fixture.id,
			pluginSlug: "fixture",
			sourceHash: fixture.sourceHash,
			installationId: fixture.installationId,
		});
	});
});

it.effect("rejects a public import that is not a declared renderer dependency", () => {
	const media = plugin({
		slug: "media",
		client: {
			apiVersion: 1,
			entry: "client/index.tsx",
			exports: {
				card: { kind: "component", entry: "client/card.tsx", automaticEntityPresentations: false },
			},
		},
	});
	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			resolve(
				definition(""),
				'import Card from "@ryot-app/plugins/media/card"; export default Card;',
				[media],
				{ [media.id]: { "client/card.tsx": bytes("export default function Card() {}") } },
			),
		);
		expect(error.reason).toEqual({
			code: "export-not-found",
			exportName: "@ryot-app/plugins/media/card",
		});
	});
});

it.effect("roots a page graph at the selected plugin page export", () => {
	const fixture = plugin({
		slug: "fixture",
		isDisabled: true,
		client: {
			apiVersion: 1,
			entry: "client/index.tsx",
			exports: {
				details: {
					kind: "page",
					entry: "client/details.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		},
	});
	return Effect.gen(function* () {
		const graph = yield* resolveClientPageGraph({
			plugin: fixture,
			plugins: [fixture],
			application: "page",
			exportName: "details",
			userId: UserId.make("user-1"),
			loadPluginFiles: () =>
				Effect.succeed({ "client/details.tsx": bytes("export default function Details() {}") }),
		});
		expect(graph.identity.entry.path).toBe("client/details.tsx");
		expect(graph.identity.contributors.map(({ kind }) => kind)).toEqual(["plugin"]);
		expect(graph.identity.selectedExports).toEqual(["@ryot-app/plugins/fixture/details"]);
		expect(graph.compilerInput.application).toBe("page");
	});
});

it.effect("uses one compiler graph for every route in a plugin revision", () => {
	const fixture = plugin({
		slug: "fixture",
		client: {
			apiVersion: 1,
			entry: "client/index.tsx",
			notFoundPage: "not-found",
			routes: { "/details/$itemId": "details", "/": "home" },
			exports: {
				home: { ...definition(""), kind: "page", entry: "client/home.tsx" },
				details: { ...definition(""), kind: "page", entry: "client/details.tsx" },
				"not-found": { ...definition(""), kind: "page", entry: "client/not-found.tsx" },
			},
		},
	});
	const files = {
		"client/home.tsx": bytes("export default function Home() {}"),
		"client/details.tsx": bytes("export default function Details() {}"),
		"client/not-found.tsx": bytes("export default function NotFound() {}"),
	};
	const resolveRoute = (path: string) =>
		Effect.gen(function* () {
			const resolved = yield* resolvePluginPageTarget({
				plugins: [fixture],
				target: { kind: "plugin-route", pluginId: fixture.id, path, search: "" },
				findEntity: () => Effect.succeed(null),
			});
			return yield* resolveClientPageGraph({
				plugins: [fixture],
				plugin: resolved.plugin,
				application: "plugin-route",
				exportName: resolved.exportName,
				userId: UserId.make("user-1"),
				loadPluginFiles: () => Effect.succeed(files),
			});
		});
	return Effect.gen(function* () {
		const home = yield* resolveRoute("/");
		const details = yield* resolveRoute("/details/item-1");
		expect(details.graphHash).toBe(home.graphHash);
		expect(details.compilerInput).toEqual(home.compilerInput);
		expect(details.compilerInput.routeRegistry).toEqual({
			home: "@ryot-app/plugins/fixture/home",
			notFound: "@ryot-app/plugins/fixture/not-found",
			routes: [{ path: "/details/$itemId", exportSpecifier: "@ryot-app/plugins/fixture/details" }],
		});
	});
});

it.effect("adds enabled automatic providers and fingerprints provider metadata", () => {
	const presentation = (sourceHash: string, isDisabled = false) =>
		plugin({
			sourceHash,
			isDisabled,
			slug: "fitness",
			client: {
				apiVersion: 1,
				entry: "client/index.tsx",
				entities: { "fitness-entity": { gridPresentation: "card" } },
				exports: {
					card: {
						kind: "presentation",
						entry: "client/card.tsx",
						automaticEntityPresentations: false,
					},
				},
			},
		});
	return Effect.gen(function* () {
		const enabled = presentation("fitness-source-1");
		const renderer = definition("", { automaticEntityPresentations: true });
		const files = {
			[enabled.id]: { "client/card.tsx": bytes("export default function Card() {}") },
		};
		const first = yield* resolve(renderer, "export default function Page() {}", [enabled], files);
		expect(first.identity.automaticRegistry).toEqual([
			{
				layout: "grid",
				ownerPluginId: enabled.id,
				entitySchemaSlug: "fitness-entity",
				exportSpecifier: "@ryot-app/plugins/fitness/card",
			},
		]);
		expect(first.identity.kernelAutomaticFallback).toEqual({
			runtimeVersion: 1,
			provider: "kernel",
			layouts: ["grid", "list"],
		});
		const changed = presentation("fitness-source-2");
		const second = yield* resolve(renderer, "export default function Page() {}", [changed], files);
		expect(second.graphHash).not.toBe(first.graphHash);
		const disabled = presentation("fitness-source-1", true);
		const withoutProvider = yield* resolve(
			renderer,
			"export default function Page() {}",
			[disabled],
			files,
		);
		expect(withoutProvider.identity.automaticRegistry).toEqual([]);
		expect(withoutProvider.identity.kernelAutomaticFallback?.provider).toBe("kernel");
	});
});

it.effect("rejects automatic registrations that do not name presentation exports", () => {
	const invalid = plugin({
		slug: "fixture",
		client: {
			apiVersion: 1,
			entry: "client/index.tsx",
			entities: { "fixture-entity": { gridPresentation: "card" } },
			exports: {
				card: { kind: "component", entry: "client/card.tsx", automaticEntityPresentations: false },
			},
		},
	});
	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			resolve(
				definition("", { automaticEntityPresentations: true }),
				"export default function Page() {}",
				[invalid],
				{ [invalid.id]: { "client/card.tsx": bytes("export default function Card() {}") } },
			),
		);
		expect(error.reason).toEqual({
			code: "export-not-found",
			exportName: "@ryot-app/plugins/fixture/card",
		});
	});
});

it.effect("records a kernel renderer as a production-owned graph contributor", () =>
	Effect.gen(function* () {
		const graph = yield* resolveClientPageGraph({
			kernel: true,
			plugins: [],
			sourceHash: "kernel-source",
			rendererName: "Entity browser",
			userId: UserId.make("user-1"),
			definition: definition("", { automaticEntityPresentations: true }),
			rendererFiles: { "client/page.tsx": bytes("export default function Page() {}") },
			loadPluginFiles: () => Effect.succeed(null),
		});
		expect(graph.identity.contributors).toEqual([
			{
				name: "Entity browser",
				pluginDependencies: [],
				kind: "kernel-renderer",
				entry: "client/page.tsx",
				sourceHash: "kernel-source",
				automaticEntityPresentations: true,
				namespace: graph.identity.entry.contributor,
			},
		]);
		expect(graph.contributors).toEqual([
			{ kind: "kernel-renderer", name: "Entity browser", sourceHash: "kernel-source" },
		]);
	}),
);
