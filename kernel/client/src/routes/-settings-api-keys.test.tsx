import { expect } from "bun:test";

import type { ContractRequest } from "@ryot-app/contract/client";
import { ApiKeyId } from "@ryot-app/contract/schema/brands";
import type { ApiKeyItem } from "@ryot-app/ryotql-recipes/api-keys";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer, makeAccountApi, makeRyotQLApi } from "#/api/ports.test-layer";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { pluginBridgeServicesTestLayer } from "#/modules/pages/bridge/services.test-layer";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { makePluginCatalog } from "#/modules/plugins/catalog/service.test-layer";
import { getRouter } from "#/router";
import {
	authenticated,
	catalog,
	ClientPageSessionsRouteStubs,
	CustomizeRouteStubs,
	DeviceRouteStubs,
	ImportsRouteStubs,
	InstanceAdminRouteStubs,
	IntegrationRouteStubs,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStubLayer,
	ManagedAssetRouteStubs,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	OAuthRouteStubs,
	PagesApiRouteStubs,
	ProviderAddRouteStubs,
	ServerStub,
	theme,
} from "#/routes/-route-fixtures";

const DAY_MS = 86_400_000;

const nowMs = Date.now();

const makeKey = (overrides: Partial<ApiKeyItem> = {}): ApiKeyItem => ({
	start: "abc123",
	lastUsedAt: null,
	name: "Home server",
	id: ApiKeyId.make("key_1"),
	createdAt: new Date(nowMs - DAY_MS).toISOString(),
	expiresAt: new Date(nowMs + 90 * DAY_MS).toISOString(),
	...overrides,
});

type CreateRequest = ContractRequest<"account", "createApiKey">;

const mountView = (options: {
	readonly demo?: boolean;
	readonly revoked?: (id: ApiKeyId) => void;
	readonly keys: () => readonly ApiKeyItem[];
	readonly created?: (request: CreateRequest) => void;
}) => {
	const queries: number[] = [];
	const ryotql = makeRyotQLApi({
		execute: (_scope, request) => {
			const keys = bindTestRequest(request.payload).queries.keys;
			if (keys.output.type !== "rows") {
				return Effect.die("Expected API key rows query");
			}
			queries.push(keys.output.pagination.limit);
			return Effect.succeed({
				data: {
					keys: {
						type: "rows" as const,
						items: options.keys(),
						pageInfo: { hasMore: false, nextCursor: null, limit: keys.output.pagination.limit },
					},
				},
			});
		},
	});
	const account = makeAccountApi({
		revokeApiKey: (_scope, request) =>
			Effect.sync(() => options.revoked?.(request.params.apiKeyId)),
		createApiKey: (_scope, request) =>
			Effect.sync(() => {
				options.created?.(request);
				return { key: "abc123secretvalue", id: ApiKeyId.make("key_new") };
			}),
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(
				{},
				options.demo === true ? { ...authenticated, accessClass: "demo" } : authenticated,
			),
			InstanceAdminRouteStubs,
			ServerStub,
			ManagedAssetRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			ryotql,
			PagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			account,
			makePluginCatalogEventsTestLayer().layer,
			makePluginCatalog(catalog),
			DeviceRouteStubs,
			NavigationRouteStubs,
			CustomizeRouteStubs,
			pluginBridgeServicesTestLayer,
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(makeStorageStubLayer("fixture")),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: ["/settings/api-keys"] }),
	);
	render(<RouterProvider router={router} />);
	return { queries };
};

it.live(
	"creates a named key and shows its secret once",
	() =>
		Effect.gen(function* () {
			const requests: CreateRequest[] = [];
			let keys: readonly ApiKeyItem[] = [];
			mountView({
				keys: () => keys,
				created: (request) => {
					requests.push(request);
					keys = [makeKey({ name: "Laptop", id: ApiKeyId.make("key_new") })];
				},
			});

			const empty = yield* Effect.promise(() => screen.findByText("No API keys yet"));
			fireEvent.click(within(empty.parentElement ?? document.body).getByRole("button"));
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Create API key" }),
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Create key" }));
			yield* Effect.promise(() => within(dialog).findByText("Enter a name for this key."));
			expect(requests).toEqual([]);

			fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Laptop " } });
			fireEvent.click(within(dialog).getByRole("radio", { name: "Never" }));
			expect(within(dialog).getByText("The key works until you revoke it.")).toBeTruthy();
			fireEvent.click(within(dialog).getByRole("button", { name: "Create key" }));

			const revealed = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Save your API key" }),
			);
			expect(within(revealed).getByLabelText("New API key").textContent).toBe("abc123secretvalue");
			expect(requests).toEqual([{ payload: { name: "Laptop", expiresInDays: null } }]);
			fireEvent.click(within(revealed).getByRole("button", { name: "Done" }));
			yield* Effect.promise(() => screen.findByRole("listitem"));
			expect(screen.getByText("Laptop")).toBeTruthy();
			expect(screen.queryByText("abc123secretvalue")).toBeNull();
		}),
	testTimeout,
);

it.live(
	"lists key status and revokes a key after confirmation",
	() =>
		Effect.gen(function* () {
			const revoked: ApiKeyId[] = [];
			mountView({
				revoked: (id) => revoked.push(id),
				keys: () => [
					makeKey({
						expiresAt: new Date(nowMs + 3 * DAY_MS).toISOString(),
						lastUsedAt: new Date(nowMs - 2 * 3_600_000).toISOString(),
					}),
					makeKey({
						name: "Old script",
						id: ApiKeyId.make("key_2"),
						expiresAt: new Date(nowMs - DAY_MS).toISOString(),
					}),
					makeKey({
						expiresAt: null,
						name: "Forever",
						id: ApiKeyId.make("key_3"),
						createdAt: new Date(nowMs - 2 * DAY_MS).toISOString(),
					}),
				],
			});

			const [home, old, forever] = yield* Effect.promise(() => screen.findAllByRole("listitem"));
			expect(home.textContent).toContain("Expires soon");
			expect(home.textContent).toContain("Last used 2 hours ago");
			expect(old.textContent).toContain("Expired");
			expect(old.textContent).not.toContain("Expires soon");
			expect(forever.textContent).toContain("Never expires");
			expect(forever.textContent).toContain("Never used");

			fireEvent.click(screen.getByRole("button", { name: "Revoke Old script" }));
			const confirm = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: 'Revoke "Old script"?' }),
			);
			fireEvent.click(within(confirm).getByRole("button", { name: "Revoke key" }));
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
			expect(revoked).toEqual([ApiKeyId.make("key_2")]);
		}),
	testTimeout,
);

it.live(
	"keeps API keys hidden from demo sessions",
	() =>
		Effect.gen(function* () {
			const { queries } = mountView({ demo: true, keys: () => [makeKey()] });
			yield* Effect.promise(() =>
				screen.findByText("This operation is unavailable while using the shared demo account."),
			);
			expect(screen.queryByRole("button", { name: "Create key" })).toBeNull();
			expect(queries).toEqual([]);
		}),
	testTimeout,
);
