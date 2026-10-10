import { describe, expect, layer } from "@effect/vitest";
import { CalendarSourceNotFound } from "@ryot-app/contract/modules/calendar-sources/schemas";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { CALENDAR_KERNEL_RENDERER_DISPLAY_NAME } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	CalendarSourceSlug,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makeCalendarSourcesApi } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import { PluginCalendarSources } from "#/modules/pages/bridge/calendar-sources";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const request = {
	isHidden: true,
	pluginId: PluginId.make("plugin-1"),
	slug: CalendarSourceSlug.make("reminders"),
};
const savedViewId = SavedViewId.make("view-1");
const base = {
	contributors: [],
	operationTargets: [],
	compositionKey: "composition-key",
	compositionHash: "composition-hash",
};
const kernelSavedView = (rendererName: string): PreparedClientPage["identity"] => ({
	...base,
	savedViewId,
	rendererName,
	viewRevision: 1,
	sourceHash: "source-hash",
	kind: "kernel-saved-view",
	target: { kind: "saved-view", reference: { kind: "kernel", slug: "calendar" } },
});
const calendarPage = kernelSavedView(CALENDAR_KERNEL_RENDERER_DISPLAY_NAME);
const pluginPage: PreparedClientPage["identity"] = {
	...base,
	exportName: "home",
	kind: "plugin-page",
	pluginId: "plugin-1",
	contentHash: "content-hash",
	installationId: "installation-1",
	target: {
		path: "/",
		search: "",
		kind: "plugin-route",
		packageId: PluginPackageId.make("test/fixture"),
	},
};

const kernelEntityPage: PreparedClientPage["identity"] = {
	...base,
	sourceHash: "source-hash",
	kind: "kernel-entity-page",
	rendererName: CALENDAR_KERNEL_RENDERER_DISPLAY_NAME,
	entitySchemaSlug: EntitySchemaSlug.make("collection"),
	target: { kind: "entity", entityId: EntityId.make("entity-1") },
};

const outcome = (identity: PreparedClientPage["identity"]) =>
	Effect.flatMap(PluginCalendarSources, (service) => service.outcome(scope, identity, request));

const recordingLayer = (
	calls: unknown[],
	result: Effect.Effect<typeof request, AuthenticatedApiError> = Effect.succeed(request),
) =>
	PluginCalendarSources.layer.pipe(
		Layer.provide(
			makeCalendarSourcesApi({
				setVisibility: (_scope, input) => {
					calls.push(input);
					return result;
				},
			}),
		),
	);

describe("calendar source visibility outcome", () => {
	const accepted: unknown[] = [];
	layer(recordingLayer(accepted))((test) => {
		test.effect("forwards a request from the kernel calendar document", () =>
			Effect.gen(function* () {
				expect(yield* outcome(calendarPage)).toEqual({ outcome: "success" });
				expect(accepted).toEqual([{ payload: request }]);
			}),
		);
	});

	const rejected: unknown[] = [];
	layer(recordingLayer(rejected))((test) => {
		test.effect("rejects plugin pages and other kernel renderers without calling the server", () =>
			Effect.gen(function* () {
				const invalid = { outcome: "failure", reason: "invalid-request" };
				expect(yield* outcome(pluginPage)).toEqual(invalid);
				expect(yield* outcome(kernelSavedView("Entity browser"))).toEqual(invalid);
				expect(yield* outcome(kernelEntityPage)).toEqual(invalid);
				expect(rejected).toEqual([]);
			}),
		);
	});

	layer(
		recordingLayer(
			[],
			Effect.fail(
				new AuthenticatedApiError({
					cause: new CalendarSourceNotFound({ reason: { code: "calendar-source-not-found" } }),
				}),
			),
		),
	)((test) => {
		test.effect("reports an unknown source as an invalid request", () =>
			Effect.gen(function* () {
				expect(yield* outcome(calendarPage)).toEqual({
					outcome: "failure",
					reason: "invalid-request",
				});
			}),
		);
	});

	layer(recordingLayer([], Effect.fail(new AuthenticatedApiError({ cause: "offline" }))))(
		(test) => {
			test.effect("reports other failures as transport", () =>
				Effect.gen(function* () {
					expect(yield* outcome(calendarPage)).toEqual({ outcome: "failure", reason: "transport" });
				}),
			);
		},
	);
});
