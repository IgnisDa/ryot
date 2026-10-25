import { expect, it } from "@effect/vitest";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/account/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { RyotProvider, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Deferred, Effect, ManagedRuntime } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { ServerOrigin } from "#/api/origin";
import { makeAccountApi } from "#/api/ports.test-layer";

import { preferencesQuery } from "./preferences-service";
import { ReportingTimeZoneInitialization } from "./reporting-time-zone";

function PreferencesProbe() {
	const preferences = useRyotQuery(preferencesQuery);
	return (
		<button type="button" onClick={preferences.refetch}>
			{preferences.data ? (preferences.data.reportingTimeZone ?? "unset") : "loading"}
		</button>
	);
}

it.live("uses initialization mode only once after enabled, loaded, and unset", () =>
	Effect.gen(function* () {
		const requests: UpdateUserPreferencesBody[] = [];
		const loaded = yield* Deferred.make<void>();
		let reportingTimeZone: null | string = "Pacific/Auckland";
		const runtime = ManagedRuntime.make(
			makeAccountApi({
				updatePreferences: (_scope, request) =>
					Effect.sync(() => requests.push(request.payload)).pipe(
						Effect.andThen(Effect.fail(new AuthenticatedApiError({ cause: "offline" }))),
					),
			}),
		);
		const clock = createTestRyotClock({
			query: () =>
				Deferred.await(loaded).pipe(
					Effect.map(() => ({
						data: {
							user: {
								type: "rows" as const,
								pageInfo: { limit: 1, hasMore: false, nextCursor: null },
								items: [
									{
										image: null,
										name: "User",
										id: UserId.make("user-1"),
										email: "user@example.test",
										preferences: { ...defaultUserPreferences, reportingTimeZone },
									},
								],
							},
						},
					})),
				),
		});
		const tree = (disabled: boolean) => (
			<RyotProvider
				runtime={clock.runtime}
				hostServices={{
					runtime,
					scope: { userId: "user-1", serverUrl: ServerOrigin.make("https://example.test") },
				}}
			>
				<ReportingTimeZoneInitialization disabled={disabled} />
				<PreferencesProbe />
			</RyotProvider>
		);
		const view = render(tree(false));
		yield* Effect.gen(function* () {
			expect(screen.getByRole("button", { name: "loading" })).toBeTruthy();
			expect(requests).toEqual([]);
			yield* Deferred.succeed(loaded, undefined);
			yield* Effect.promise(() => screen.findByRole("button", { name: "Pacific/Auckland" }));
			expect(requests).toEqual([]);
			view.rerender(tree(true));
			reportingTimeZone = null;
			fireEvent.click(screen.getByRole("button"));
			yield* Effect.promise(() => screen.findByRole("button", { name: "unset" }));
			expect(requests).toEqual([]);
			view.rerender(tree(false));
			const expected = [{ initializeReportingTimeZone: deviceTimeZone() }];
			yield* Effect.promise(() => waitFor(() => expect(requests).toEqual(expected)));
			fireEvent.click(screen.getByRole("button"));
			view.rerender(tree(true));
			view.rerender(tree(false));
			expect(requests).toEqual(expected);
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => view.unmount()).pipe(
					Effect.andThen(runtime.disposeEffect),
					Effect.andThen(clock.runtime.disposeEffect),
				),
			),
		);
	}),
);
