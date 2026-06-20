import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	analyzeWorkflowDispatch,
	type DispatchContext,
	type DispatchFinding,
} from "#lib/test-support/workflow-dispatch-analysis";

const packageRoot = Bun.fileURLToPath(new URL("../../../", import.meta.url));

const pinnedContexts: ReadonlySet<DispatchContext> = new Set([
	"other",
	"activity",
	"service",
	"repository",
]);

// Baseline of transitive workflow dispatch reachable from services and other non-owning
// declarations. Sanctioned entry-point dispatches (a route-called service starting its own owning
// workflow) surface under the route/task/worker/workflow/layers contexts, are intentionally NOT
// pinned here, and remain pinned as baseline until the owner map says otherwise. The write-path
// owner map, the standard shape, and the sanctioned-entry-point rationale live in
// modules/automations/AGENTS.md ("Write-path ownership"). Adding a new service/Activity dispatch
// fails this test; removing a listed violation forces shrinking this array. "activity" and
// "repository" contexts are never permitted here (guarded separately below). Only
// file+symbol+context are pinned (kind and taint chain are not).
const BASELINE: ReadonlyArray<readonly [string, string, DispatchContext]> = [
	["app/server.ts", "ApiBaseLive", "other"],
	["app/server.ts", "ApiLive", "other"],
	["app/server.ts", "ApiWithScalarLive", "other"],
	["app/server.ts", "ScalarLive", "other"],
	["app/server.ts", "ServerLive", "other"],
	[
		"lib/infrastructure/sandbox-runtime/host-functions.ts",
		"makeAdditionalSandboxApiFunctions",
		"other",
	],
	[
		"lib/infrastructure/sandbox-runtime/notification-host-functions.ts",
		"makeNotificationSandboxApiFunctions",
		"other",
	],
	[
		"lib/infrastructure/sandbox-runtime/service.ts",
		"SandboxService.additionalApiFunctions",
		"service",
	],
	["modules/auth/service.ts", "AuthMiddlewareLive", "service"],
	["modules/auth/service.ts", "AuthService.auth", "service"],
	["modules/auth/service.ts", "makeAuthInstance", "service"],
	["modules/automations/lifecycle-dispatch.ts", "dispatchLifecycleSubscriptions", "other"],
	["modules/automations/lifecycle-dispatch.ts", "dispatchResolvedLifecycleSubscriptions", "other"],
	["modules/automations/signal-dispatch.ts", "dispatchSignalSubscriptions", "other"],
	["modules/automations/signal-dispatch.ts", "emitAndDispatchSignal", "other"],
	["modules/collections/service.ts", "CollectionsService.addToCollection", "service"],
	["modules/collections/service.ts", "CollectionsService.create", "service"],
	["modules/collections/service.ts", "CollectionsService.removeFromCollection", "service"],
	["modules/entity-import/population-trigger-live.ts", "EntityPopulationTriggerLive", "other"],
	["modules/entity-interest/service.ts", "InterestReconciler.handleRow", "service"],
	["modules/entity-interest/service.ts", "InterestReconciler.reconcile", "service"],
	["modules/entity-schemas/service.ts", "EntitySchemasService.create", "service"],
	["modules/entity-schemas/service.ts", "EntitySchemasService.search", "service"],
	["modules/entity-translation/service.ts", "TranslationsService.requestFill", "service"],
	["modules/events/service.ts", "EventsService.create", "service"],
	["modules/exercises/preload.ts", "BuiltinEntityPreloaderLive", "other"],
	["modules/god-mode/service.ts", "GodModeService.resetUser", "service"],
	["modules/god-mode/service.ts", "GodModeService.triggerInfrequentCron", "service"],
	["modules/imports/service.ts", "ImportsService.startFileImportRun", "service"],
	["modules/imports/service.ts", "ImportsService.startImportRun", "service"],
	["modules/imports/service.ts", "ImportsService.startSourcePayloadImportRun", "service"],
	["modules/integrations/service.ts", "IntegrationsService.handleWebhook", "service"],
	["modules/library-membership/service.ts", "LibraryImportService.importEntity", "service"],
	["modules/media-monitoring/service.ts", "MediaMonitoringService.disable", "service"],
	["modules/media-monitoring/service.ts", "MediaMonitoringService.enable", "service"],
	["modules/notifications/service.ts", "NotificationsService.test", "service"],
	["modules/sandbox/service.ts", "SandboxApiService.enqueue", "service"],
];

const keyOf = (file: string, symbol: string, context: string) => `${file}::${symbol}::${context}`;
const findingKey = (finding: DispatchFinding) =>
	keyOf(finding.file, finding.symbol, finding.context);
const byString = (a: string, b: string) => a.localeCompare(b);

it.effect("analyzer detects the seed workflow-dispatch violations it must never miss", () =>
	Effect.gen(function* () {
		const findings = yield* analyzeWorkflowDispatch(packageRoot);
		const has = (
			file: string,
			symbol: string,
			context: DispatchContext,
			kind: "direct" | "transitive",
		) =>
			findings.some(
				(finding) =>
					finding.file === file &&
					finding.symbol === symbol &&
					finding.context === context &&
					finding.kind === kind,
			);

		expect(findings.length).toBeGreaterThan(0);

		// Direct workflow dispatch at its owning boundary.
		expect(
			has(
				"modules/automations/subscription-execution-workflow.ts",
				"executeSubscriptionExecution",
				"workflow",
				"direct",
			),
			"expected direct workflow dispatch in subscription-execution-workflow.ts",
		).toBe(true);

		// EventsService.create transitively reaches EventCreateWorkflow dispatch.
		expect(
			has("modules/events/service.ts", "EventsService.create", "service", "transitive"),
			"expected transitive service dispatch for EventsService.create",
		).toBe(true);
	}),
);

it.effect("pins the Phase-1 baseline of service/Activity/other workflow dispatch", () =>
	Effect.gen(function* () {
		const findings = yield* analyzeWorkflowDispatch(packageRoot);
		const actual = new Set(
			findings.filter((finding) => pinnedContexts.has(finding.context)).map(findingKey),
		);
		const expected = new Set(
			BASELINE.map(([file, symbol, context]) => keyOf(file, symbol, context)),
		);

		const unexpected = [...actual].filter((key) => !expected.has(key)).sort(byString);
		const removed = [...expected].filter((key) => !actual.has(key)).sort(byString);

		expect(
			unexpected,
			`New service/Activity/other workflow dispatch introduced (add an owner or, if sanctioned, adjust the baseline):\n${unexpected.join("\n")}`,
		).toEqual([]);
		expect(
			removed,
			`Baseline violation no longer present (remove it from BASELINE):\n${removed.join("\n")}`,
		).toEqual([]);
	}),
);

// An Activity execute body or a repository must never start durable work (invariants 4 and 11:
// Activities are memoization boundaries, repositories persist rows only). This is independent of
// the pinned BASELINE: those contexts are never a sanctioned exception, so a single such finding
// fails the build even if someone were to add it to BASELINE.
it.effect("no workflow dispatch is reachable from an Activity body or a repository", () =>
	Effect.gen(function* () {
		const findings = yield* analyzeWorkflowDispatch(packageRoot);
		const forbidden = findings
			.filter((finding) => finding.context === "activity" || finding.context === "repository")
			.map(findingKey)
			.sort(byString);

		expect(
			forbidden,
			`Workflow dispatch reachable from an Activity body or a repository (dispatch from the workflow body instead):\n${forbidden.join("\n")}`,
		).toEqual([]);
	}),
);
