import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationHookSlug, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { randomUuid } from "@ryot-app/testing/random";
import { Duration, Effect } from "effect";

import {
	type AutomationRun,
	type AutomationRunAttempt,
	type Client,
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createEntity,
	type InstalledTestPlugin,
	installTestPluginBundle,
	listAutomationRunAttempts,
	pollAutomationRuns,
	pollTerminalAutomationRunAttempts,
	pollTerminalAutomationRuns,
	reconcileAutomations,
	testPluginEntitySchema,
	testPluginPackageId,
	type TestPluginScript,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type PluginScript = PluginManifest["scripts"][number];
type AutomationScript = { readonly entry: string } & Extract<
	TestPluginScript,
	{ kind: "automation"; automationType: "automation" }
>;
const RETRY_TARGET_SLUG = "retry-target";

type RetryPolicy = Extract<PluginManifest["hooks"][number], { stage: "after" }>["retry"];

const UNREACHABLE_URL = "http://127.0.0.1:1/e2e-retry";

const automationScript = (
	slug: string,
	entry: string,
	capabilities: ReadonlyArray<NonNullable<PluginScript["capabilities"]>[number]>,
): AutomationScript => ({
	slug,
	entry,
	capabilities,
	kind: "automation",
	oauthConnectionFields: [],
	executableDependencies: [],
	automationType: "automation",
	optionalPluginConfigKeys: [],
	name: `E2E retry automation ${slug}`,
	requiredPluginConfigKeys: capabilities.includes("getPluginConfig") ? ["marker"] : [],
	inputProjection: {
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

const claimedRetryableSource = (slug: string, revision: string) => `
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => Effect.gen(function* () {
    const claim = yield* host.claimPersistentValue(
      "e2e-retry:" + automation.runId,
      { runId: automation.runId },
      600,
    );
    const config = yield* host.getPluginConfig({ required: ["marker"] });
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
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
});

export default defineAutomation({
  manifest,
  run: (_input, host) =>
    host.httpCall("GET", ${JSON.stringify(UNREACHABLE_URL)}).pipe(Effect.as(null)),
});
`;

const terminalFailureSource = (slug: string) => `
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  name: ${JSON.stringify(`E2E retry automation ${slug}`)},
  slug: ${JSON.stringify(slug)},
  inputProjection: { entity: { properties: [], compareProperties: [], parentEntityProperties: [] } },
});

export default defineAutomation({
  manifest,
  run: () => Effect.fail(new Error("E2E terminal business failure")),
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
		entitySchemas: [testPluginEntitySchema({ slug: RETRY_TARGET_SLUG })],
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
				targets: [{ resource: "entity", operation: "create", entitySchemaSlug: RETRY_TARGET_SLUG }],
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

const createTargetRun = (
	client: Client,
	fixture: Pick<Effect.Success<ReturnType<typeof installRetryFixture>>, "hookSlug" | "installed">,
	name = `Retry target ${crypto.randomUUID()}`,
) =>
	Effect.gen(function* () {
		const entity = yield* createEntity(client, {
			name,
			properties: {},
			entitySchema: {
				slug: EntitySchemaSlug.make(RETRY_TARGET_SLUG),
				owner: definitionOwner(fixture.installed.pluginId),
			},
		});
		const runs = yield* pollAutomationRuns({
			hookSlug: fixture.hookSlug,
			sourceRecord: { id: entity.id, resource: "entity" },
		});
		return requirePresent(runs[0], `Missing retry run for target '${entity.id}'`);
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

			const initial = yield* createTargetRun(client, fixture);
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

			const initial = yield* createTargetRun(client, fixture);
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

			const initial = yield* createTargetRun(client, fixture);
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

	it.live("rejects automatic HTTP retries without run-id idempotency", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginSlug = `e2e-unsafe-http-retry-${yield* randomUuid}`;
			const packageId = testPluginPackageId();
			const scriptSlug = `automation.${pluginSlug}`;
			const entry = `backend/automations/${scriptSlug}.sandbox.ts`;
			const failure = yield* Effect.flip(
				installTestPluginBundle({
					client,
					packageId,
					pluginSlug,
					files: { [entry]: alwaysRetryableFailureSource(scriptSlug) },
					scripts: [automationScript(scriptSlug, entry, ["httpCall"])],
					entitySchemas: [testPluginEntitySchema({ slug: RETRY_TARGET_SLUG })],
					hooks: [
						{
							scriptSlug,
							stage: "after",
							delivery: "async",
							name: "Unsafe HTTP retry",
							slug: `unsafe-http-retry-${yield* randomUuid}`,
							targets: [
								{ resource: "entity", operation: "create", entitySchemaSlug: RETRY_TARGET_SLUG },
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
				)).some((candidate) => candidate.packageId === packageId),
			).toBe(false);
		}),
	);
});
