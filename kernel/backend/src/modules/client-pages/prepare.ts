import {
	ClientPagePreparationError,
	type ClientPageOperationTarget,
	type ClientPageTarget,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { comparePluginRoutePaths } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug, type EntityId, type EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { AvailablePlugin } from "#modules/plugins/runtime-resolver";

import { getKernelEntityRenderer } from "./kernel-renderers";

type PageEntity = {
	readonly entityId: EntityId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entitySchemaPluginId: string | null;
};

const failure = (reason: ClientPagePreparationError["reason"]) =>
	new ClientPagePreparationError({ reason });

export const clientPageOperationTargets = (
	plugins: ReadonlyArray<AvailablePlugin>,
): readonly ClientPageOperationTarget[] =>
	plugins
		.filter(({ health }) => health === "ready")
		.map(({ id, slug, sourceHash, installationId }) => ({
			sourceHash,
			pluginId: id,
			installationId,
			pluginSlug: PluginSlug.make(slug),
		}))
		.sort((left, right) => left.pluginSlug.localeCompare(right.pluginSlug));

const matchRoute = (pattern: string, path: string) => {
	const patternSegments = pattern.split("/").filter(Boolean);
	const pathSegments = path.split("/").filter(Boolean);
	if (patternSegments.length !== pathSegments.length) {
		return null;
	}
	const params: Record<string, string> = {};
	for (const [index, expected] of patternSegments.entries()) {
		const actual = pathSegments[index];
		if (actual === undefined) {
			return null;
		}
		if (expected.startsWith("$")) {
			try {
				params[expected.slice(1)] = decodeURIComponent(actual);
			} catch {
				params[expected.slice(1)] = actual;
			}
		} else if (expected !== actual) {
			return null;
		}
	}
	return params;
};

export type ResolvedPluginPageTarget =
	| {
			readonly kind: "plugin";
			readonly exportName: string;
			readonly plugin: AvailablePlugin;
			readonly params: Readonly<Record<string, string>>;
			readonly entity: {
				readonly entityId: EntityId;
				readonly ownerPluginId: string;
				readonly entitySchemaSlug: EntitySchemaSlug;
			} | null;
	  }
	| {
			readonly kind: "kernel-entity";
			readonly rendererName: string;
			readonly sourceHash: string;
			readonly params: Readonly<Record<string, string>>;
			readonly entity: {
				readonly entityId: EntityId;
				readonly ownerPluginId: null;
				readonly entitySchemaSlug: EntitySchemaSlug;
			};
	  };

export const resolvePluginPageTarget = <E, R>(input: {
	readonly plugins: ReadonlyArray<AvailablePlugin>;
	readonly target: Exclude<ClientPageTarget, { readonly kind: "saved-view" }>;
	readonly findEntity: (entityId: EntityId) => Effect.Effect<PageEntity | null, E, R>;
}): Effect.Effect<ResolvedPluginPageTarget, ClientPagePreparationError | E, R> =>
	Effect.gen(function* () {
		if (input.target.kind === "plugin-route") {
			const target = input.target;
			const plugin = input.plugins.find(({ id }) => id === target.pluginId);
			if (plugin?.health !== "ready" || !plugin.manifest.client) {
				return yield* failure({ pluginId: target.pluginId, code: "plugin-unavailable" });
			}
			for (const [pattern, exportName] of Object.entries(plugin.manifest.client.routes ?? {}).sort(
				([left], [right]) => comparePluginRoutePaths(left, right),
			)) {
				const params = matchRoute(pattern, target.path);
				if (params !== null) {
					return { plugin, params, exportName, entity: null, kind: "plugin" as const };
				}
			}
			const exportName = plugin.manifest.client.notFoundPage;
			if (exportName) {
				return { plugin, exportName, params: {}, entity: null, kind: "plugin" as const };
			}
			return yield* failure({
				path: target.path,
				pluginId: target.pluginId,
				code: "plugin-route-not-registered",
			});
		}

		const entity = yield* input.findEntity(input.target.entityId);
		if (!entity) {
			return yield* failure({ code: "entity-not-found", entityId: input.target.entityId });
		}
		if (entity.entitySchemaPluginId === null) {
			const renderer = getKernelEntityRenderer(entity.entitySchemaSlug);
			if (!renderer) {
				return yield* failure({
					ownerPluginId: null,
					entityId: entity.entityId,
					code: "entity-detail-page-not-registered",
					entitySchemaSlug: entity.entitySchemaSlug,
				});
			}
			return {
				params: {},
				rendererName: renderer.name,
				kind: "kernel-entity" as const,
				sourceHash: renderer.sourceHash,
				entity: {
					ownerPluginId: null,
					entityId: entity.entityId,
					entitySchemaSlug: entity.entitySchemaSlug,
				},
			};
		}
		const owner = input.plugins.find(({ id }) => id === entity.entitySchemaPluginId);
		if (owner?.health !== "ready" || !owner.manifest.client) {
			return yield* failure({
				entityId: entity.entityId,
				code: "entity-owner-unavailable",
				ownerPluginId: entity.entitySchemaPluginId,
			});
		}
		const exportName = owner.manifest.client.entities?.[entity.entitySchemaSlug]?.detailPage;
		if (!exportName) {
			return yield* failure({
				ownerPluginId: owner.id,
				entityId: entity.entityId,
				code: "entity-detail-page-not-registered",
				entitySchemaSlug: entity.entitySchemaSlug,
			});
		}
		return {
			params: {},
			exportName,
			plugin: owner,
			kind: "plugin" as const,
			entity: {
				ownerPluginId: owner.id,
				entityId: entity.entityId,
				entitySchemaSlug: entity.entitySchemaSlug,
			},
		};
	});
