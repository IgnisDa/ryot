import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect as vitestExpect, it as vitestIt } from "vitest";

import { CurrentDb, DbRunner } from "~/lib/db";
import { ImportsRepository } from "~/modules/imports/repository";

import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import {
	failAdapterOnlyRun,
	failUnsupportedIntegrationRun,
	finalizeIntegrationRun,
	getSinkAdapterResult,
	parseKodiSinkPayload,
} from "./worker";

const makeIntegration = (overrides: Partial<IntegrationRecord> = {}): IntegrationRecord => ({
	name: null,
	id: "int_1",
	lot: "sink",
	userId: "user_1",
	provider: "kodi",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	providerSpecifics: { kind: "kodi" },
	createdAt: "2026-06-17T00:00:00.000Z",
	updatedAt: "2026-06-17T00:00:00.000Z",
	webhookUrl: "http://localhost:3000/_i/int_1",
	extraSettings: { disableOnContinuousErrors: true },
	...overrides,
});

const makeRun = (status: "completed" | "failed") => ({
	status,
	progress: 0,
	id: "run_1",
	source: "kodi",
	failedItems: 0,
	startedAt: null,
	finishedAt: null,
	totalItems: null,
	inputSummary: {},
	importedItems: 0,
	processedItems: 0,
	errorSummary: null,
	createdAt: "2026-06-17T00:00:00.000Z",
	updatedAt: "2026-06-17T00:00:00.000Z",
});

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const defaultImportsRepository = () =>
	Object.assign(Object.create(null), {
		updateRun: () => Effect.void,
		_tag: "ImportsRepository" as const,
		createRun: () => Effect.die("unused"),
		getRunById: () => Effect.succeed(null),
		createFailure: () => Effect.die("unused"),
		deleteRunById: () => Effect.die("unused"),
		listRunsByUser: () => Effect.die("unused"),
		listFailuresByRunId: () => Effect.die("unused"),
		listRunsByIntegrationId: () => Effect.die("unused"),
		hasActiveRunForIntegration: () => Effect.die("unused"),
		listRecentStatusesByIntegrationId: () => Effect.succeed([]),
	});

const defaultIntegrationsRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "IntegrationsRepository" as const,
		getForUser: () => Effect.die("unused"),
		listForUser: () => Effect.die("unused"),
		updateForUser: () => Effect.succeed(null),
		deleteForUser: () => Effect.die("unused"),
		createForUser: () => Effect.die("unused"),
		getByIdAnyUser: () => Effect.die("unused"),
		getUserDisableIntegrations: () => Effect.die("unused"),
		listEnabledYankIntegrations: () => Effect.die("unused"),
	});

const makeImportsRepository = (overrides: Partial<ImportsRepository> = {}) =>
	Object.assign(Object.create(null), defaultImportsRepository(), overrides);

const makeIntegrationsRepository = (overrides: Partial<IntegrationsRepository> = {}) =>
	Object.assign(Object.create(null), defaultIntegrationsRepository(), overrides);

const makeWorkerLayer = (input: {
	importsRepository?: ImportsRepository;
	integrationsRepository?: IntegrationsRepository;
}) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(ImportsRepository, input.importsRepository ?? makeImportsRepository()),
		Layer.succeed(
			IntegrationsRepository,
			input.integrationsRepository ?? makeIntegrationsRepository(),
		),
	);

describe("parseKodiSinkPayload", () => {
	vitestIt("maps Kodi show progress to a TMDB show ref", () => {
		const result = parseKodiSinkPayload({
			lot: "show",
			progress: 45,
			identifier: "1234",
			show_season_number: 2,
			show_episode_number: 7,
		});

		vitestExpect(result.failures).toEqual([]);
		vitestExpect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "1234", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { showSeason: 2, showEpisode: 7, consumedOn: "kodi", progressPercent: 45 },
				},
			],
		});
	});

	vitestIt("returns an input_transformation failure for malformed payloads", () => {
		const result = parseKodiSinkPayload("not-json");

		vitestExpect(result.entityGroups).toEqual([]);
		vitestExpect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse Kodi webhook payload",
			},
		]);
	});

	vitestIt("returns a source_fetch failure for unsupported sink providers", () => {
		const result = getSinkAdapterResult(
			makeIntegration({
				provider: "generic_json",
				providerSpecifics: { kind: "generic_json" },
				webhookUrl: "http://localhost:3000/_i/int_1",
			}),
			{},
		);

		vitestExpect(result.entityGroups).toEqual([]);
		vitestExpect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "source_fetch",
				message: "generic_json integration is not implemented in V2 yet",
			},
		]);
	});

	vitestIt("ignores invalid show season and episode values", () => {
		const result = parseKodiSinkPayload({
			lot: "show",
			progress: 45,
			identifier: "1234",
			show_episode_number: 7.5,
			show_season_number: Number.NaN,
		});

		vitestExpect(result.failures).toEqual([]);
		vitestExpect(result.entityGroups[0]?.events[0]?.properties).toEqual({
			consumedOn: "kodi",
			progressPercent: 45,
		});
	});
});

it.effect("updates lastFinishedAt after a completed integration run", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
			listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		}),
		integrationsRepository: makeIntegrationsRepository({
			updateForUser: (input) => {
				updates.push(input);
				return Effect.succeed(makeIntegration());
			},
		}),
	});

	return Effect.gen(function* () {
		yield* finalizeIntegrationRun(makeIntegration(), "run_1");

		vitestExpect(updates).toHaveLength(1);
		vitestExpect(updates[0]).toMatchObject({
			userId: "user_1",
			integrationId: "int_1",
			lastFinishedAt: vitestExpect.any(Date),
		});
	}).pipe(Effect.provide(layer));
});

it.effect("disables the integration after 5 consecutive failures", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed([
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
				]),
		}),
		integrationsRepository: makeIntegrationsRepository({
			updateForUser: (input) => {
				updates.push(input);
				return Effect.succeed(makeIntegration({ isDisabled: true }));
			},
		}),
	});

	return Effect.gen(function* () {
		yield* finalizeIntegrationRun(makeIntegration(), "run_1");

		vitestExpect(updates).toEqual([{ userId: "user_1", isDisabled: true, integrationId: "int_1" }]);
	}).pipe(Effect.provide(layer));
});

it.effect("does not disable integrations when recent runs are not all failures", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed([
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "completed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
				]),
		}),
		integrationsRepository: makeIntegrationsRepository({
			updateForUser: (input) => {
				updates.push(input);
				return Effect.succeed(makeIntegration());
			},
		}),
	});

	return Effect.gen(function* () {
		yield* finalizeIntegrationRun(makeIntegration(), "run_1");

		vitestExpect(updates).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("records failure counts for adapter-only sink runs", () => {
	const failures: Array<Record<string, unknown>> = [];
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			createFailure: (input) => {
				failures.push(input);
				return Effect.void;
			},
			getRunById: () => Effect.succeed(makeRun("failed")),
			updateRun: (input) => {
				updates.push(input);
				return Effect.void;
			},
		}),
	});

	return Effect.gen(function* () {
		yield* failAdapterOnlyRun("run_1", {
			entityGroups: [],
			failures: [
				{
					itemIndex: 0,
					stage: "source_fetch",
					message: "generic_json integration is not implemented in V2 yet",
				},
			],
		});

		vitestExpect(failures).toEqual([
			{
				itemIndex: 0,
				context: null,
				runId: "run_1",
				stage: "source_fetch",
				sourceLabel: undefined,
				sourceIdentifier: undefined,
				message: "generic_json integration is not implemented in V2 yet",
			},
		]);
		vitestExpect(updates).toEqual([
			{
				progress: 100,
				totalItems: 1,
				failedItems: 1,
				runId: "run_1",
				processedItems: 1,
			},
			{
				runId: "run_1",
				status: "failed",
				finishedAt: vitestExpect.any(Date),
				errorSummary: "generic_json integration is not implemented in V2 yet",
			},
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("records failure counts for unsupported yank providers", () => {
	const failures: Array<Record<string, unknown>> = [];
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeWorkerLayer({
		importsRepository: makeImportsRepository({
			createFailure: (input) => {
				failures.push(input);
				return Effect.void;
			},
			getRunById: () => Effect.succeed(makeRun("failed")),
			updateRun: (input) => {
				updates.push(input);
				return Effect.void;
			},
		}),
	});

	return Effect.gen(function* () {
		yield* failUnsupportedIntegrationRun("run_1", "komga");

		vitestExpect(failures).toEqual([
			{
				itemIndex: 0,
				runId: "run_1",
				stage: "source_fetch",
				message: "komga integration is not implemented in V2 yet",
			},
		]);
		vitestExpect(updates).toEqual([
			{
				progress: 100,
				totalItems: 1,
				failedItems: 1,
				runId: "run_1",
				processedItems: 1,
			},
			{
				runId: "run_1",
				status: "failed",
				finishedAt: vitestExpect.any(Date),
				errorSummary: "komga integration is not implemented in V2 yet",
			},
		]);
	}).pipe(Effect.provide(layer));
});
