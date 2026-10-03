import { describe, expect, layer } from "@effect/vitest";
import type {
	ContractPathParams,
	ContractPayload,
	ContractSuccess,
} from "@ryot-app/contract/client";
import { PluginId, PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

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

class FakeCustomizeApis extends Context.Service<
	FakeCustomizeApis,
	{ readonly calls: Effect.Effect<ReadonlyArray<Call>> }
>()("test/FakeCustomizeApis") {}

const customizeLayer = (fail?: Call["kind"]) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<Call>>([]);
			const record = <A>(call: Call, succeed: A) =>
				Ref.update(calls, (all) => [...all, call]).pipe(
					Effect.andThen(fail === call.kind ? authFailure : Effect.succeed(succeed)),
				);
			return Layer.merge(
				CustomizeSidebarService.layer.pipe(
					Layer.provide(
						Layer.mergeAll(
							makeSavedViewsApi({
								update: (_scope, request) => record({ kind: "update", ...request }, savedView),
								reorder: (_scope, request) =>
									record({ kind: "reorder", ...request }, { viewSlugs: request.payload.viewSlugs }),
							}),
							makePluginInstallationsApi({
								update: (_scope, request) =>
									record({ kind: "workspace", ...request }, installation),
							}),
						),
					),
				),
				Layer.succeed(FakeCustomizeApis, { calls: Ref.get(calls) }),
			);
		}),
	);

const plan: CustomizePlan = {
	reorders: [{ viewSlugs: ["all", "recent"] }],
	workspaceUpdates: [
		{ pluginSlug: PluginSlug.make("media"), payload: { sortOrder: 0, isHidden: false } },
	],
	updates: [
		{ viewSlug: "shows", payload: { icon: "list", name: "Shows", isHidden: true } },
		{ viewSlug: "all", payload: { name: "All", icon: "list", isHidden: false } },
	],
};

describe("customize sidebar service", () => {
	layer(customizeLayer())((test) => {
		test.effect("applies every visibility update before any reorder", () =>
			Effect.gen(function* () {
				const service = yield* CustomizeSidebarService;
				yield* service.save(scope, plan);

				expect(yield* (yield* FakeCustomizeApis).calls).toEqual([
					{
						kind: "update",
						params: { viewSlug: "shows" },
						payload: { icon: "list", name: "Shows", isHidden: true },
					},
					{
						kind: "update",
						params: { viewSlug: "all" },
						payload: { name: "All", icon: "list", isHidden: false },
					},
					{ kind: "reorder", payload: { viewSlugs: ["all", "recent"] } },
					{
						kind: "workspace",
						params: { pluginSlug: "media" },
						payload: { sortOrder: 0, isHidden: false },
					},
				]);
			}),
		);
	});

	layer(customizeLayer("update"))((test) => {
		test.effect("stops at the first failed update rather than reordering a half-applied plan", () =>
			Effect.gen(function* () {
				const service = yield* CustomizeSidebarService;
				const failure = yield* Effect.flip(service.save(scope, plan));

				expect(failure.stage).toBe("update");
				expect((yield* (yield* FakeCustomizeApis).calls).map((call) => call.kind)).toEqual([
					"update",
				]);
			}),
		);
	});

	layer(customizeLayer("reorder"))((test) => {
		test.effect("reports a failed reorder as a reorder failure", () =>
			Effect.gen(function* () {
				const service = yield* CustomizeSidebarService;
				const failure = yield* Effect.flip(service.save(scope, plan));

				expect(failure.stage).toBe("reorder");
			}),
		);
	});

	layer(customizeLayer("workspace"))((test) => {
		test.effect("reports a failed workspace update as a workspace failure", () =>
			Effect.gen(function* () {
				const service = yield* CustomizeSidebarService;
				const failure = yield* Effect.flip(service.save(scope, plan));

				expect(failure.stage).toBe("workspace");
				expect((yield* (yield* FakeCustomizeApis).calls).map((call) => call.kind)).toEqual([
					"update",
					"update",
					"reorder",
					"workspace",
				]);
			}),
		);
	});
});
