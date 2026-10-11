import { describe, expect, it } from "@effect/vitest";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import { axe } from "vitest-axe";

import { ProviderSearchPanel } from "#/modules/provider-add/panel";
import type { ProviderSearchSummary } from "#/modules/provider-add/service";

const unitSlug = EntitySchemaSlug.make("unit");

const provider = (index: number): ProviderSearchSummary => ({
	searchOptionsSchema: null,
	rootEntitySchemaSlug: unitSlug,
	providerSlug: `provider-${index}`,
	providerName: `Provider ${index}`,
	providerId: SandboxProviderId.make(`provider-${index}`),
});

const providers = [provider(1), provider(2)];

const renderPanel = (
	options: {
		readonly onCreateCustom?: (query: string) => void;
		readonly search?: (
			payload: SearchProviderEntitiesBody,
		) => Effect.Effect<SearchProviderEntitiesResponse>;
	} = {},
) =>
	render(
		<ProviderSearchPanel
			renderAsset={() => null}
			onClose={() => undefined}
			entitySchemaSlug={unitSlug}
			onImported={() => undefined}
			onSelectProvider={() => undefined}
			librarySchemaSlug="fixture-library"
			relationshipSlug="in-fixture-library"
			onCreateCustom={options.onCreateCustom}
			providers={{ providers, status: "ready" }}
			selectedProviderId={providers[0].providerId}
			importEntity={() => Effect.die(new Error("not used"))}
			uploadFile={() => Promise.reject(new Error("not used"))}
			uploadAsset={() => Promise.reject(new Error("not used"))}
			loadSearchOptions={() => Effect.die(new Error("not used"))}
			loadEntityLinks={() => Effect.succeed(new Map<string, never>())}
			search={options.search ?? (() => Effect.die(new Error("not used")))}
		/>,
	);

const searchResponse = (page: number): SearchProviderEntitiesResponse => ({
	rootEntitySchemaSlug: unitSlug,
	providerId: providers[0].providerId,
	providerName: providers[0].providerName,
	details: { totalItems: 2, nextPage: page === 1 ? 2 : null },
	items: [{ title: `Result ${page}`, externalId: `item-${page}` }],
});

describe("provider search panel", () => {
	it.live("exposes the providers as a single-tab-stop radiogroup", () =>
		Effect.gen(function* () {
			renderPanel();

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("radiogroup", { name: "Search provider" })).toBeTruthy(),
				),
			);
			expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("tabindex"))).toEqual([
				"0",
				"-1",
			]);
			expect(screen.getByRole("radio", { name: "Provider 1" }).getAttribute("aria-checked")).toBe(
				"true",
			);
		}),
	);

	it("offers Create custom only when a handler is supplied and passes the trimmed query", () => {
		const withoutHandler = renderPanel();
		expect(screen.queryByRole("button", { name: "Create custom" })).toBeNull();
		withoutHandler.unmount();

		const queries: string[] = [];
		renderPanel({ onCreateCustom: (query) => queries.push(query) });
		fireEvent.change(screen.getByRole("textbox", { name: "Search providers" }), {
			target: { value: "  Dune  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create custom" }));

		expect(queries).toEqual(["Dune"]);
	});

	it.live("loads numbered provider-search pages through shared pagination", () =>
		Effect.gen(function* () {
			const requests: SearchProviderEntitiesBody[] = [];
			renderPanel({
				search: (payload) => {
					requests.push(payload);
					return Effect.succeed(searchResponse(payload.page));
				},
			});

			fireEvent.change(screen.getByRole("textbox", { name: "Search providers" }), {
				target: { value: "Dune" },
			});
			expect(requests).toEqual([]);

			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			expect(requests[0]).toMatchObject({ page: 1, query: "Dune" });
			expect(screen.getByText("Result 1")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
			expect(requests.map((request) => request.page)).toEqual([1, 2]);
			expect(screen.getByText("Result 2")).toBeTruthy();
		}),
	);

	it.live("passes an axe pass on the rendered panel", () =>
		Effect.gen(function* () {
			const view = renderPanel();

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("radiogroup", { name: "Search provider" })).toBeTruthy(),
				),
			);
			const results = yield* Effect.promise(() =>
				axe(view.container, { rules: { "color-contrast": { enabled: false } } }),
			);

			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		}),
	);
});
