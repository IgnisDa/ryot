import { describe, expect, it } from "bun:test";
import { SandboxService } from "~/lib/sandbox/service";
import autoCompleteOnFullProgressScriptCode from "./auto-complete-on-full-progress.txt";

type TestSandboxExecutor = {
	execute: (options: unknown) => Promise<unknown>;
	executeQueuedRun: (
		jobData: {
			userId: string;
			scriptId: string;
			driverName: string;
			context?: Record<string, unknown>;
		},
		scriptFetcher?: (
			scriptId: string,
		) => Promise<{ code: string; metadata: object } | null>,
	) => Promise<unknown>;
};

const createScriptFetcher = async () => ({
	code: autoCompleteOnFullProgressScriptCode,
	metadata: { allowedHostFunctions: ["appApiCall"] },
});

const createTriggerContext = (overrides: Record<string, unknown> = {}) => ({
	trigger: {
		eventId: "event_1",
		entityId: "entity_1",
		entitySchemaSlug: "anime",
		eventSchemaSlug: "progress",
		eventSchemaId: "schema_progress",
		entitySchemaId: "entity_schema_1",
		properties: { progressPercent: 100 },
		...overrides,
	},
});

describe("auto-complete-on-full-progress sandbox script", () => {
	it("creates a completion event after anime coverage is complete", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		const calls: Array<{ method: unknown; path: unknown; options: unknown }> =
			[];

		testService.execute = async (options: unknown) => {
			const executeOptions = options as {
				code: string;
				driverName: string;
				context: Record<string, unknown>;
				apiFunctions: {
					appApiCall: (...args: Array<unknown>) => Promise<unknown>;
				};
			};

			const driverRegistry: Record<
				string,
				(context: unknown) => Promise<unknown>
			> = {};
			const respond = async (
				method: unknown,
				path: unknown,
				apiOptions?: unknown,
			) => {
				calls.push({ method, path, options: apiOptions });
				if (path === "/event-schemas?entitySchemaId=entity_schema_1") {
					return {
						success: true,
						data: {
							body: { data: [{ id: "complete_schema", slug: "complete" }] },
						},
					};
				}
				if (path === "/entities/entity_1") {
					return {
						success: true,
						data: { body: { data: { properties: { episodes: 2 } } } },
					};
				}
				if (path === "/events?entityId=entity_1&eventSchemaSlug=progress") {
					return {
						success: true,
						data: {
							body: {
								data: [
									{
										id: "event_1",
										createdAt: "2024-01-01T00:00:00.000Z",
										properties: { progressPercent: 100, animeEpisode: 1 },
									},
									{
										id: "event_2",
										createdAt: "2024-01-02T00:00:00.000Z",
										properties: { progressPercent: 100, animeEpisode: 2 },
									},
								],
							},
						},
					};
				}
				if (method === "POST" && path === "/events") {
					return { success: true, data: { body: { data: { count: 1 } } } };
				}

				throw new Error(
					`Unexpected appApiCall: ${String(method)} ${String(path)}`,
				);
			};

			new Function("driver", "appApiCall", executeOptions.code)(function driver(
				name: string,
				fn: (context: unknown) => Promise<unknown>,
			) {
				driverRegistry[name] = fn;
			}, respond);

			await driverRegistry[executeOptions.driverName]?.(executeOptions.context);

			return { success: true, logs: null, error: null, value: null };
		};

		await testService.executeQueuedRun(
			{
				userId: "user_1",
				scriptId: "script_1",
				driverName: "trigger",
				context: createTriggerContext({
					eventId: "event_2",
					properties: { progressPercent: 100, animeEpisode: 2 },
				}),
			},
			async () => createScriptFetcher(),
		);

		expect(calls.map((call) => call.path)).toEqual([
			"/event-schemas?entitySchemaId=entity_schema_1",
			"/entities/entity_1",
			"/events?entityId=entity_1&eventSchemaSlug=progress",
			"/events",
		]);
		expect(calls.at(-1)?.options).toEqual({
			body: [
				{
					entityId: "entity_1",
					eventSchemaId: "complete_schema",
					properties: { completionMode: "just_now" },
				},
			],
		});
	});
});
