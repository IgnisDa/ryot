import { describe, expect, it } from "@effect/vitest";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";

import { EntityPickPanel } from "#/modules/provider-add/pick-panel";
import type { ProviderSearchSummary } from "#/modules/provider-add/service";

const schemaSlug = EntitySchemaSlug.make("target");
const providerId = SandboxProviderId.make("catalog");
const provider: ProviderSearchSummary = {
	providerId,
	providerSlug: "catalog",
	providerName: "Catalog",
	searchOptionsSchema: null,
	rootEntitySchemaSlug: schemaSlug,
};
const emptyPage = { items: [], pageInfo: { limit: 30, hasMore: false, nextCursor: null } };

const searchResponse: SearchProviderEntitiesResponse = {
	providerId,
	providerName: "Catalog",
	rootEntitySchemaSlug: schemaSlug,
	details: { totalItems: 2, nextPage: null },
	items: [
		{ title: "Biceps", externalId: "biceps" },
		{ title: "Triceps", externalId: "triceps" },
	],
};

const renderPanel = ({
	selected,
	...overrides
}: { readonly selected: EntityId[] } & Partial<Parameters<typeof EntityPickPanel>[0]>) =>
	render(
		<EntityPickPanel
			initialQuery="ceps"
			onClose={() => undefined}
			selectedProviderId={undefined}
			onSelectProvider={() => undefined}
			search={() => Effect.succeed(searchResponse)}
			loadEntities={() => Effect.succeed(emptyPage)}
			onSelect={(entityId) => selected.push(entityId)}
			providers={{ status: "ready", providers: [provider] }}
			importEntity={() => Effect.die(new Error("not used"))}
			loadMaterialized={() => Effect.succeed(new Set<string>())}
			{...overrides}
		/>,
	);

describe("entity pick panel", () => {
	it.live("lists visible entities for the query and selects one", () =>
		Effect.gen(function* () {
			const selected: EntityId[] = [];
			const queries: string[] = [];
			renderPanel({
				selected,
				providers: { providers: [], status: "ready" },
				loadEntities: (input) => {
					queries.push(input.query);
					return Effect.succeed({
						...emptyPage,
						items: [{ name: "Biceps", id: EntityId.make("entity-biceps") }],
					});
				},
			});

			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Biceps" })));

			expect(queries).toEqual(["ceps"]);
			expect(selected).toEqual([EntityId.make("entity-biceps")]);
			expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull();
		}),
	);

	it.live("hides provider results that are already materialized", () =>
		Effect.gen(function* () {
			const lookups: unknown[] = [];
			const searches: SearchProviderEntitiesBody[] = [];
			renderPanel({
				selected: [],
				search: (payload) => {
					searches.push(payload);
					return Effect.succeed(searchResponse);
				},
				loadMaterialized: (input) => {
					lookups.push(input);
					return Effect.succeed(new Set(["biceps"]));
				},
			});

			yield* Effect.promise(() => screen.findByRole("button", { name: "Add Triceps" }));

			expect(screen.queryByText("Biceps")).toBeNull();
			expect(searches).toMatchObject([{ page: 1, providerId, query: "ceps" }]);
			expect(lookups).toContainEqual({ providerId, externalIds: ["biceps", "triceps"] });
		}),
	);

	it.live("imports a provider result and selects the imported entity", () =>
		Effect.gen(function* () {
			const selected: EntityId[] = [];
			const imports: string[] = [];
			renderPanel({
				selected,
				importEntity: (input) => {
					imports.push(input.externalId);
					return Effect.succeed({ status: "imported", entityId: EntityId.make("entity-triceps") });
				},
			});

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Add Triceps" })),
			);

			yield* Effect.promise(() =>
				waitFor(() => expect(selected).toEqual([EntityId.make("entity-triceps")])),
			);
			expect(imports).toEqual(["triceps"]);
		}),
	);

	it.live("offers creation from the trimmed query only when a create handler is supplied", () =>
		Effect.gen(function* () {
			const created: string[] = [];
			renderPanel({
				selected: [],
				initialQuery: "  Rotator Cuff ",
				onCreate: (query) => created.push(query),
			});

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: 'Create "Rotator Cuff"' })),
			);

			expect(created).toEqual(["Rotator Cuff"]);
		}),
	);
});
