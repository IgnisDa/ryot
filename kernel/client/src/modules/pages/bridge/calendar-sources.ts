import { CalendarSourceNotFound } from "@ryot-app/contract/modules/calendar-sources/schemas";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { CALENDAR_KERNEL_RENDERER_DISPLAY_NAME } from "@ryot-app/contract/modules/saved-views/schemas";
import type {
	PluginCalendarSourceVisibilityOutcome,
	PluginCalendarSourceVisibilityRequest,
} from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { CalendarSourcesApi } from "#/api/calendar-sources";
import type { ApiScope } from "#/api/scope";

const invalidRequest = { outcome: "failure", reason: "invalid-request" } as const;

// Limits the capability to the kernel calendar document; the server scopes the write to the user.
const isCalendarPage = (identity: PreparedClientPage["identity"]) =>
	identity.kind === "kernel-saved-view" &&
	identity.rendererName === CALENDAR_KERNEL_RENDERER_DISPLAY_NAME;

export class PluginCalendarSources extends Context.Service<PluginCalendarSources>()(
	"PluginCalendarSources",
	{
		make: Effect.gen(function* () {
			const api = yield* CalendarSourcesApi;
			const outcome = (
				scope: ApiScope,
				identity: PreparedClientPage["identity"],
				request: PluginCalendarSourceVisibilityRequest,
			): Effect.Effect<PluginCalendarSourceVisibilityOutcome> =>
				isCalendarPage(identity)
					? api
							.setVisibility(scope, { payload: request })
							.pipe(
								Effect.match({
									onSuccess: () => ({ outcome: "success" }) as const,
									onFailure: (error) =>
										error instanceof AuthenticatedApiError &&
										error.cause instanceof CalendarSourceNotFound
											? invalidRequest
											: ({ outcome: "failure", reason: "transport" } as const),
								}),
							)
					: Effect.succeed(invalidRequest);
			return { outcome };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
