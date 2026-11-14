import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { makeAppConfigLayer } from "#testing/effect";

import { SavedViewsRepository } from "./repository";
import { SavedViewsService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Owner",
	id: UserId.make("owner"),
	email: "owner@example.test",
	preferences: {
		language: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
};
const dataSources: RyotQLDocument = {
	parameters: {
		fields: {
			prefix: { type: "string", label: "Prefix", defaultValue: "A", description: "Prefix" },
		},
	},
	controls: {
		sort: {
			kind: "outputs",
			fields: [{ key: "name", type: "text", kind: "value", field: "name", label: "Name" }],
		},
		filter: {
			kind: "outputs",
			fields: [{ key: "name", type: "text", kind: "value", field: "name", label: "Name" }],
		},
	},
	queries: {
		items: {
			where: { type: "filter" },
			from: { alias: "item", table: "entity" },
			output: {
				type: "rows",
				pagination: { limit: 10, maxLimit: 100 },
				orderBy: { type: "sort", otherwise: [] },
				fields: [{ key: "name", expr: { field: "name", type: "column", tableAlias: "item" } }],
			},
		},
	},
};
const config = {
	dataSources,
	renderer: { kind: "kernel", name: "results-table" },
	settings: {
		pageSize: 10,
		entityLink: null,
		sourceName: "items",
		rowKeyFields: ["name"],
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} as const;
const filter = { field: "name", operator: "is", value: "Alpha" } as const;

layer(
	SavedViewsService.layer.pipe(
		Layer.provideMerge(SavedViewsRepository.layer),
		Layer.provide(PluginCatalogInvalidator.layer),
		Layer.provideMerge(revisionDatabaseLayer),
		Layer.provide(makeAppConfigLayer()),
	),
)((test) => {
	test.effect(
		"retains omitted selections, clears explicit nulls, and validates replacement defaults",
		() =>
			Effect.gen(function* () {
				const service = yield* SavedViewsService;
				const repository = yield* SavedViewsRepository;
				const created = yield* service.create(user, { ...config, icon: "box", name: "Selections" });
				const reference = { kind: "custom", savedViewId: created.id } as const;
				yield* service.update(user, reference, {
					filter,
					isHidden: false,
					sort: "name-asc",
					arguments: { prefix: "B" },
				});
				yield* service.update(user, reference, { isHidden: false, name: "Renamed" });
				const retained = yield* repository.findByReference(user.id, reference);
				expect(retained).toMatchObject({ filter, sort: "name-asc", arguments: { prefix: "B" } });
				yield* service.update(user, reference, {
					sort: null,
					filter: null,
					arguments: {},
					isHidden: false,
				});
				const cleared = yield* repository.findByReference(user.id, reference);
				assert(cleared);
				expect(cleared.sort).toBeUndefined();
				expect(cleared.filter).toBeUndefined();
				expect(cleared.arguments).toEqual({ prefix: "A" });
				yield* service.update(user, reference, { filter, isHidden: false, sort: "name-desc" });
				const withoutControls: RyotQLDocument = {
					queries: {
						items: {
							from: { alias: "item", table: "entity" },
							output: {
								orderBy: [],
								type: "rows",
								pagination: { limit: 10, maxLimit: 100 },
								fields: [
									{ key: "name", expr: { field: "name", type: "column", tableAlias: "item" } },
								],
							},
						},
					},
				};
				yield* service.update(user, reference, {
					...config,
					sort: null,
					filter: null,
					arguments: {},
					isHidden: false,
					dataSources: withoutControls,
				});
				const replaced = yield* repository.findByReference(user.id, reference);
				assert(replaced);
				expect(replaced.sort).toBeUndefined();
				expect(replaced.filter).toBeUndefined();
				expect(replaced.arguments).toEqual({});
				const required: RyotQLDocument = {
					...withoutControls,
					parameters: {
						fields: {
							required: {
								type: "string",
								label: "Required",
								description: "Required",
								validation: { required: true },
							},
						},
					},
				};
				expect(
					yield* Effect.flip(
						service.update(user, reference, {
							...config,
							arguments: {},
							isHidden: false,
							dataSources: required,
						}),
					),
				).toBeInstanceOf(SavedViewBadRequest);
				assertExitFails(
					yield* Effect.exit(
						service.update(user, reference, { ...config, isHidden: false, sort: "missing-asc" }),
					),
					new RyotQLBadRequest({
						reason: {
							code: "invalid-query",
							message: "Sort choice 'missing-asc' is not available",
						},
					}),
				);
				assertExitFails(
					yield* Effect.exit(
						service.update(user, reference, {
							...config,
							isHidden: false,
							filter: { value: 1, field: "name", operator: "gte" },
						}),
					),
					new RyotQLBadRequest({
						reason: {
							code: "invalid-query",
							message: "Operator 'gte' is not available for field 'name'",
						},
					}),
				);
			}),
		testTimeout,
	);
});
