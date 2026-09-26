import { describe, expect, it } from "@effect/vitest";
import type {
	ContractPathParams,
	ContractPayload,
	ContractSuccess,
} from "@ryot-app/contract/client";
import { PluginId, PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makePluginInstallationsApi, makeSavedViewsApi } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import type { CustomizePlan } from "#/modules/navigation/customize/customize-plan";
import { CustomizeSidebarService } from "#/modules/navigation/customize/service";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

type Call =
	| { readonly kind: "reorder"; readonly payload: ContractPayload<"savedViews", "reorder"> }
	| {
			readonly kind: "update";
			readonly payload: ContractPayload<"savedViews", "update">;
			readonly params: ContractPathParams<"savedViews", "update">;
	  }
	| {
			readonly kind: "workspace";
			readonly payload: ContractPayload<"plugins", "updatePluginState">;
			readonly params: ContractPathParams<"plugins", "updatePluginState">;
	  };

const savedView: ContractSuccess<"savedViews", "update"> = { id: SavedViewId.make("view-1") };

const installation: ContractSuccess<"plugins", "updatePluginState"> = {
	id: "installation-1",
	pluginId: PluginId.make("plugin-1"),
};

const authFailure = Effect.fail(new AuthenticatedApiError({ cause: "boom" }));

const makeApi = (calls: Call[], fail?: Call["kind"]) =>
	Layer.mergeAll(
		makeSavedViewsApi({
			update: (_scope, request) => {
				calls.push({ kind: "update", ...request });
				return fail === "update" ? authFailure : Effect.succeed(savedView);
			},
			reorder: (_scope, request) => {
				calls.push({ kind: "reorder", ...request });
				return fail === "reorder"
					? authFailure
					: Effect.succeed({ viewSlugs: request.payload.viewSlugs });
			},
		}),
		makePluginInstallationsApi({
			update: (_scope, request) => {
				calls.push({ kind: "workspace", ...request });
				return fail === "workspace" ? authFailure : Effect.succeed(installation);
			},
		}),
	);

const plan: CustomizePlan = {
	reorders: [{ viewSlugs: ["all", "recent"] }],
	workspaceUpdates: [
		{ pluginSlug: PluginSlug.make("media"), payload: { sortOrder: 0, isDisabled: false } },
	],
	updates: [
		{ viewSlug: "shows", payload: { icon: "list", name: "Shows", isDisabled: true } },
		{ viewSlug: "all", payload: { name: "All", icon: "list", isDisabled: false } },
	],
};

describe("customize sidebar service", () => {
	it.effect("applies every visibility update before any reorder", () => {
		const calls: Call[] = [];

		return Effect.gen(function* () {
			const service = yield* CustomizeSidebarService;
			yield* service.save(scope, plan);

			expect(calls).toEqual([
				{
					kind: "update",
					params: { viewSlug: "shows" },
					payload: { icon: "list", name: "Shows", isDisabled: true },
				},
				{
					kind: "update",
					params: { viewSlug: "all" },
					payload: { name: "All", icon: "list", isDisabled: false },
				},
				{ kind: "reorder", payload: { viewSlugs: ["all", "recent"] } },
				{
					kind: "workspace",
					params: { pluginSlug: "media" },
					payload: { sortOrder: 0, isDisabled: false },
				},
			]);
		}).pipe(Effect.provide(CustomizeSidebarService.layer.pipe(Layer.provide(makeApi(calls)))));
	});

	it.effect("stops at the first failed update rather than reordering a half-applied plan", () => {
		const calls: Call[] = [];

		return Effect.gen(function* () {
			const service = yield* CustomizeSidebarService;
			const failure = yield* Effect.flip(service.save(scope, plan));

			expect(failure.stage).toBe("update");
			expect(calls.map((call) => call.kind)).toEqual(["update"]);
		}).pipe(
			Effect.provide(CustomizeSidebarService.layer.pipe(Layer.provide(makeApi(calls, "update")))),
		);
	});

	it.effect("reports a failed reorder as a reorder failure", () => {
		const calls: Call[] = [];

		return Effect.gen(function* () {
			const service = yield* CustomizeSidebarService;
			const failure = yield* Effect.flip(service.save(scope, plan));

			expect(failure.stage).toBe("reorder");
		}).pipe(
			Effect.provide(CustomizeSidebarService.layer.pipe(Layer.provide(makeApi(calls, "reorder")))),
		);
	});

	it.effect("reports a failed workspace update as a workspace failure", () => {
		const calls: Call[] = [];

		return Effect.gen(function* () {
			const service = yield* CustomizeSidebarService;
			const failure = yield* Effect.flip(service.save(scope, plan));

			expect(failure.stage).toBe("workspace");
			expect(calls.map((call) => call.kind)).toEqual(["update", "update", "reorder", "workspace"]);
		}).pipe(
			Effect.provide(
				CustomizeSidebarService.layer.pipe(Layer.provide(makeApi(calls, "workspace"))),
			),
		);
	});
});
