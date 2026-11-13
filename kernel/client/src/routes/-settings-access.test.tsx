import { expect } from "bun:test";

import type { ContractRequest } from "@ryot-app/contract/client";
import { ApiKeyId, ConnectedAppId } from "@ryot-app/contract/schema/brands";
import type { ApiKeyItem } from "@ryot-app/ryotql-recipes/api-keys";
import type { ConnectedAppItem } from "@ryot-app/ryotql-recipes/connected-apps";
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

type KeyRow = Omit<ApiKeyItem, "writeAccess"> & { readonly scopes: readonly string[] };
type AppRow = Omit<ConnectedAppItem, "writeAccess"> & { readonly scopes: readonly string[] };

const makeKey = (overrides: Partial<KeyRow> = {}): KeyRow => ({
	start: "abc123",
	lastUsedAt: null,
	name: "Home server",
	id: ApiKeyId.make("key_1"),
	createdAt: new Date(nowMs - DAY_MS).toISOString(),
	expiresAt: new Date(nowMs + 90 * DAY_MS).toISOString(),
	scopes: ["ryot:read", "ryot:write", "ryot:write:unattended"],
	...overrides,
});

const claudeApp: AppRow = {
	name: "Claude",
	lastUsedAt: null,
	scopes: ["ryot:read", "ryot:write"],
	id: ConnectedAppId.make("consent-1"),
	createdAt: new Date(nowMs - DAY_MS).toISOString(),
};

type CreateRequest = ContractRequest<"account", "createApiKey">;

const mountView = (options: {
	readonly demo?: boolean;
	readonly apps?: readonly AppRow[];
	readonly keys: () => readonly KeyRow[];
	readonly revoked?: (id: ApiKeyId) => void;
	readonly revokedApp?: (id: ConnectedAppId) => void;
	readonly created?: (request: CreateRequest) => void;
}) => {
	const queries: string[] = [];
	const ryotql = makeRyotQLApi({
		execute: (_scope, request) => {
			const [[name, query] = []] = Object.entries(bindTestRequest(request.payload).queries);
			if ((name !== "keys" && name !== "apps") || query?.output.type !== "rows") {
				return Effect.die("Expected a credential rows query");
			}
			queries.push(name);
			return Effect.succeed({
				data: {
					[name]: {
						type: "rows" as const,
						items: name === "keys" ? options.keys() : (options.apps ?? []),
						pageInfo: { hasMore: false, nextCursor: null, limit: query.output.pagination.limit },
					},
				},
			});
		},
	});
	const account = makeAccountApi({
		revokeApiKey: (_scope, request) =>
			Effect.sync(() => options.revoked?.(request.params.apiKeyId)),
		revokeConnectedApp: (_scope, request) =>
			Effect.sync(() => options.revokedApp?.(request.params.connectedAppId)),
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
		createMemoryHistory({ initialEntries: ["/settings/access"] }),
	);
	render(<RouterProvider router={router} />);
	return { queries };
};

it.live(
	"creates a named key and shows its secret once",
	() =>
		Effect.gen(function* () {
			const requests: CreateRequest[] = [];
			let keys: readonly KeyRow[] = [];
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
			expect(requests).toEqual([
				{ payload: { name: "Laptop", expiresInDays: null, writeAccess: "confirm" } },
			]);
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

			const keys = yield* Effect.promise(() => screen.findByRole("list", { name: "API keys" }));
			const [home, old, forever] = within(keys).getAllByRole("listitem");
			expect(home.textContent).toContain("Allow changes without asking");
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
	"lists connected apps with their access and revokes one after confirmation",
	() =>
		Effect.gen(function* () {
			const revoked: ConnectedAppId[] = [];
			mountView({ keys: () => [], apps: [claudeApp], revokedApp: (id) => revoked.push(id) });
			const apps = yield* Effect.promise(() =>
				screen.findByRole("list", { name: "connected apps" }),
			);
			const [claude] = within(apps).getAllByRole("listitem");
			expect(claude.textContent).toContain("Ask before each change");
			expect(claude.textContent).toContain("Never used");
			fireEvent.click(screen.getByRole("button", { name: "Revoke Claude" }));
			const confirm = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: 'Revoke "Claude"?' }),
			);
			fireEvent.click(within(confirm).getByRole("button", { name: "Revoke access" }));
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
			expect(revoked).toEqual([ConnectedAppId.make("consent-1")]);
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
