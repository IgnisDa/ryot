import { expect, it } from "@effect/vitest";
import type { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { ClientRendererId, PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { fixtureManifest } from "#modules/plugins/test-support";

import type { AvailablePlugin } from "../plugins/runtime-resolver";
import { resolveClientPageGraph } from "./graph";

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
