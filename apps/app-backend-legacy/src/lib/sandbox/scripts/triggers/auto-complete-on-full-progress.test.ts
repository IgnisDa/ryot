import { describe, expect, it } from "bun:test";

import { SandboxService } from "~/lib/sandbox/service";

import autoCompleteOnFullProgressScriptCode from "./auto-complete-on-full-progress.txt";
import { hostSuccess } from "./test-utils";

type TestSandboxExecutor = {
	execute: (options: unknown) => Promise<unknown>;
	executeQueuedRun: (
		jobData: {
			userId: string;
			scriptId: string;
			driverName: string;
			context?: Record<string, unknown>;
		},
		scriptFetcher?: (scriptId: string) => Promise<{ code: string; metadata: object } | null>,
	) => Promise<unknown>;
};

type SandboxCall = {
	args: Array<unknown>;
	functionName: string;
	runIndex: number;
};

const createScriptFetcher = () => ({
	code: autoCompleteOnFullProgressScriptCode,
	metadata: {
		allowedHostFunctions: ["getEntity", "listEvents", "createEvents", "listEventSchemas"],
	},
});

const createProgressEvent = (
	id: string,
	occurredAt: string,
	createdAt: string,
	properties: Record<string, unknown>,
) => ({ id, createdAt, occurredAt, properties });

const createTriggerContext = (overrides: Record<string, unknown> = {}) => ({
	trigger: {
		eventId: "event_1",
		entityId: "entity_1",
		entitySchemaSlug: "anime",
		eventSchemaSlug: "progress",
		eventSchemaId: "schema_progress",
		entitySchemaId: "entity_schema_1",
		properties: { progressPercent: 100 },
		createdAt: "2024-01-04T00:00:00.000Z",
		updatedAt: "2024-01-04T00:00:00.000Z",
		occurredAt: "2024-01-04T00:00:00.000Z",
		...overrides,
	},
});

const createSandboxHarness = (respond: (call: SandboxCall) => unknown) => {
	const service = new SandboxService();
	// oxlint-disable-next-line no-unsafe-type-assertion
	const testService = service as unknown as TestSandboxExecutor;
	const calls: SandboxCall[] = [];
	let runIndex = 0;

	testService.execute = async (options: unknown) => {
		runIndex += 1;
		const currentRunIndex = runIndex;
		// oxlint-disable-next-line no-unsafe-type-assertion
		const executeOptions = options as {
			code: string;
			driverName: string;
			context: Record<string, unknown>;
			apiFunctions: Record<string, (...args: Array<unknown>) => Promise<unknown>>;
		};

		const driverRegistry: Record<string, (context: unknown) => Promise<unknown>> = {};
		const hostNames = Object.keys(executeOptions.apiFunctions);
		const hostImplementations = hostNames.map((functionName) => (...args: Array<unknown>) => {
			const call = { args, functionName, runIndex: currentRunIndex };
			calls.push(call);
			return Promise.resolve(respond(call));
		});

		// oxlint-disable-next-line no-implied-eval
		new Function("driver", ...hostNames, executeOptions.code)(
			function driver(name: string, fn: (context: unknown) => Promise<unknown>) {
				driverRegistry[name] = fn;
			},
			...hostImplementations,
		);

		await driverRegistry[executeOptions.driverName]?.(executeOptions.context);

		return { success: true, logs: null, error: null, value: null };
	};

	return { calls, testService };
};

describe("auto-complete-on-full-progress sandbox script", () => {
	it("emits repeated episodic completions using occurredAt chronology", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "getEntity") {
				return Promise.resolve(hostSuccess({ properties: { episodes: 2 } }));
			}

			if (call.functionName === "listEvents") {
				if (call.runIndex === 1) {
					return Promise.resolve(
						hostSuccess([
							createProgressEvent(
								"event_2",
								"2024-01-02T00:00:00.000Z",
								"2024-01-03T00:00:00.000Z",
								{ progressPercent: 100, animeEpisode: 2, consumedOn: "Crunchyroll" },
							),
							createProgressEvent(
								"event_1",
								"2024-01-01T00:00:00.000Z",
								"2024-01-04T00:00:00.000Z",
								{ progressPercent: 100, animeEpisode: 1 },
							),
						]),
					);
				}

				if (call.runIndex === 2) {
					return Promise.resolve(
						hostSuccess([
							createProgressEvent(
								"event_4",
								"2024-01-04T00:00:00.000Z",
								"2024-01-01T00:00:00.000Z",
								{ progressPercent: 100, animeEpisode: 2, consumedOn: "Crunchyroll" },
							),
							createProgressEvent(
								"event_3",
								"2024-01-03T00:00:00.000Z",
								"2024-01-02T00:00:00.000Z",
								{ progressPercent: 100, animeEpisode: 1 },
							),
							createProgressEvent(
								"event_2",
								"2024-01-02T00:00:00.000Z",
								"2024-01-03T00:00:00.000Z",
								{ progressPercent: 100, animeEpisode: 2, consumedOn: "Crunchyroll" },
							),
							createProgressEvent(
								"event_1",
								"2024-01-01T00:00:00.000Z",
								"2024-01-04T00:00:00.000Z",
								{ progressPercent: 100, animeEpisode: 1 },
							),
						]),
					);
				}

				throw new Error(`Unexpected progress event lookup for run ${String(call.runIndex)}`);
			}

			if (call.functionName === "createEvents") {
				return Promise.resolve(hostSuccess({ count: 1 }));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_2",
					entitySchemaSlug: "anime",
					createdAt: "2024-01-03T00:00:00.000Z",
					updatedAt: "2024-01-03T00:00:00.000Z",
					occurredAt: "2024-01-02T00:00:00.000Z",
					inheritedProperties: { consumedOn: "Crunchyroll" },
					properties: { progressPercent: 100, animeEpisode: 2 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_4",
					entitySchemaSlug: "anime",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
					occurredAt: "2024-01-04T00:00:00.000Z",
					inheritedProperties: { consumedOn: "Crunchyroll" },
					properties: { progressPercent: 100, animeEpisode: 2 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		const postCalls = calls.filter((call) => call.functionName === "createEvents");
		expect(postCalls).toHaveLength(2);
		expect(postCalls[0]?.args[0]).toEqual([
			{
				entityId: "entity_1",
				eventSchemaId: "complete_schema",
				occurredAt: "2024-01-02T00:00:00.000Z",
				properties: {
					consumedOn: "Crunchyroll",
					completionMode: "custom_timestamps",
					completedOn: "2024-01-02T00:00:00.000Z",
				},
			},
		]);
		expect(postCalls[1]?.args[0]).toEqual([
			{
				entityId: "entity_1",
				eventSchemaId: "complete_schema",
				occurredAt: "2024-01-04T00:00:00.000Z",
				properties: {
					consumedOn: "Crunchyroll",
					completionMode: "custom_timestamps",
					completedOn: "2024-01-04T00:00:00.000Z",
				},
			},
		]);
	});

	it("uses createdAt to break same occurredAt ties", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "getEntity") {
				return Promise.resolve(hostSuccess({ properties: { episodes: 2 } }));
			}

			if (call.functionName === "listEvents") {
				return Promise.resolve(
					hostSuccess([
						createProgressEvent("event_b", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", {
							progressPercent: 100,
							animeEpisode: 1,
						}),
						createProgressEvent("event_a", "2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", {
							progressPercent: 100,
							animeEpisode: 2,
						}),
					]),
				);
			}

			if (call.functionName === "createEvents") {
				return Promise.resolve(hostSuccess({ count: 1 }));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_a",
					entitySchemaSlug: "anime",
					createdAt: "2024-01-02T00:00:00.000Z",
					updatedAt: "2024-01-02T00:00:00.000Z",
					occurredAt: "2024-01-01T00:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 2 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		const postCalls = calls.filter((call) => call.functionName === "createEvents");
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0]?.args[0]).toEqual([
			{
				entityId: "entity_1",
				eventSchemaId: "complete_schema",
				occurredAt: "2024-01-01T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2024-01-01T00:00:00.000Z",
				},
			},
		]);
	});

	it("uses occurredAt chronology to choose the emitter for backfilled events", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "getEntity") {
				return Promise.resolve(hostSuccess({ properties: { episodes: 2 } }));
			}

			if (call.functionName === "listEvents") {
				return Promise.resolve(
					hostSuccess([
						createProgressEvent("event_a", "2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", {
							progressPercent: 100,
							animeEpisode: 1,
						}),
						createProgressEvent("event_b", "2024-01-02T00:00:00.000Z", "2024-01-01T00:00:00.000Z", {
							progressPercent: 100,
							animeEpisode: 2,
						}),
					]),
				);
			}

			if (call.functionName === "createEvents") {
				return Promise.resolve(hostSuccess({ count: 1 }));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_b",
					entitySchemaSlug: "anime",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
					occurredAt: "2024-01-02T00:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 2 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		const postCalls = calls.filter((call) => call.functionName === "createEvents");
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0]?.args[0]).toEqual([
			{
				entityId: "entity_1",
				eventSchemaId: "complete_schema",
				occurredAt: "2024-01-02T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2024-01-02T00:00:00.000Z",
				},
			},
		]);
	});

	it("exits when episodic required coverage is missing", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "getEntity") {
				return Promise.resolve(hostSuccess({ properties: { episodes: null } }));
			}

			if (call.functionName === "listEvents") {
				return Promise.resolve(hostSuccess([]));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_missing",
					entitySchemaSlug: "anime",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
					occurredAt: "2024-01-01T00:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 1 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		expect(calls.map((call) => call.functionName)).toEqual([
			"listEventSchemas",
			"getEntity",
			"listEvents",
		]);
	});

	it("exits when a non-special show season has no episodes", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "getEntity") {
				return Promise.resolve(
					hostSuccess({
						properties: { showSeasons: [{ episodes: [], seasonNumber: 1, name: "Season 1" }] },
					}),
				);
			}

			if (call.functionName === "listEvents") {
				return Promise.resolve(hostSuccess([]));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					entitySchemaSlug: "show",
					eventId: "event_empty_regular",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
					occurredAt: "2024-01-01T00:00:00.000Z",
					properties: { progressPercent: 100, showSeason: 1, showEpisode: 1 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		expect(calls.map((call) => call.functionName)).toEqual([
			"listEventSchemas",
			"getEntity",
			"listEvents",
		]);
	});

	it("exits when episodic required coverage is empty", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "getEntity") {
				return Promise.resolve(
					hostSuccess({
						properties: {
							showSeasons: [
								{ name: "Specials", seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
							],
						},
					}),
				);
			}

			if (call.functionName === "listEvents") {
				return Promise.resolve(hostSuccess([]));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_empty",
					entitySchemaSlug: "show",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
					occurredAt: "2024-01-01T00:00:00.000Z",
					properties: { progressPercent: 100, showSeason: 0, showEpisode: 1 },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		expect(calls.map((call) => call.functionName)).toEqual([
			"listEventSchemas",
			"getEntity",
			"listEvents",
		]);
	});

	it("creates a completion event for each non-episodic 100% progress event", async () => {
		const { calls, testService } = createSandboxHarness((call) => {
			if (call.functionName === "listEventSchemas") {
				return Promise.resolve(hostSuccess([{ id: "complete_schema", slug: "complete" }]));
			}

			if (call.functionName === "createEvents") {
				return Promise.resolve(hostSuccess({ count: 1 }));
			}

			throw new Error(`Unexpected host function: ${call.functionName}`);
		});

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_1",
					entitySchemaSlug: "movie",
					properties: { progressPercent: 100 },
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
					occurredAt: "2024-01-01T00:00:00.000Z",
					inheritedProperties: { consumedOn: "Netflix" },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_2",
					entitySchemaSlug: "movie",
					properties: { progressPercent: 100 },
					createdAt: "2024-01-02T00:00:00.000Z",
					updatedAt: "2024-01-02T00:00:00.000Z",
					occurredAt: "2024-01-02T00:00:00.000Z",
					inheritedProperties: { consumedOn: "Hulu" },
				}),
			},
			() => Promise.resolve(createScriptFetcher()),
		);

		const postCalls = calls.filter((call) => call.functionName === "createEvents");
		expect(postCalls).toHaveLength(2);
		expect(postCalls[0]?.args[0]).toEqual([
			{
				entityId: "entity_1",
				eventSchemaId: "complete_schema",
				occurredAt: "2024-01-01T00:00:00.000Z",
				properties: {
					consumedOn: "Netflix",
					completionMode: "custom_timestamps",
					completedOn: "2024-01-01T00:00:00.000Z",
				},
			},
		]);
		expect(postCalls[1]?.args[0]).toEqual([
			{
				entityId: "entity_1",
				eventSchemaId: "complete_schema",
				occurredAt: "2024-01-02T00:00:00.000Z",
				properties: {
					consumedOn: "Hulu",
					completionMode: "custom_timestamps",
					completedOn: "2024-01-02T00:00:00.000Z",
				},
			},
		]);
	});
});
