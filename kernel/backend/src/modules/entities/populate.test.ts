import { expect } from "bun:test";

import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, type SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import { entityEnrichmentRequest } from "#schema/tables/enrichment";
import { entity } from "#schema/tables/entities";
import { makeAppConfigLayer } from "#testing/effect";

import { TranslationsService } from "./localization/service";
import { EntityPopulation } from "./populate";
import { EntityPopulationTrigger, type PopulationRequest } from "./population-trigger";
import { EntityRetentionRepository } from "./retention/repository";

const owner = UserId.make("owner");
const principal = { userId: owner, accountUserId: owner, preferredLanguage: null };

class PopulateFixture extends Context.Service<
	PopulateFixture,
	{
		readonly pluginId: string;
		readonly providerId: SandboxProviderId;
		readonly requested: PopulationRequest[];
	}
>()("@ryot-app/kernel-backend/modules/entities/populate.test/PopulateFixture") {}

const populateLayer = Layer.unwrap(
	Effect.gen(function* () {
		const installed = yield* installRevisionPackage(revisionPackage("populate", "one", "record"));
		const provider = yield* (yield* PluginRuntimeResolver).findProviderAvailableToUserByReference(
			owner,
			{ slug: "populate-provider", owner: definitionOwner(installed.pluginId) },
		);
		assert(provider);
		const requested: PopulationRequest[] = [];
		return EntityPopulation.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					RyotQLService.layer,
					EntityRetentionRepository.layer,
					Layer.mock(TranslationsService)({}),
					Layer.succeed(EntityPopulationTrigger, {
						request: (input) =>
							Effect.sync(() => {
								requested.push(input);
								return true;
							}),
					}),
				),
			),
			Layer.merge(
				Layer.succeed(PopulateFixture, {
					requested,
					providerId: provider.id,
					pluginId: installed.pluginId,
				}),
			),
		);
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer), Layer.provide(makeAppConfigLayer()));

const seedPendingEntity = Effect.fnUntraced(function* (
	id: string,
	requests: ReadonlyArray<{ readonly id: string; readonly level: "base" | "full" }>,
) {
	const fixture = yield* PopulateFixture;
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(entity)
			.values({
				id,
				externalId: id,
				properties: {},
				name: "Pending record",
				entitySchemaSlug: "record",
				providerId: fixture.providerId,
				entitySchemaPluginId: fixture.pluginId,
			}),
	);
	for (const request of requests) {
		yield* session.run((db) =>
			db
				.insert(entityEnrichmentRequest)
				.values({
					...request,
					payload: {},
					entityId: id,
					externalId: id,
					state: "queued",
					requesterUserId: owner,
					operation: "population",
					entitySchemaSlug: "record",
					pluginId: fixture.pluginId,
					providerId: fixture.providerId,
				}),
		);
	}
	return EntityId.make(id);
});

layer(populateLayer)((test) => {
	test.effect(
		"lets an interactive ask outrank base-only work in flight, once",
		() =>
			Effect.gen(function* () {
				const population = yield* EntityPopulation;
				const { requested } = yield* PopulateFixture;
				const baseOnly = yield* seedPendingEntity("base-only", [
					{ level: "base", id: "base-only-base" },
				]);
				const withFull = yield* seedPendingEntity("with-full", [
					{ level: "base", id: "with-full-base" },
					{ level: "full", id: "with-full-full" },
				]);
				yield* population.request(principal, {
					priority: "background",
					entityIds: [baseOnly, withFull],
				});
				expect(requested).toEqual([]);
				yield* population.request(principal, {
					priority: "interactive",
					entityIds: [baseOnly, withFull],
				});
				expect(
					requested.map((request) => ({
						entityId: request.entityId,
						level: request.execution.level,
						lane: request.command.causation.lane,
					})),
				).toEqual([{ level: "full", entityId: baseOnly, lane: "interactive" }]);
			}),
		testTimeout,
	);
});
