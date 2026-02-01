import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";

import { Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient, pollUntil } from "~/fixtures";
import {
	requireArray,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import { type FakeHttpServer, startFakeHttpServer } from "~/support/fake-http-server";
import {
	buildBackendEnv,
	startCoreTestInfrastructure,
	spawnBackendProcess,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-observability-test";
const WORKFLOW_NAME = "NotificationDeliveryWorkflow";

let backendPort: number;
let logFile: string | undefined;
let otlpServer: FakeHttpServer | undefined;
let backendProcess: ChildProcess | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function getBackendUrl() {
	return `http://127.0.0.1:${backendPort}/api`;
}

function requireLogFile() {
	return requirePresent(logFile, "Observability backend log file is not initialized");
}

function requireOtlpServer() {
	return requirePresent(otlpServer, "OTLP test server is not initialized");
}

function getStringAttribute(attributesValue: unknown, key: string) {
	for (const attributeValue of requireArray(attributesValue, "OTLP attributes are not an array")) {
		const attribute = requireObjectRecord(attributeValue, "OTLP attribute is not an object");
		if (attribute["key"] !== key) {
			continue;
		}
		const value = requireObjectRecord(attribute["value"], "OTLP attribute value is not an object");
		return typeof value["stringValue"] === "string" ? value["stringValue"] : null;
	}
	return null;
}

function findSpan(predicate: (span: Record<string, unknown>) => boolean) {
	for (const request of requireOtlpServer().requests) {
		if (request.path !== "/v1/traces") {
			continue;
		}
		const body = requireObjectRecord(request.body, "OTLP request body is not an object");
		for (const resourceSpanValue of requireArray(
			body["resourceSpans"],
			"OTLP resource spans are not an array",
		)) {
			const resourceSpan = requireObjectRecord(
				resourceSpanValue,
				"OTLP resource span is not an object",
			);
			const resource = requireObjectRecord(
				resourceSpan["resource"],
				"OTLP resource is not an object",
			);
			for (const scopeSpanValue of requireArray(
				resourceSpan["scopeSpans"],
				"OTLP scope spans are not an array",
			)) {
				const scopeSpan = requireObjectRecord(scopeSpanValue, "OTLP scope span is not an object");
				for (const spanValue of requireArray(scopeSpan["spans"], "OTLP spans are not an array")) {
					const span = requireObjectRecord(spanValue, "OTLP span is not an object");
					if (predicate(span)) {
						return { resource, span };
					}
				}
			}
		}
	}
	return null;
}

function findRequestSpan() {
	return findSpan(
		(span) => getStringAttribute(span["attributes"], "url.path") === "/notifications/channels/test",
	);
}

function findWorkflowSpan(userId: string) {
	return findSpan(
		(span) =>
			span["name"] === WORKFLOW_NAME && getStringAttribute(span["attributes"], "userId") === userId,
	);
}

beforeAll(async () => {
	const [infrastructure, server, port] = await Promise.all([
		startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
		startFakeHttpServer(),
		getPort(),
	]);
	backendPort = port;
	otlpServer = server;
	coreInfrastructure = infrastructure;

	const backendOrigin = `http://127.0.0.1:${backendPort}`;
	const env = buildBackendEnv({
		port: backendPort,
		frontendUrl: backendOrigin,
		dbUrl: infrastructure.dbUrl,
		s3BucketName: S3_BUCKET_NAME,
		label: "Observability Backend",
		redisUrl: infrastructure.redisUrl,
		s3Endpoint: infrastructure.s3Endpoint,
		extraEnv: { SERVER_LOG_LEVEL: "debug", SERVER_OTLP_ENDPOINT: server.url },
	});
	logFile = requireString(env.SERVER_LOG_FILE, "Observability backend log file is missing");
	backendProcess = spawnBackendProcess(env);
	await waitForHealthCheck(`${backendOrigin}/api/system/health`, "Observability Setup");
}, 120_000);

afterAll(async () => {
	await stopBackendProcess(backendProcess);
	otlpServer?.stop();
	await stopCoreTestInfrastructure(coreInfrastructure);
});

describe("Backend observability", () => {
	it.live("exports spans with correlatable workflow and request logs", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient(getBackendUrl());
			yield* client.call((c) => c.notifications.testChannels());

			const { resource, span } = yield* pollUntil(
				"notification delivery workflow OTLP span",
				Effect.sync(() => findWorkflowSpan(userId)),
				{ timeoutMs: 20_000 },
			);
			const { span: requestSpan } = yield* pollUntil(
				"notification test request OTLP span",
				Effect.sync(() => findRequestSpan()),
				{ timeoutMs: 20_000 },
			);
			expect(getStringAttribute(resource["attributes"], "service.name")).toBe("ryot-backend");

			const requestTraceId = requirePresent(
				requireString(requestSpan["traceId"], "Request trace ID is missing"),
				"Request trace ID is empty",
			);
			const spanId = requirePresent(
				requireString(span["spanId"], "Workflow span ID is missing"),
				"Workflow span ID is empty",
			);
			const traceId = requirePresent(
				requireString(span["traceId"], "Workflow trace ID is missing"),
				"Workflow trace ID is empty",
			);
			requirePresent(
				getStringAttribute(span["attributes"], "executionId"),
				"Workflow execution ID is missing",
			);
			const logLine = yield* pollUntil(
				"correlated workflow completion log",
				Effect.gen(function* () {
					const contents = yield* Effect.promise(() =>
						readFile(requireLogFile(), "utf8").catch(() => ""),
					);
					return (
						contents
							.split("\n")
							.find(
								(line) => line.includes(`spanId=${spanId}`) && line.includes(`traceId=${traceId}`),
							) ?? null
					);
				}),
				{ timeoutMs: 20_000 },
			);
			expect(logLine).toContain('message="span completed"');
			expect(logLine).toContain(`spanName=${WORKFLOW_NAME}`);

			const requestLogLine = yield* pollUntil(
				"correlated HTTP response log",
				Effect.gen(function* () {
					const contents = yield* Effect.promise(() =>
						readFile(requireLogFile(), "utf8").catch(() => ""),
					);
					return (
						contents
							.split("\n")
							.find(
								(line) =>
									line.includes('message="Sent HTTP response"') &&
									line.includes(`userId=${userId}`) &&
									line.includes(`traceId=${requestTraceId}`),
							) ?? null
					);
				}),
				{ timeoutMs: 20_000 },
			);
			expect(requestLogLine).toContain("http.url=/notifications/channels/test");
		}),
	);
});
