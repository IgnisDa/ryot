import { expect, layer } from "@effect/vitest";
import { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import {
	TranslateEntityWorkflow,
	type TranslateEntityWorkflowPayload,
} from "#modules/entities/localization/entity-translation-workflow";
import {
	type ProviderEntityPopulationPayload,
	ProviderEntityPopulationWorkflow,
} from "#modules/entities/providers/provider-entity-population-workflow";
import { ingestionTestRevision } from "#modules/imports/ingestion.test-support";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { makeWorkflowEngine } from "#testing/effect";

import { EnrichmentRecovery } from "./recovery";
import type { EnrichmentRequestPatch } from "./repository";
import { EnrichmentRequests } from "./requests";

type RequestRow = NonNullable<Effect.Success<ReturnType<EnrichmentRequests["Service"]["get"]>>>;
type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];
const now = new Date("2026-10-26T00:00:00.000Z");
const userId = UserId.make("recovery-user");
const account = { userId, token: "test-account-generation" };
const principal = Schema.decodeSync(ScriptExecutionPrincipal)({
	providerId: "provider",
	scriptId: "pinned-script",
	scriptSlug: "pinned-script",
	subject: { type: "system" },
	contentHash: "pinned-content",
	pluginRevision: ingestionTestRevision,
	metadata: { kind: "workflow", capabilities: [], runtimeImports: [] },
});
const command = (id: string) => ({
	...rootLifecycleCommand({
		itemIdentity: id,
		lane: "background",
		accountGeneration: null,
		source: "provider-refresh",
		occurredAt: now.toISOString(),
		initiator: { id: null, kind: "system" },
		executionId: AutomationExecutionId.make(id),
	}),
	writeContext: principal,
});
const populationPayload = (id: string): ProviderEntityPopulationPayload => ({
	level: "full",
	executionId: id,
	mode: "refresh",
	command: command(id),
	externalId: "record",
	pluginId: PluginId.make("plugin"),
	entityScope: { userId: null, type: "global" },
	providerId: SandboxProviderId.make("provider"),
	entitySchemaSlug: EntitySchemaSlug.make("record"),
});
const translationPayload = (id: string): TranslateEntityWorkflowPayload => ({
	userId,
	principal,
	language: "es",
	executionId: id,
	lane: "interactive",
	command: command(id),
	externalId: "record",
	contentGeneration: 1,
	entityScopeUserId: null,
	accountGeneration: account,
	entitySchemaSlug: "record",
	entitySchemaPluginId: "plugin",
	entityId: EntityId.make("entity"),
	providerId: SandboxProviderId.make("provider"),
});
const request = (id: string, patch: Partial<RequestRow> = {}): RequestRow => ({
	id,
	attempt: 0,
	sequence: 1,
	level: "full",
	retryOf: null,
	language: null,
	createdAt: now,
	state: "queued",
	observedAt: now,
	scopeUserId: null,
	failureKind: null,
	completedAt: null,
	entityId: "entity",
	pluginId: "plugin",
	dispatchRoot: true,
	nextAttemptAt: null,
	externalId: "record",
	requesterUserId: null,
	providerId: "provider",
	operation: "population",
	requesterGeneration: null,
	entitySchemaSlug: "record",
	registrationReleasedAt: null,
	sourceContentGeneration: null,
	payload: populationPayload(id),
	workflowName: ProviderEntityPopulationWorkflow._tag,
	...patch,
});

const harness = Effect.fnUntraced(function* (input: {
	readonly rows: ReadonlyArray<RequestRow>;
	readonly outcomes?: ReadonlyMap<string, Workflow.Result<unknown, SandboxRunError>>;
	readonly account?: Effect.Success<ReturnType<EnrichmentRequests["Service"]["account"]>>;
	readonly accountError?: DbError;
	readonly releaseFailsOnce?: boolean;
	readonly expired?: ReadonlyMap<
		string,
		NonNullable<Effect.Success<ReturnType<EnrichmentRequests["Service"]["expiredExecutionStatus"]>>>
	>;
}) {
	const rows = new Map(input.rows.map((row) => [row.id, row]));
	const observed: string[] = [];
	const releases: string[] = [];
	const released: string[] = [];
	const polls: Array<{ workflow: string; id: string }> = [];
	const executions: Array<{ workflow: string; options: ExecuteOptions }> = [];
	const updates: Array<{ id: string; patch: EnrichmentRequestPatch }> = [];
	const events: string[] = [];
	const requests = EnrichmentRequests.of({
		get: (id) => Effect.succeed(rows.get(id) ?? null),
		latest: () => Effect.die("Unexpected latest lookup"),
		lockTarget: () => Effect.die("Unexpected target lock"),
		ensure: () => Effect.die("Unexpected request admission"),
		attachEntity: () => Effect.die("Unexpected entity attachment"),
		prune: () =>
			Effect.sync(() => {
				events.push("prune");
			}),
		observed: (id) =>
			Effect.sync(() => {
				observed.push(id);
			}),
		expiredExecutionStatus: (id) => Effect.succeed(input.expired?.get(id) ?? null),
		pending: () =>
			Effect.sync(() => [...rows.values()].filter((row) => row.registrationReleasedAt === null)),
		account: () =>
			input.accountError
				? Effect.fail(input.accountError)
				: Effect.succeed(input.account === undefined ? account : input.account),
		update: (id, patch) =>
			Effect.sync(() => {
				updates.push({ id, patch });
				const row = rows.get(id);
				if (row) {
					rows.set(id, { ...row, ...patch });
				}
			}),
		released: (id) =>
			Effect.sync(() => {
				released.push(id);
				events.push(`released:${id}`);
				const row = rows.get(id);
				if (row) {
					rows.set(id, { ...row, registrationReleasedAt: now });
				}
			}),
	});
	const sandbox = ScriptExecutionService.of({
		enqueue: () => Effect.die("Unexpected sandbox enqueue"),
		getResult: () => Effect.die("Unexpected sandbox result"),
		executeScript: () => Effect.die("Unexpected script execution"),
		enqueuePluginWorkflow: () => Effect.die("Unexpected plugin enqueue"),
		executeWorkflow: () => Effect.die("Unexpected script workflow execution"),
		getPluginWorkflowResult: () => Effect.die("Unexpected plugin workflow result"),
		preRegisterPluginWorkflow: () => Effect.die("Recovery must retain the existing pin"),
		resolveWorkflowScript: () => Effect.die("Recovery must not resolve a current script"),
		releaseWorkflowRegistration: (id) =>
			Effect.gen(function* () {
				releases.push(id);
				events.push(`release:${id}`);
				if (input.releaseFailsOnce && releases.length === 1) {
					return yield* new DbError({ message: "Release unavailable" });
				}
				return yield* Effect.void;
			}),
	});
	const engine = makeWorkflowEngine({
		execute: (workflow, options) =>
			Effect.sync(() => {
				executions.push({ options, workflow: workflow._tag });
				return options.executionId;
			}),
		poll: (workflow, id) =>
			Effect.sync(() => {
				polls.push({ id, workflow: workflow._tag });
				return Option.fromUndefinedOr(input.outcomes?.get(id));
			}),
	});
	const recovery = yield* EnrichmentRecovery.make.pipe(
		Effect.provideService(EnrichmentRequests, requests),
		Effect.provideService(ScriptExecutionService, sandbox),
		Effect.provideService(WorkflowEngine, engine),
	);
	return {
		rows,
		polls,
		events,
		updates,
		observed,
		releases,
		released,
		executions,
		reconcile: recovery.reconcile,
	};
});

layer(mutationAdmissionTestLayer)((it) => {
	it.effect("settles collected workflows from their tombstones without reusing expired IDs", () =>
		Effect.gen(function* () {
			const h = yield* harness({
				rows: [request("collected-success"), request("collected-failure")],
				expired: new Map([
					["collected-success", "succeeded"],
					["collected-failure", "failed"],
				]),
			});
			yield* h.reconcile();
			expect(h.rows.get("collected-success")?.state).toBe("succeeded");
			expect(h.rows.get("collected-failure")?.state).toBe("failed");
			expect(h.executions).toEqual([]);
			expect(h.polls).toEqual([]);
		}),
	);
	it.effect("keeps suspended public workflows active without releasing or redispatching them", () =>
		Effect.gen(function* () {
			const h = yield* harness({
				outcomes: new Map([
					["population-suspended", new Workflow.Suspended()],
					["translation-suspended", new Workflow.Suspended()],
				]),
				rows: [
					request("population-suspended", { state: "running" }),
					request("translation-suspended", {
						level: null,
						language: "es",
						state: "retrying",
						operation: "translation",
						workflowName: TranslateEntityWorkflow._tag,
					}),
				],
			});
			yield* h.reconcile();
			expect(h.rows.get("population-suspended")?.state).toBe("running");
			expect(h.rows.get("translation-suspended")?.state).toBe("retrying");
			expect(h.observed).toEqual(["population-suspended", "translation-suspended"]);
			expect(h.executions).toEqual([]);
			expect(h.updates).toEqual([]);
			expect(h.releases).toEqual([]);
			expect(h.events).toEqual(["prune"]);
		}),
	);

	it.effect("recovers missing roots with the stored payload, public ID and exact script pin", () =>
		Effect.gen(function* () {
			const population = request("population-root");
			const translation = request("translation-root", {
				level: null,
				language: "es",
				requesterUserId: userId,
				operation: "translation",
				requesterGeneration: account.token,
				workflowName: TranslateEntityWorkflow._tag,
				payload: translationPayload("translation-root"),
			});
			const h = yield* harness({ rows: [population, translation] });
			yield* h.reconcile();
			expect(h.polls).toEqual([
				{ id: population.id, workflow: ProviderEntityPopulationWorkflow._tag },
				{ id: translation.id, workflow: TranslateEntityWorkflow._tag },
			]);
			expect(h.executions).toEqual([
				{
					workflow: population.workflowName,
					options: { discard: true, executionId: population.id, payload: population.payload },
				},
				{
					workflow: translation.workflowName,
					options: { discard: true, executionId: translation.id, payload: translation.payload },
				},
			]);
			expect(h.updates).toEqual([]);
			expect(h.releases).toEqual([]);
		}),
	);

	it.effect(
		"does not detach and redispatch missing parent-owned children or malformed root payloads",
		() =>
			Effect.gen(function* () {
				const h = yield* harness({
					rows: [
						request("parent-child", { dispatchRoot: false }),
						request("parent-translation-child", {
							dispatchRoot: false,
							workflowName: TranslateEntityWorkflow._tag,
						}),
						request("malformed-root", { payload: { executionId: "malformed-root" } }),
					],
				});
				yield* h.reconcile();
				expect(h.polls.map(({ id }) => id)).toEqual([
					"parent-child",
					"parent-translation-child",
					"malformed-root",
				]);
				expect(h.executions).toEqual([]);
				expect(h.updates).toEqual([
					{ id: "malformed-root", patch: { state: "failed", failureKind: "invalid-input" } },
				]);
				expect(h.releases).toEqual([]);
			}),
	);

	it.effect(
		"settles success, typed failure, interruption and unknown workflow without reporting false success",
		() =>
			Effect.gen(function* () {
				const failure = new SandboxRunError({
					kind: "missing-artifact",
					message: "Provider unavailable",
				});
				const h = yield* harness({
					rows: [
						request("success", { workflowName: TranslateEntityWorkflow._tag }),
						request("failure"),
						request("interrupted"),
						request("unknown", { workflowName: "UnknownWorkflow" }),
					],
					outcomes: new Map<string, Workflow.Result<unknown, SandboxRunError>>([
						["success", new Workflow.Complete({ exit: Exit.void })],
						["failure", new Workflow.Complete({ exit: Exit.fail(failure) })],
						["interrupted", new Workflow.Complete({ exit: Exit.failCause(Cause.interrupt()) })],
					]),
				});
				yield* h.reconcile();
				expect(h.updates).toEqual([
					{ id: "success", patch: { failureKind: null, state: "succeeded" } },
					{ id: "failure", patch: { state: "failed", failureKind: "missing-artifact" } },
					{ id: "interrupted", patch: { state: "cancelled", failureKind: "infrastructure" } },
					{ id: "unknown", patch: { state: "failed", failureKind: "invalid-input" } },
				]);
				expect(h.executions).toEqual([]);
				yield* h.reconcile();
				expect(h.released).toEqual(["success", "failure", "interrupted", "unknown"]);
			}),
	);

	it.effect(
		"cancels stale or disabled accounts but preserves active work on an account database failure",
		() =>
			Effect.gen(function* () {
				for (const current of [null, { userId, token: "new-generation" }]) {
					const h = yield* harness({
						account: current,
						rows: [
							request("stale-account", {
								requesterUserId: userId,
								requesterGeneration: account.token,
							}),
						],
					});
					yield* h.reconcile();
					expect(h.updates).toEqual([
						{ id: "stale-account", patch: { failureKind: null, state: "cancelled" } },
					]);
					expect(h.polls).toEqual([]);
					expect(h.executions).toEqual([]);
				}
				const h = yield* harness({
					accountError: new DbError({ message: "Database unavailable" }),
					rows: [
						request("account-unavailable", {
							requesterUserId: userId,
							requesterGeneration: account.token,
						}),
					],
				});
				yield* h.reconcile();
				expect(h.rows.get("account-unavailable")?.state).toBe("queued");
				expect(h.updates).toEqual([]);
				expect(h.polls).toEqual([]);
				expect(h.releases).toEqual([]);
			}),
	);

	it.effect(
		"retries a failed pin release and marks it released only after the release succeeds",
		() =>
			Effect.gen(function* () {
				const h = yield* harness({
					releaseFailsOnce: true,
					rows: [request("terminal", { state: "failed" })],
				});
				yield* h.reconcile();
				expect(h.released).toEqual([]);
				expect(h.rows.get("terminal")?.registrationReleasedAt).toBeNull();
				yield* h.reconcile();
				expect(h.events).toEqual([
					"release:terminal",
					"prune",
					"release:terminal",
					"released:terminal",
					"prune",
				]);
				expect(h.releases).toEqual(["terminal", "terminal"]);
				expect(h.released).toEqual(["terminal"]);
				yield* h.reconcile();
				expect(h.releases).toHaveLength(2);
				expect(h.polls).toEqual([]);
			}),
	);
});
