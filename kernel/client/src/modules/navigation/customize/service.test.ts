import { describe, expect, it } from "@effect/vitest";
import type {
	ContractClient,
	ContractPathParams,
	ContractPayload,
} from "@ryot-app/contract/client";
import { Effect, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
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
	  };

type UpdateRequest = {
	readonly payload: ContractPayload<"savedViews", "update">;
	readonly params: ContractPathParams<"savedViews", "update">;
};
type ReorderRequest = { readonly payload: ContractPayload<"savedViews", "reorder"> };

const makeApi = (calls: Call[], fail?: Call["kind"]) => {
	const update = (request: UpdateRequest): Effect.Effect<unknown, unknown> => {
		calls.push({ kind: "update", ...request });
		return fail === "update" ? Effect.fail("boom") : Effect.succeed({});
	};
	const reorder = (request: ReorderRequest): Effect.Effect<unknown, unknown> => {
		calls.push({ kind: "reorder", ...request });
		return fail === "reorder" ? Effect.fail("boom") : Effect.succeed({});
	};
	// A ContractProgram is always handed a whole ContractClient, so a fake implementing only the
	// methods under test cannot be produced without asserting over the other contract groups.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const client = { savedViews: { update, reorder } } as ContractClient;
	return Layer.succeed(AuthenticatedApi, {
		run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
			program(client).pipe(
				Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
			),
	});
};

const plan: CustomizePlan = {
	reorders: [{ viewSlugs: ["all", "recent"] }],
	updates: [
		{ viewSlug: "shows", payload: { icon: "list", name: "Shows", isDisabled: true } },
		{ viewSlug: "all", payload: { icon: "list", name: "All", isDisabled: false } },
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
					payload: { icon: "list", name: "All", isDisabled: false },
				},
				{ kind: "reorder", payload: { viewSlugs: ["all", "recent"] } },
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
});
