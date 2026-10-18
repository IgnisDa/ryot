import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	ProviderEntityBadRequest,
	type SearchProviderEntitiesBody,
	type SearchProviderEntitiesResponse,
	type SearchProviderOptionsResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { createRyotQuery, RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import { type ComponentProps, useState } from "react";
import { axe } from "vitest-axe";

import type { ProviderEntityImportEntry } from "#/modules/provider-add/import-controller";
import { ProviderSearchPanel, SEARCH_DEBOUNCE_MS } from "#/modules/provider-add/panel";
import { ProviderAddLoadError, type ProviderSearchSummary } from "#/modules/provider-add/service";

const unitSlug = EntitySchemaSlug.make("unit");

const provider = (index: number): ProviderSearchSummary => ({
	searchOptionsSchema: null,
	rootEntitySchemaSlug: unitSlug,
	providerSlug: `provider-${index}`,
	providerName: `Provider ${index}`,
	providerId: SandboxProviderId.make(`provider-${index}`),
});

const providers = [provider(1), provider(2)];

const clocks: ReturnType<typeof createTestRyotClock>[] = [];
afterEach(() => Promise.all(clocks.splice(0).map((clock) => clock.dispose())));

type PanelProps = ComponentProps<typeof ProviderSearchPanel>;

const renderPanel = (
	options: {
		readonly initialQuery?: string;
		readonly search?: PanelProps["search"];
		readonly onImported?: PanelProps["onImported"];
		readonly selectedProviderId?: SandboxProviderId;
		readonly onCreateCustom?: (query: string) => void;
		readonly importEntity?: PanelProps["importEntity"];
		readonly providers?: readonly ProviderSearchSummary[];
		readonly loadSearchOptions?: (
			providerId: SandboxProviderId,
		) => Effect.Effect<SearchProviderOptionsResponse, Error>;
	} = {},
) => {
	const clock = createTestRyotClock();
	clocks.push(clock);
	const query = createRyotQuery<SandboxProviderId, SearchProviderOptionsResponse, undefined, Error>(
		({ input }) => options.loadSearchOptions?.(input) ?? Effect.die(new Error("not used")),
		{ cancelOnUnmount: true },
	);
	function Panel() {
		const [selected, setSelected] = useState(options.selectedProviderId ?? providers[0].providerId);
		return (
			<ProviderSearchPanel
				renderAsset={() => null}
				onClose={() => undefined}
				searchOptionsQuery={query}
				entitySchemaSlug={unitSlug}
				selectedProviderId={selected}
				onSelectProvider={setSelected}
				librarySchemaSlug="fixture-library"
				initialQuery={options.initialQuery}
				relationshipSlug="in-fixture-library"
				onCreateCustom={options.onCreateCustom}
				onImported={options.onImported ?? (() => undefined)}
				uploadFile={() => Promise.reject(new Error("not used"))}
				uploadAsset={() => Promise.reject(new Error("not used"))}
				loadEntityLinks={() => Effect.succeed(new Map<string, never>())}
				search={options.search ?? (() => Effect.die(new Error("not used")))}
				providers={{ status: "ready", providers: options.providers ?? providers }}
				importEntity={options.importEntity ?? (() => Effect.die(new Error("not used")))}
			/>
		);
	}
	return render(
		<RyotProvider runtime={clock.runtime}>
			<Panel />
		</RyotProvider>,
	);
};

const searchResponse = (page: number): SearchProviderEntitiesResponse => ({
	rootEntitySchemaSlug: unitSlug,
	providerId: providers[0].providerId,
	providerName: providers[0].providerName,
	details: { totalItems: 2, nextPage: page === 1 ? 2 : null },
	items: [{ title: `Result ${page}`, externalId: `item-${page}` }],
});

const optionsResponse = (defaultValue?: string): SearchProviderOptionsResponse => ({
	schema: {
		fields: { region: { defaultValue, type: "string", label: "Region", description: "" } },
	},
});

const withOptions = (index: number): ProviderSearchSummary => ({
	...provider(index),
	searchOptionsSchema: optionsResponse().schema,
});

const pendingOptions = () => {
	const requests: {
		readonly fail: () => void;
		readonly providerId: SandboxProviderId;
		readonly succeed: (response: SearchProviderOptionsResponse) => void;
	}[] = [];
	const interrupted: SandboxProviderId[] = [];
	return {
		requests,
		interrupted,
		load: (providerId: SandboxProviderId) =>
			Effect.callback<SearchProviderOptionsResponse, Error>((resume) => {
				requests.push({
					providerId,
					succeed: (response) => resume(Effect.succeed(response)),
					fail: () =>
						resume(
							Effect.fail(new ProviderAddLoadError({ stage: "options", cause: "Unavailable" })),
						),
				});
			}).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						interrupted.push(providerId);
					}),
				),
			),
	};
};

const pastDebounce = () =>
	Effect.promise(() => act(() => Effect.runPromise(Effect.sleep(SEARCH_DEBOUNCE_MS + 30))));

const enterSearch = () =>
	fireEvent.keyDown(screen.getByRole("textbox", { name: "Search providers" }), { key: "Enter" });

describe("provider search panel", () => {
	it.live(
		"waits for delayed defaults and uses one provider/query/options snapshot for every page",
		() =>
			Effect.gen(function* () {
				const options = pendingOptions();
				const requests: SearchProviderEntitiesBody[] = [];
				renderPanel({
					initialQuery: "  Sample  ",
					providers: [withOptions(1)],
					loadSearchOptions: options.load,
					search: (payload) => {
						requests.push(payload);
						return Effect.succeed(searchResponse(payload.page));
					},
				});
				yield* pastDebounce();
				expect(requests).toEqual([]);
				enterSearch();
				expect(requests).toEqual([]);
				act(() => options.requests[0].succeed(optionsResponse("north")));
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByText("Result 1")).toBeTruthy()),
				);
				fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
				expect(requests).toEqual(
					[1, 2].map((page) => ({
						page,
						pageSize: 20,
						query: "Sample",
						options: { region: "north" },
						providerId: providers[0].providerId,
					})),
				);
			}),
	);

	it.live("waits for required options and searches after the missing value is entered", () =>
		Effect.gen(function* () {
			const options = pendingOptions();
			const requests: SearchProviderEntitiesBody[] = [];
			renderPanel({
				initialQuery: "Sample",
				providers: [withOptions(1)],
				loadSearchOptions: options.load,
				search: (payload) => {
					requests.push(payload);
					return Effect.succeed(searchResponse(payload.page));
				},
			});
			enterSearch();
			act(() =>
				options.requests[0].succeed({
					schema: {
						fields: {
							region: {
								type: "string",
								label: "Region",
								description: "",
								validation: { required: true },
							},
						},
					},
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("textbox", { name: /Region/ })).toBeTruthy()),
			);
			expect(requests).toEqual([]);
			fireEvent.change(screen.getByRole("textbox", { name: /Region/ }), {
				target: { value: "south" },
			});
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			expect(requests[0]).toMatchObject({
				query: "Sample",
				options: { region: "south" },
				providerId: providers[0].providerId,
			});
		}),
	);

	it.live("isolates provider B from a late options response for A and keeps the query", () =>
		Effect.gen(function* () {
			const options = pendingOptions();
			const requests: SearchProviderEntitiesBody[] = [];
			renderPanel({
				initialQuery: "Sample",
				loadSearchOptions: options.load,
				providers: [withOptions(1), withOptions(2)],
				search: (payload) => {
					requests.push(payload);
					return Effect.succeed(searchResponse(payload.page));
				},
			});
			fireEvent.click(screen.getByRole("radio", { name: "Provider 2" }));
			yield* Effect.promise(() => waitFor(() => expect(options.requests).toHaveLength(2)));
			act(() => options.requests[1].succeed(optionsResponse("B")));
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			act(() => options.requests[0].succeed(optionsResponse("A")));
			yield* pastDebounce();
			expect(options.requests.map((request) => request.providerId)).toEqual(
				providers.map((item) => item.providerId),
			);
			expect(options.interrupted).toEqual([providers[0].providerId]);
			expect(requests).toEqual([
				{
					page: 1,
					pageSize: 20,
					query: "Sample",
					options: { region: "B" },
					providerId: providers[1].providerId,
				},
			]);
		}),
	);

	it.live(
		"blocks an optional-options failure and retries the remembered provider without a new selection",
		() =>
			Effect.gen(function* () {
				const options = pendingOptions();
				const requests: SearchProviderEntitiesBody[] = [];
				renderPanel({
					initialQuery: "Sample",
					loadSearchOptions: options.load,
					providers: [withOptions(1), withOptions(2)],
					selectedProviderId: providers[1].providerId,
					search: (payload) => {
						requests.push(payload);
						return Effect.succeed(searchResponse(payload.page));
					},
				});
				act(() => options.requests[0].fail());
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("button", { name: "Retry loading filters" })).toBeTruthy(),
					),
				);
				enterSearch();
				yield* pastDebounce();
				expect(requests).toEqual([]);
				fireEvent.click(screen.getByRole("button", { name: "Retry loading filters" }));
				yield* Effect.promise(() => waitFor(() => expect(options.requests).toHaveLength(2)));
				act(() => options.requests[1].succeed(optionsResponse("retry")));
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
				expect(options.requests.map((request) => request.providerId)).toEqual([
					providers[1].providerId,
					providers[1].providerId,
				]);
				expect(requests[0]).toMatchObject({
					query: "Sample",
					options: { region: "retry" },
					providerId: providers[1].providerId,
				});
			}),
	);

	it.live("submits Enter during debounce once and refreshes an identical normalized snapshot", () =>
		Effect.gen(function* () {
			const requests: SearchProviderEntitiesBody[] = [];
			renderPanel({
				search: (payload) => {
					requests.push(payload);
					return Effect.succeed(searchResponse(payload.page));
				},
			});
			fireEvent.change(screen.getByRole("textbox", { name: "Search providers" }), {
				target: { value: " Sample " },
			});
			enterSearch();
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			yield* pastDebounce();
			expect(requests).toHaveLength(1);
			enterSearch();
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
			expect(requests[0]).toEqual(requests[1]);
			expect(requests[0]).toMatchObject({
				page: 1,
				query: "Sample",
				providerId: providers[0].providerId,
			});
		}),
	);

	it.live("cancels options loading on dismissal and never searches from the late response", () =>
		Effect.gen(function* () {
			const options = pendingOptions();
			const requests: SearchProviderEntitiesBody[] = [];
			const view = renderPanel({
				initialQuery: "Sample",
				providers: [withOptions(1)],
				loadSearchOptions: options.load,
				search: (payload) => {
					requests.push(payload);
					return Effect.succeed(searchResponse(payload.page));
				},
			});
			view.unmount();
			yield* Effect.promise(() =>
				waitFor(() => expect(options.interrupted).toEqual([providers[0].providerId])),
			);
			act(() => options.requests[0].succeed(optionsResponse("late")));
			yield* pastDebounce();
			expect(requests).toEqual([]);
		}),
	);

	it.live("searches after a declared options query successfully returns no schema", () =>
		Effect.gen(function* () {
			const requests: SearchProviderEntitiesBody[] = [];
			renderPanel({
				initialQuery: "Sample",
				providers: [withOptions(1)],
				loadSearchOptions: () => Effect.succeed({ schema: null }),
				search: (payload) => {
					requests.push(payload);
					return Effect.succeed(searchResponse(payload.page));
				},
			});
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			expect(requests[0]).toEqual({
				page: 1,
				pageSize: 20,
				query: "Sample",
				providerId: providers[0].providerId,
			});
			expect(screen.queryByRole("button", { name: "Advanced options" })).toBeNull();
		}),
	);

	it.live("retries initial and appended searches using the submitted options snapshot", () =>
		Effect.gen(function* () {
			const requests: SearchProviderEntitiesBody[] = [];
			renderPanel({
				initialQuery: "Sample",
				providers: [withOptions(1)],
				loadSearchOptions: () => Effect.succeed(optionsResponse("north")),
				search: (payload) => {
					requests.push(payload);
					return requests.length === 1 || requests.length === 3
						? Effect.fail(new ProviderAddLoadError({ stage: "search", cause: "Unavailable" }))
						: Effect.succeed(searchResponse(payload.page));
				},
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Try searching again" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Try searching again" }));
			yield* Effect.promise(() => waitFor(() => expect(screen.getByText("Result 1")).toBeTruthy()));
			fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Retry provider search" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Retry provider search" }));
			yield* Effect.promise(() => waitFor(() => expect(screen.getByText("Result 2")).toBeTruthy()));
			expect(requests).toEqual(
				[1, 1, 2, 2].map((page) => ({
					page,
					pageSize: 20,
					query: "Sample",
					options: { region: "north" },
					providerId: providers[0].providerId,
				})),
			);
		}),
	);

	it.live("explains a missing provider configuration without offering a pointless retry", () =>
		Effect.gen(function* () {
			renderPanel({
				initialQuery: "Sample",
				search: () =>
					Effect.fail(
						new ProviderAddLoadError({
							stage: "search",
							cause: new ProviderEntityBadRequest({
								reason: {
									code: "search-failed",
									cause: { code: "missing-config", configNames: ["Provider API key"] },
								},
							}),
						}),
					),
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByText("Provider 1 isn't configured on this server")).toBeTruthy(),
				),
			);
			expect(screen.queryByText("Unable to reach the server")).toBeNull();
			expect(screen.queryByRole("button", { name: "Try searching again" })).toBeNull();
		}),
	);

	it.live("cancels an active search on dismissal and drops its late response", () =>
		Effect.gen(function* () {
			const completions: ((response: SearchProviderEntitiesResponse) => void)[] = [];
			const interrupted: SearchProviderEntitiesBody[] = [];
			const view = renderPanel({
				initialQuery: "Sample",
				search: (payload) =>
					Effect.callback<SearchProviderEntitiesResponse>((resume) => {
						completions.push((response) => resume(Effect.succeed(response)));
					}).pipe(
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								interrupted.push(payload);
							}),
						),
					),
			});
			enterSearch();
			yield* Effect.promise(() => waitFor(() => expect(completions).toHaveLength(1)));
			view.unmount();
			yield* Effect.promise(() => waitFor(() => expect(interrupted).toHaveLength(1)));
			act(() => completions[0](searchResponse(1)));
			yield* pastDebounce();
			expect(completions).toHaveLength(1);
			expect(screen.queryByText("Result 1")).toBeNull();
		}),
	);

	it.live("keeps an active import owned outside provider-keyed search sessions", () =>
		Effect.gen(function* () {
			const completions: ((entry: ProviderEntityImportEntry) => void)[] = [];
			const imports: { readonly externalId: string; readonly providerId: SandboxProviderId }[] = [];
			const imported: EntityId[] = [];
			renderPanel({
				initialQuery: "Sample",
				onImported: (id) => imported.push(id),
				importEntity: ({ externalId, providerId }) =>
					Effect.callback((resume) => {
						imports.push({ externalId, providerId });
						completions.push((entry) => resume(Effect.succeed(entry)));
					}),
				search: (payload) =>
					Effect.succeed({
						...searchResponse(payload.page),
						providerId: payload.providerId,
						items: [{ externalId: payload.providerId, title: `Result ${payload.providerId}` }],
					}),
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Add Result provider-1" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Add Result provider-1" }));
			fireEvent.click(screen.getByRole("radio", { name: "Provider 2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByText("Result provider-2")).toBeTruthy()),
			);
			const entityId = EntityId.make("imported-unit");
			act(() => completions[0]({ entityId, status: "imported" }));
			yield* Effect.promise(() => waitFor(() => expect(imported).toEqual([entityId])));
			expect(imports).toEqual([{ externalId: "provider-1", providerId: providers[0].providerId }]);
			expect(screen.getByText("Result provider-2")).toBeTruthy();
		}),
	);

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
			target: { value: "  Sample  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create custom" }));

		expect(queries).toEqual(["Sample"]);
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
				target: { value: "Sample" },
			});
			expect(requests).toEqual([]);

			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
			expect(requests[0]).toMatchObject({ page: 1, query: "Sample" });
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
