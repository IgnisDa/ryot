import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { AutomationHookSlug } from "@ryot-app/contract/schema/brands";
import { automationHistoryRunRecipe } from "@ryot-app/ryotql-recipes/automation-history";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Duration, Effect, Option } from "effect";

import {
	createAuthenticatedClient,
	collectRyotQLRecipeItems,
	createEntity,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	installTestPluginBundle,
	listAutomationRunAttempts,
	listAutomationRuns,
	type AutomationRun,
	type AutomationRunAttempt,
	pollAutomationRuns,
	pollTerminalAutomationRunAttempts,
	pollTerminalAutomationRuns,
	reconcileAutomations,
	reinstallTestPluginScript,
	type Client,
	type InstalledTestPlugin,
	uninstallTestPlugin,
	uninstallTestPluginStrict,
	updatePluginState,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type PluginScript = PluginManifest["scripts"][number];
type AutomationScript = Extract<PluginScript, { kind: "automation"; automationType: "automation" }>;
type RetryPolicy = Extract<PluginManifest["hooks"][number], { stage: "after" }>["retry"];

const UNREACHABLE_URL = "http://127.0.0.1:1/e2e-retry";

const collectionProperties = {
	membershipPropertiesSchema: {},
	description: "Automation retry fixture",
};

const automationScript = (
	slug: string,
	entry: string,
	capabilities: ReadonlyArray<PluginScript["capabilities"][number]>,
): AutomationScript => ({
	slug,
	entry,
	capabilities,
	kind: "automation",
	automationType: "automation",
	requiredSystemConfigKeys: [],
	name: `E2E retry automation ${slug}`,
	requiredPluginConfigKeys: capabilities.includes("getPluginConfig") ? ["marker"] : [],
	inputProjection: {
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

const claimedRetryableSource = (slug: string, revision: string) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  capabilities: ["claimPersistentValue", "getPluginConfig", "httpCall"],
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
  requiredPluginConfigKeys: ["marker"],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => Effect.gen(function* () {
    const claim = yield* host.claimPersistentValue(
      "e2e-retry:" + automation.runId,
      { runId: automation.runId },
      600,
    );
    const config = yield* host.getPluginConfig(["marker"]);
    if (typeof config.marker !== "string") {
      return yield* Effect.die("Missing retry marker");
    }
    if (claim.claimed) {
      yield* host.httpCall("GET", ${JSON.stringify(UNREACHABLE_URL)});
    }
    return { marker: config.marker, revision: ${JSON.stringify(revision)} };
  }),
});
`;

const alwaysRetryableFailureSource = (slug: string) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  capabilities: ["httpCall"],
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: (_input, host) =>
    host.httpCall("GET", ${JSON.stringify(UNREACHABLE_URL)}).pipe(Effect.as(null)),
});
`;

const terminalFailureSource = (slug: string, capabilities: ReadonlyArray<string> = []) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  capabilities: ${JSON.stringify(capabilities)},
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: () => Effect.fail(new Error("E2E terminal business failure")),
});
`;

const immediateSuccessSource = (slug: string) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  capabilities: ["claimPersistentValue", "getPluginConfig", "httpCall"],
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
  requiredPluginConfigKeys: ["marker"],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: () => Effect.succeed({ marker: "replacement", revision: "B" }),
});
`;

const installRetryFixture = (
	client: Client,
	input: {
		source: string;
		retry: RetryPolicy;
		capabilities: ReadonlyArray<PluginScript["capabilities"][number]>;
	},
) => {
	const suffix = crypto.randomUUID();
	const pluginSlug = `e2e-retry-${suffix}`;
	const scriptSlug = `automation.e2e-retry-${suffix}`;
	const hookSlug = AutomationHookSlug.make(`e2e-retry-hook-${suffix}`);
	const entry = `backend/automations/${scriptSlug}.sandbox.ts`;
	const script = automationScript(scriptSlug, entry, input.capabilities);
	return installTestPluginBundle({
		client,
		pluginSlug,
		scripts: [script],
		config: { marker: "alpha" },
		files: { [entry]: input.source.replaceAll("__SCRIPT_SLUG__", scriptSlug) },
		configSchema: {
			unknownKeys: "strict",
			fields: {
				marker: {
					type: "string",
					label: "Marker",
					validation: { required: true },
					description: "Pinned retry configuration marker",
				},
			},
		},
		hooks: [
			{
				scriptSlug,
				stage: "after",
				slug: hookSlug,
				delivery: "async",
				retry: input.retry,
				name: "E2E retry hook",
				causationSources: ["api"],
				targets: [{ resource: "entity", operation: "create", entitySchemaSlug: "collection" }],
			},
		],
	}).pipe(Effect.map((installed) => ({ script, hookSlug, installed })));
};

const installRetryFixtureScoped = (
	client: Client,
	input: Parameters<typeof installRetryFixture>[1],
) =>
	Effect.acquireRelease(installRetryFixture(client, input), ({ installed }) =>
		uninstallTestPlugin(installed),
	);

const createCollectionRun = (
	client: Client,
	hookSlug: AutomationHookSlug,
	name = `Retry collection ${crypto.randomUUID()}`,
) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaBySlug(client, "collection");
		const entity = yield* createEntity(client, {
			name,
			entitySchemaSlug: schema.id,
			properties: collectionProperties,
		});
		const runs = yield* pollAutomationRuns({
			hookSlug,
			sourceRecord: { id: entity.id, resource: "entity" },
		});
		return requirePresent(runs[0], `Missing retry run for collection '${entity.id}'`);
	});

const ascendingAttempts = (attempts: ReadonlyArray<AutomationRunAttempt>) =>
	[...attempts].sort((left, right) => left.attemptNumber - right.attemptNumber);

const expectRetryableAttempt = (attempt: AutomationRunAttempt) => {
	expect(attempt).toMatchObject({
		retryable: true,
		status: "failed",
		failureKind: "external-uncertain-outcome",
		error: { code: "external-uncertain-outcome" },
	});
};

const expectOriginalPins = (run: AutomationRun, plugin: InstalledTestPlugin) => {
	assertPresent(plugin.configRevisionId, "Retry fixture must have a pinned config revision");
	expect(run).toMatchObject({
		pluginId: plugin.pluginId,
		sandboxScriptId: plugin.scriptId,
		pluginRevisionId: plugin.activePluginRevisionId,
		pluginConfigRevisionId: plugin.configRevisionId,
	});
};

describe("automation retries", () => {
	it.live("retries a transient first attempt and succeeds with one pinned run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* installRetryFixtureScoped(client, {
				source: claimedRetryableSource("__SCRIPT_SLUG__", "A"),
				capabilities: ["claimPersistentValue", "getPluginConfig", "httpCall"],
				retry: {
					maxAttempts: 2,
					maxDelayMs: 2_000,
					initialDelayMs: 1_000,
					externalIdempotency: "run-id",
				},
			});

			const initial = yield* createCollectionRun(client, fixture.hookSlug);
			yield* pollTerminalAutomationRunAttempts({ runId: initial.id });
			yield* Effect.sleep(Duration.millis(1_100));
			yield* reconcileAutomations;
			const run = requirePresent(
				(yield* pollTerminalAutomationRuns({ triggerId: initial.triggerId }))[0],
				"Missing terminal retry run",
			);
			const attempts = ascendingAttempts(
				yield* pollTerminalAutomationRunAttempts({ runId: run.id }, 2),
			);

			expect(run).toMatchObject({ attemptCount: 2, status: "succeeded", nextAttemptAt: null });
			expect(attempts.map(({ status, attemptNumber }) => ({ status, attemptNumber }))).toEqual([
				{ attemptNumber: 1, status: "failed" },
				{ attemptNumber: 2, status: "succeeded" },
			]);
			expectRetryableAttempt(requirePresent(attempts[0], "Missing first retry attempt"));
			expectOriginalPins(run, fixture.installed);
		}),
	);

	it.live("does not retry a terminal business failure", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* installRetryFixtureScoped(client, {
				capabilities: [],
				source: terminalFailureSource("__SCRIPT_SLUG__"),
				retry: {
					maxAttempts: 3,
					maxDelayMs: 2_000,
					initialDelayMs: 1_000,
					externalIdempotency: "none",
				},
			});

			const initial = yield* createCollectionRun(client, fixture.hookSlug);
			const run = requirePresent(
				(yield* pollTerminalAutomationRuns({ triggerId: initial.triggerId }))[0],
				"Missing terminal business-failure run",
			);
			yield* Effect.sleep(Duration.seconds(3));
			const attempts = yield* listAutomationRunAttempts({ runId: run.id });

			expect(run).toMatchObject({ attemptCount: 1, status: "failed", nextAttemptAt: null });
			expect(attempts).toHaveLength(1);
			expect(attempts[0]).toMatchObject({
				status: "failed",
				retryable: false,
				failureKind: "business-failure",
				error: { code: "business-failure" },
			});
		}),
	);

	it.live("marks the run failed after exhausting the authored attempt limit", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* installRetryFixtureScoped(client, {
				capabilities: ["httpCall"],
				source: alwaysRetryableFailureSource("__SCRIPT_SLUG__"),
				retry: {
					maxAttempts: 2,
					maxDelayMs: 2_000,
					initialDelayMs: 1_000,
					externalIdempotency: "run-id",
				},
			});

			const initial = yield* createCollectionRun(client, fixture.hookSlug);
			yield* pollTerminalAutomationRunAttempts({ runId: initial.id });
			yield* Effect.sleep(Duration.millis(1_100));
			yield* reconcileAutomations;
			const run = requirePresent(
				(yield* pollTerminalAutomationRuns({ triggerId: initial.triggerId }))[0],
				"Missing exhausted retry run",
			);
			const attempts = ascendingAttempts(
				yield* pollTerminalAutomationRunAttempts({ runId: run.id }, 2),
			);

			expect(run).toMatchObject({ attemptCount: 2, status: "failed", nextAttemptAt: null });
			expect(attempts.map(({ attemptNumber }) => attemptNumber)).toEqual([1, 2]);
			for (const attempt of attempts) {
				expectRetryableAttempt(attempt);
			}
		}),
	);

	it.live("manually retries retained pins after upgrade, disable, and uninstall", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* installRetryFixtureScoped(client, {
				source: claimedRetryableSource("__SCRIPT_SLUG__", "A"),
				capabilities: ["claimPersistentValue", "getPluginConfig", "httpCall"],
				retry: {
					maxAttempts: 1,
					maxDelayMs: 1_000,
					initialDelayMs: 1_000,
					externalIdempotency: "run-id",
				},
			});
			const initialRuns = yield* Effect.forEach(
				["upgrade", "disable", "uninstall"],
				(label) => createCollectionRun(client, fixture.hookSlug, `Retry after ${label}`),
				{ concurrency: "unbounded" },
			);
			const runs = yield* Effect.forEach(initialRuns, (run) =>
				pollTerminalAutomationRuns({ triggerId: run.triggerId }).pipe(
					Effect.map((terminal) => requirePresent(terminal[0], `Missing terminal run '${run.id}'`)),
				),
			);
			for (const run of runs) {
				expect(run).toMatchObject({ attemptCount: 1, status: "failed" });
				expectOriginalPins(run, fixture.installed);
				const firstAttempts = yield* listAutomationRunAttempts({ runId: run.id });
				expect(firstAttempts).toHaveLength(1);
				expectRetryableAttempt(
					requirePresent(firstAttempts[0], `Missing initial attempt for '${run.id}'`),
				);
			}

			const replacement = yield* reinstallTestPluginScript(
				fixture.installed.scriptId,
				immediateSuccessSource(fixture.installed.slug),
				fixture.script,
			);
			expect(replacement.activePluginRevisionId).not.toBe(fixture.installed.activePluginRevisionId);
			expect(replacement.scriptId).not.toBe(fixture.installed.scriptId);
			yield* updatePluginState(client, replacement.pluginSlug, { config: { marker: "beta" } });

			const retry = (run: (typeof runs)[number]) =>
				Effect.gen(function* () {
					const history = requirePresent(
						Option.getOrUndefined(
							yield* executeRyotQLRecipe(client, automationHistoryRunRecipe({ id: run.id })),
						),
						`Missing retry history for '${run.id}'`,
					);
					expect(history.retryEligibility).toEqual({ reason: null });
					const queued = yield* client.call((c) =>
						c.automationHistory.retryRun({
							params: { runId: run.id },
							payload: { expectedAttemptCount: history.run.attemptCount },
						}),
					);
					expect(queued).toMatchObject({ runId: run.id, attemptNumber: 2 });
					const attempts = ascendingAttempts(
						yield* pollTerminalAutomationRunAttempts({ runId: run.id }, 2),
					);
					const successfulAttempt = requirePresent(attempts[1], "Missing successful retry attempt");
					expect(successfulAttempt.error).toBeNull();
					expect(successfulAttempt).toMatchObject({ status: "succeeded" });
					const retained = requirePresent(
						(yield* listAutomationRuns({ triggerId: run.triggerId }))[0],
						`Missing retained run '${run.id}'`,
					);
					expect(retained).toMatchObject({ attemptCount: 2, status: "succeeded" });
					expectOriginalPins(retained, fixture.installed);
				});

			const upgradeRun = requirePresent(runs[0], "Missing upgrade retry run");
			const disableRun = requirePresent(runs[1], "Missing disable retry run");
			const uninstallRun = requirePresent(runs[2], "Missing uninstall retry run");
			yield* retry(upgradeRun);
			yield* updatePluginState(client, replacement.pluginSlug, { isDisabled: true });
			yield* retry(disableRun);
			yield* uninstallTestPluginStrict(replacement);
			fixture.installed.active = false;
			yield* retry(uninstallRun);
		}),
	);

	it.live("rejects automatic HTTP retries without run-id idempotency", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = `e2e-unsafe-http-retry-${crypto.randomUUID()}`;
			const scriptSlug = `automation.${pluginSlug}`;
			const entry = `backend/automations/${scriptSlug}.sandbox.ts`;
			const failure = yield* Effect.flip(
				installTestPluginBundle({
					client,
					pluginSlug,
					scripts: [automationScript(scriptSlug, entry, ["httpCall"])],
					files: { [entry]: terminalFailureSource(scriptSlug, ["httpCall"]) },
					hooks: [
						{
							scriptSlug,
							stage: "after",
							delivery: "async",
							name: "Unsafe HTTP retry",
							slug: `unsafe-http-retry-${crypto.randomUUID()}`,
							targets: [
								{ resource: "entity", operation: "create", entitySchemaSlug: "collection" },
							],
							retry: {
								maxAttempts: 2,
								maxDelayMs: 2_000,
								initialDelayMs: 1_000,
								externalIdempotency: "none",
							},
						},
					],
				}),
			);

			assertTaggedError(failure, "PluginArchiveError");
			expect(failure.reason).toBe("manifest-invalid");
			expect(
				(yield* collectRyotQLRecipeItems(client, (after) =>
					pluginInstallationsRecipe({ after, limit: 100 }),
				)).some(({ slug }) => slug === pluginSlug),
			).toBe(false);
		}),
	);
});
