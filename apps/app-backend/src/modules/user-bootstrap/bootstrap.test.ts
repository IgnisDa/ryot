import { expect, it } from "@effect/vitest";
import { EntityId, EntitySchemaSlug, UserId } from "@ryot/contract/schema/brands";
import mediaPlugin from "@ryot/plugin-media";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { makePluginLoader } from "#modules/plugins/loader";

import { performBootstrap } from "./bootstrap";

const userId = UserId.make("user-id");
const librarySchemaId = EntitySchemaSlug.make("library-schema-id");

const makeEntity = () => ({
	properties: {},
	name: "Library",
	externalId: null,
	populatedAt: null,
	providerId: null,
	entitySchemaSlug: librarySchemaId,
	updatedAt: "2026-07-16T00:00:00.000Z",
	createdAt: "2026-07-16T00:00:00.000Z",
	id: EntityId.make("library-entity-id"),
});

const makeBootstrapDb = (options?: {
	bootstrapCompletedAt?: Date | null;
	onMarkComplete?: () => void;
}) => {
	const marker = options?.bootstrapCompletedAt ?? null;
	const userRows = [{ bootstrapCompletedAt: marker }];

	return Object.assign(Object.create(null), {
		select: () => ({
			from: (table: unknown) => {
				if (table === schema.user) {
					return {
						where: () =>
							Object.assign(Promise.resolve(userRows), {
								for: () => Promise.resolve(userRows),
							}),
					};
				}

				if (table === schema.entity) {
					return {
						where: () =>
							Object.assign(Promise.resolve([]), {
								limit: () => Promise.resolve([]),
							}),
					};
				}

				return { where: () => Promise.resolve([]) };
			},
		}),
		update: () => ({
			set: () => ({
				where: () => {
					options?.onMarkComplete?.();
					return Promise.resolve({});
				},
			}),
		}),
		execute: () => Promise.resolve({}),
	});
};

const makeServiceLayers = (createdEntities: unknown[], defaultRuleUserIds: UserId[]) => {
	const entitiesLayer = Layer.mock(EntitiesService)({
		_tag: "EntitiesService",
		create: (input) =>
			Effect.sync(() => {
				createdEntities.push(input);
				return makeEntity();
			}),
	});
	const notificationSubscriptionsLayer = Layer.mock(NotificationSubscriptionsService)({
		_tag: "NotificationSubscriptionsService",
		ensureDefaultRules: (inputUserId) =>
			Effect.sync(() => {
				defaultRuleUserIds.push(inputUserId);
			}),
	});

	return Layer.mergeAll(entitiesLayer, notificationSubscriptionsLayer);
};

const pluginDefinitionsLayer = () => {
	const registry = makeDefinitionRegistry();
	makePluginLoader(registry).load({ manifest: mediaPlugin, sourceHash: "test", scripts: [] });
	return Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...registry });
};

it.effect(
	"creates the library entity, ensures default rules, and sets the completion marker",
	() => {
		let markerUpdated = false;
		const createdEntities: unknown[] = [];
		const defaultRuleUserIds: UserId[] = [];

		return Effect.gen(function* () {
			yield* performBootstrap(userId);

			expect(createdEntities).toHaveLength(1);
			expect(defaultRuleUserIds).toEqual([userId]);
			expect(markerUpdated).toBe(true);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					pluginDefinitionsLayer(),
					Layer.succeed(
						CurrentDb,
						makeBootstrapDb({ onMarkComplete: () => (markerUpdated = true) }),
					),
					makeServiceLayers(createdEntities, defaultRuleUserIds),
				),
			),
		);
	},
);

it.effect("short-circuits when the completion marker is already set", () => {
	let markerUpdated = false;
	const createdEntities: unknown[] = [];
	const defaultRuleUserIds: UserId[] = [];

	return Effect.gen(function* () {
		yield* performBootstrap(userId);

		expect(createdEntities).toEqual([]);
		expect(defaultRuleUserIds).toEqual([]);
		expect(markerUpdated).toBe(false);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				pluginDefinitionsLayer(),
				Layer.succeed(
					CurrentDb,
					makeBootstrapDb({
						bootstrapCompletedAt: new Date("2026-01-01T00:00:00Z"),
						onMarkComplete: () => (markerUpdated = true),
					}),
				),
				makeServiceLayers(createdEntities, defaultRuleUserIds),
			),
		),
	);
});
