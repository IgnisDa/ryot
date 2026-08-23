import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId, EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { fixtureManifest } from "#modules/plugins/test-support";

import type { AvailablePlugin } from "../plugins/runtime-resolver";
import { clientPageOperationTargets, resolvePluginPageTarget } from "./prepare";

const plugin = (input: {
	id: string;
	isDisabled?: boolean;
	client: NonNullable<PluginManifest["client"]>;
}): AvailablePlugin => {
	const manifest = fixtureManifest();
	return {
		id: input.id,
		scope: "user",
		slug: input.id,
		health: "ready",
		compiledHashes: {},
		sourceHash: `${input.id}-source`,
		ownerUserId: UserId.make("user-1"),
		isDisabled: input.isDisabled ?? false,
		pluginRevisionId: `${input.id}-revision`,
		installationId: `${input.id}-installation`,
		pluginConfigRevisionId: `${input.id}-config`,
		manifest: {
			...manifest,
			client: input.client,
			metadata: { ...manifest.metadata, slug: input.id },
		},
	};
};

const page = {
	kind: "page" as const,
	entry: "client/page.tsx",
	settingsSchema: { fields: {} },
	automaticEntityPresentations: false,
};

it.effect("selects a declared dynamic route from a disabled but ready direct installation", () => {
	const owner = plugin({
		id: "fixture",
		isDisabled: true,
		client: {
			apiVersion: 1,
			homeView: null,
			exports: { details: page },
			routes: { "/details/$itemId": "details" },
		},
	});
	return Effect.gen(function* () {
		const resolved = yield* resolvePluginPageTarget({
			plugins: [owner],
			findEntity: () => Effect.succeed(null),
			target: {
				pluginId: owner.id,
				search: "tab=stats",
				kind: "plugin-route",
				path: "/details/item-1",
			},
		});
		expect(resolved.kind).toBe("plugin");
		if (resolved.kind !== "plugin") {
			throw new Error("Expected plugin target");
		}
		expect(resolved.exportName).toBe("details");
		expect(resolved.params).toEqual({ itemId: "item-1" });
	});
});

it("records disabled ready installations as operation targets without making them contributors", () => {
	const target = plugin({
		isDisabled: true,
		id: "operations-only",
		client: { exports: {}, apiVersion: 1, homeView: null },
	});
	expect(clientPageOperationTargets([target])).toEqual([
		{
			pluginId: "operations-only",
			pluginSlug: "operations-only",
			sourceHash: "operations-only-source",
			installationId: "operations-only-installation",
		},
	]);
});

it.effect("decodes dynamic route parameters", () => {
	const owner = plugin({
		id: "fixture",
		client: {
			apiVersion: 1,
			homeView: null,
			exports: { details: page },
			routes: { "/details/$itemId": "details" },
		},
	});
	return Effect.gen(function* () {
		const resolved = yield* resolvePluginPageTarget({
			plugins: [owner],
			findEntity: () => Effect.succeed(null),
			target: { search: "", pluginId: owner.id, kind: "plugin-route", path: "/details/item%201" },
		});
		expect(resolved.kind).toBe("plugin");
		if (resolved.kind !== "plugin") {
			throw new Error("Expected plugin target");
		}
		expect(resolved.params).toEqual({ itemId: "item 1" });
	});
});

it.effect("selects a static route before an overlapping dynamic route", () => {
	const owner = plugin({
		id: "fixture",
		client: {
			apiVersion: 1,
			homeView: null,
			exports: { item: page, "new-item": page },
			routes: { "/items/$itemId": "item", "/items/new": "new-item" },
		},
	});
	return Effect.gen(function* () {
		const resolved = yield* resolvePluginPageTarget({
			plugins: [owner],
			findEntity: () => Effect.succeed(null),
			target: { search: "", pluginId: owner.id, path: "/items/new", kind: "plugin-route" },
		});
		expect(resolved.kind).toBe("plugin");
		if (resolved.kind !== "plugin") {
			throw new Error("Expected plugin target");
		}
		expect(resolved.exportName).toBe("new-item");
		expect(resolved.params).toEqual({});
	});
});

it.effect("selects the persisted provenance owner's registered entity page", () => {
	const owner = plugin({
		id: "owner",
		client: {
			apiVersion: 1,
			homeView: null,
			exports: { "pokemon-page": page },
			entities: { pokemon: { detailPage: "pokemon-page" } },
		},
	});
	return Effect.gen(function* () {
		const resolved = yield* resolvePluginPageTarget({
			plugins: [owner],
			target: { kind: "entity", entityId: EntityId.make("entity-1") },
			findEntity: () =>
				Effect.succeed({
					entitySchemaPluginId: owner.id,
					entityId: EntityId.make("entity-1"),
					entitySchemaSlug: EntitySchemaSlug.make("pokemon"),
				}),
		});
		expect(resolved.kind).toBe("plugin");
		if (resolved.kind !== "plugin") {
			throw new Error("Expected plugin target");
		}
		expect(resolved.plugin.id).toBe(owner.id);
		expect(resolved.exportName).toBe("pokemon-page");
	});
});

it.effect("resolves a kernel-owned collection to the kernel collection renderer", () => {
	const entityId = EntityId.make("col-1");
	return Effect.gen(function* () {
		const resolved = yield* resolvePluginPageTarget({
			plugins: [],
			target: { entityId, kind: "entity" },
			findEntity: () =>
				Effect.succeed({
					entityId,
					entitySchemaPluginId: null,
					entitySchemaSlug: EntitySchemaSlug.make("collection"),
				}),
		});
		expect(resolved.kind).toBe("kernel-entity");
		if (resolved.kind !== "kernel-entity") {
			throw new Error("Expected kernel entity target");
		}
		expect(resolved.rendererName).toBe("Collection detail");
		expect(resolved.entity.ownerPluginId).toBeNull();
	});
});

it.effect("keeps kernel-owned schemas without a renderer distinct", () => {
	const entityId = EntityId.make("entity-1");
	const target = { entityId, kind: "entity" as const };
	return Effect.gen(function* () {
		const failure = yield* Effect.flip(
			resolvePluginPageTarget({
				target,
				plugins: [],
				findEntity: () =>
					Effect.succeed({
						entityId,
						entitySchemaPluginId: null,
						entitySchemaSlug: EntitySchemaSlug.make("media-library"),
					}),
			}),
		);
		expect(failure.reason.code).toBe("entity-detail-page-not-registered");
		if (failure.reason.code !== "entity-detail-page-not-registered") {
			throw new Error("Expected detail page failure");
		}
		expect(failure.reason.ownerPluginId).toBeNull();
	});
});

it.effect(
	"keeps missing entity, unavailable owner, and unregistered page failures distinct",
	() => {
		const entityId = EntityId.make("entity-1");
		const target = { entityId, kind: "entity" as const };
		const entity = {
			entityId,
			entitySchemaPluginId: "owner",
			entitySchemaSlug: EntitySchemaSlug.make("pokemon"),
		};
		const owner = plugin({ id: "owner", client: { exports: {}, apiVersion: 1, homeView: null } });
		return Effect.gen(function* () {
			const missing = yield* Effect.flip(
				resolvePluginPageTarget({ target, plugins: [], findEntity: () => Effect.succeed(null) }),
			);
			expect(missing.reason.code).toBe("entity-not-found");
			const unavailable = yield* Effect.flip(
				resolvePluginPageTarget({ target, plugins: [], findEntity: () => Effect.succeed(entity) }),
			);
			expect(unavailable.reason.code).toBe("entity-owner-unavailable");
			const unregistered = yield* Effect.flip(
				resolvePluginPageTarget({
					target,
					plugins: [owner],
					findEntity: () => Effect.succeed(entity),
				}),
			);
			expect(unregistered.reason.code).toBe("entity-detail-page-not-registered");
		});
	},
);
