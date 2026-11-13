import { expect } from "bun:test";

import {
	PluginConflictError,
	type PluginInspection,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Layer, ManagedRuntime } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { PluginInstallationsApi } from "#/api/plugin-installations";
import {
	KernelApiTestLayer,
	makePluginInstallationsApi,
	makeRyotQLApi,
	makeUploadsApi,
} from "#/api/ports.test-layer";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { pluginBridgeServicesTestLayer } from "#/modules/pages/bridge/services.test-layer";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { makePluginCatalog } from "#/modules/plugins/catalog/service.test-layer";
import { PluginManagementService } from "#/modules/plugins/management/service";
import { getRouter } from "#/router";
import {
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
	makeUserSettingsStub,
	ManagedAssetRouteStubs,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	OAuthRouteStubs,
	PagesApiRouteStubs,
	ProviderAddRouteStubs,
	ServerStub,
	theme,
} from "#/routes/-route-fixtures";

const inspection: PluginInspection = {
	metadata: {
		icon: "puzzle",
		version: "1.2.0",
		name: "Whiskey Shelf",
		description: "Tracks tastings.",
		packageId: PluginPackageId.make("test/whiskey"),
	},
	configSchema: {
		unknownKeys: "strict",
		fields: {
			region: {
				type: "string",
				label: "Region",
				description: "Region",
				validation: { required: true },
			},
		},
	},
	operations: [
		{
			auth: "user",
			slug: "log-tasting",
			title: "Log tasting",
			description: "Records a tasting.",
			hints: { readOnly: false, idempotent: false, destructive: false },
		},
	],
};

const fileListOf = (file: File) => ({
	0: file,
	length: 1,
	item: (index: number) => (index === 0 ? file : null),
});

const uploads = makeUploadsApi({
	putBytes: () => Effect.void,
	completeIntent: () => Effect.succeed({ token: "upload_1", expiresAt: "2099-01-01T00:00:00Z" }),
	createIntent: () =>
		Effect.succeed({
			headers: {},
			intentId: "intent_1",
			method: "PUT" as const,
			uploadUrl: "/uploads/local/put",
			expiresAt: "2099-01-01T00:00:00Z",
		}),
});

const noInstallations = makeRyotQLApi({
	execute: () =>
		Effect.succeed({
			data: {
				installations: {
					items: [],
					type: "rows" as const,
					pageInfo: { limit: 100, hasMore: false, nextCursor: null },
				},
			},
		}),
});

const mountView = (api: Partial<PluginInstallationsApi["Service"]>) => {
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(),
			InstanceAdminRouteStubs,
			ServerStub,
			ManagedAssetRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			noInstallations,
			PagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makeUserSettingsStub(),
			makePluginCatalogEventsTestLayer().layer,
			makePluginCatalog(catalog),
			DeviceRouteStubs,
			NavigationRouteStubs,
			CustomizeRouteStubs,
			pluginBridgeServicesTestLayer,
			uploads,
			PluginManagementService.layer.pipe(Layer.provide(makePluginInstallationsApi(api))),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(makeStorageStubLayer("fixture")),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: ["/settings/plugins"] }),
	);
	return render(<RouterProvider router={router} />);
};

const chooseArchive = Effect.gen(function* () {
	fireEvent.click(
		yield* Effect.promise(() => screen.findByRole("button", { name: "Install plugin" })),
	);
	const wizard = within(yield* Effect.promise(() => screen.findByRole("dialog")));
	fireEvent.click(wizard.getByRole("button", { name: "Choose a file for Plugin archive" }));
	const input = yield* Effect.promise(() =>
		waitFor(() => {
			const found = document.querySelector('input[type="file"]');
			if (!(found instanceof HTMLInputElement)) {
				throw new Error("the file chooser was never mounted");
			}
			return found;
		}),
	);
	const archive = new File([new Uint8Array([80, 75, 3, 4])], "whiskey.zip", {
		type: "application/zip",
	});
	fireEvent.change(input, { target: { files: fileListOf(archive) } });
	yield* Effect.promise(() => wizard.findByText("4 B · Ready to review"));
	fireEvent.click(wizard.getByRole("button", { name: "Continue" }));
	return wizard;
});

it.live(
	"installs an inspected archive with initial configuration only after the risks are acknowledged",
	() =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			mountView({
				inspect: (_scope, request) => {
					calls.push({ inspect: request.payload });
					return Effect.succeed(inspection);
				},
				install: (_scope, request) => {
					calls.push({ install: request.payload });
					return Effect.succeed({
						id: "installation",
						activationId: "activation",
						pluginId: PluginId.make("plugin"),
					});
				},
			});
			const wizard = yield* chooseArchive;

			yield* Effect.promise(() => wizard.findByText("Whiskey Shelf"));
			expect(wizard.getByText("test/whiskey")).toBeTruthy();
			expect(wizard.getByText("Log tasting")).toBeTruthy();
			expect(wizard.getByText("Changes data")).toBeTruthy();
			expect(wizard.getByText("It can contact any server on the internet.")).toBeTruthy();
			const proceed = wizard.getByRole("button", { name: "Continue" });
			expect(proceed.hasAttribute("disabled")).toBe(true);
			fireEvent.click(
				wizard.getByLabelText("I understand these risks and trust this plugin's publisher."),
			);
			fireEvent.click(proceed);

			fireEvent.click(
				yield* Effect.promise(() => wizard.findByRole("button", { name: "Install plugin" })),
			);
			yield* Effect.promise(() => wizard.findByText("Region is required"));
			expect(calls).toEqual([{ inspect: { uploadToken: "upload_1" } }]);
			fireEvent.change(wizard.getByLabelText("Region"), { target: { value: "eu" } });
			fireEvent.click(wizard.getByRole("button", { name: "Install plugin" }));

			yield* Effect.promise(() =>
				screen.findByText("Plugin installed. It finishes setting up in the background."),
			);
			expect(screen.queryByRole("dialog")).toBeNull();
			expect(calls).toEqual([
				{ inspect: { uploadToken: "upload_1" } },
				{ install: { uploadToken: "upload_1", config: { region: "eu" } } },
			]);
		}),
	testTimeout,
);

it.live(
	"installs a plugin without configuration from the review step",
	() =>
		Effect.gen(function* () {
			const installs: unknown[] = [];
			mountView({
				inspect: () =>
					Effect.succeed({
						...inspection,
						configSchema: { fields: {}, unknownKeys: "strict" as const },
					}),
				install: (_scope, request) => {
					installs.push(request.payload);
					return Effect.succeed({
						id: "installation",
						activationId: "activation",
						pluginId: PluginId.make("plugin"),
					});
				},
			});
			const wizard = yield* chooseArchive;

			yield* Effect.promise(() => wizard.findByText("Step 2 of 2 · Review the plugin"));
			const install = wizard.getByRole("button", { name: "Install plugin" });
			expect(install.hasAttribute("disabled")).toBe(true);
			fireEvent.click(
				wizard.getByLabelText("I understand these risks and trust this plugin's publisher."),
			);
			fireEvent.click(install);

			yield* Effect.promise(() =>
				screen.findByText("Plugin installed. It finishes setting up in the background."),
			);
			expect(installs).toEqual([{ config: {}, uploadToken: "upload_1" }]);
		}),
	testTimeout,
);

it.live(
	"keeps the archive step open with the existing error copy when inspection is rejected",
	() =>
		Effect.gen(function* () {
			mountView({
				inspect: () =>
					Effect.fail(
						new AuthenticatedApiError({
							cause: new PluginConflictError({
								reason: {
									code: "already-installed",
									packageId: PluginPackageId.make("test/whiskey"),
								},
							}),
						}),
					),
			});
			const wizard = yield* chooseArchive;

			yield* Effect.promise(() => wizard.findByText("This package is already installed."));
			expect(wizard.queryByText("Only install plugins you trust")).toBeNull();
		}),
	testTimeout,
);
