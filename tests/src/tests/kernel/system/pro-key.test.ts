import type { ChildProcess } from "node:child_process";

import { Effect } from "effect";
import getPort from "get-port";

import { makeSession } from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
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

const S3_BUCKET_NAME = "ryot-pro-key-test";
const VALID_KEY_ENV_VALUE = "e2e-pro-key";

const unkeyEnvelope = (data: { valid: boolean; code: string; meta?: Record<string, unknown> }) =>
	Response.json({ meta: { requestId: crypto.randomUUID() }, data });

const validKeyRespond = () =>
	unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "2030-01-01" } });

type ScenarioName =
	| "noKey"
	| "validTrue"
	| "validFalse"
	| "expiredMeta"
	| "malformedMeta"
	| "serverError"
	| "unreachable"
	| "cache";

type ScenarioConfig = {
	unreachable?: boolean;
	extraEnv?: Record<string, string>;
	respond?: (url: URL, request: Request) => Response | Promise<Response>;
};

const scenarioConfigs: Record<ScenarioName, ScenarioConfig> = {
	noKey: { extraEnv: { SERVER_PRO_KEY: "" } },
	validTrue: {
		respond: () => validKeyRespond(),
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
	},
	validFalse: {
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
		respond: () => unkeyEnvelope({ valid: false, code: "NOT_FOUND" }),
	},
	expiredMeta: {
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
		respond: () => unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "2020-01-01" } }),
	},
	malformedMeta: {
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
		respond: () => unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "whenever" } }),
	},
	serverError: {
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
		respond: () => new Response(null, { status: 500 }),
	},
	unreachable: { extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE }, unreachable: true },
	cache: {
		respond: () => validKeyRespond(),
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
	},
};

const scenarioNames: ScenarioName[] = [
	"noKey",
	"validTrue",
	"validFalse",
	"expiredMeta",
	"malformedMeta",
	"serverError",
	"unreachable",
	"cache",
];

type ScenarioInstance = { backendUrl: string; fake?: FakeHttpServer; process: ChildProcess };

const scenarios = new Map<ScenarioName, ScenarioInstance>();
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function requireScenario(name: ScenarioName) {
	return requirePresent(scenarios.get(name), `Pro key scenario '${name}' is not initialised`);
}

function requireFake(instance: ScenarioInstance) {
	return requirePresent(instance.fake, "Fake Unkey server is not initialised for this scenario");
}

beforeAll(async () => {
	coreInfrastructure = await startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });
	const infrastructure = requirePresent(
		coreInfrastructure,
		"Pro key test infrastructure is not initialised",
	);

	// Spawned sequentially, not via Promise.all: each backend boot (migrations, plugin catalog,
	// scheduler, sandbox runtime) is heavy enough that eight concurrent boots starve each other of
	// CPU and stall past any reasonable health-check budget. Each instance is registered in
	// `scenarios` immediately after it is spawned (before awaiting its health check) so a failure
	// partway through still leaves every already-started process reachable for `afterAll` cleanup.
	for (const name of scenarioNames) {
		const config = scenarioConfigs[name];
		// oxlint-disable-next-line no-await-in-loop -- intentionally sequential, see comment above
		const port = await getPort();
		const fake = config.unreachable
			? undefined
			: // oxlint-disable-next-line no-await-in-loop -- intentionally sequential, see comment above
				await startFakeHttpServer(config.respond);
		const verificationUrl = config.unreachable
			? // oxlint-disable-next-line no-await-in-loop -- intentionally sequential, see comment above
				`http://127.0.0.1:${await getPort()}`
			: requirePresent(fake, `Fake Unkey server missing for scenario '${name}'`).url;
		const backendOrigin = `http://127.0.0.1:${port}`;
		const process = spawnBackendProcess(
			buildBackendEnv({
				port,
				label: `Pro key ${name}`,
				dbUrl: infrastructure.dbUrl,
				frontendUrl: backendOrigin,
				s3BucketName: S3_BUCKET_NAME,
				redisUrl: infrastructure.redisUrl,
				s3Endpoint: infrastructure.s3Endpoint,
				extraEnv: { SERVER_PRO_KEY_VERIFICATION_URL: verificationUrl, ...config.extraEnv },
			}),
		);
		scenarios.set(name, { fake, process, backendUrl: `${backendOrigin}/api` });
		// oxlint-disable-next-line no-await-in-loop -- intentionally sequential, see comment above
		await waitForHealthCheck(`${backendOrigin}/api/system/health`, `Pro key ${name} setup`, 90);
	}
}, 360_000);

afterAll(async () => {
	await Promise.all(
		[...scenarios.values()].map((instance) => stopBackendProcess(instance.process)),
	);
	for (const instance of scenarios.values()) {
		instance.fake?.stop();
	}
	await stopCoreTestInfrastructure(coreInfrastructure);
});

describe("GET /system/config without SERVER_PRO_KEY", () => {
	it.live("reports isServerKeyValidated: false and makes no Unkey request", () =>
		Effect.gen(function* () {
			const instance = requireScenario("noKey");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(false);
			expect(requireFake(instance).requests).toHaveLength(0);
		}),
	);
});

describe("GET /system/config with a valid Pro Key", () => {
	it.live("reports isServerKeyValidated: true", () =>
		Effect.gen(function* () {
			const instance = requireScenario("validTrue");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(true);
		}),
	);
});

describe("GET /system/config with an invalid Pro Key", () => {
	it.live("reports isServerKeyValidated: false when Unkey reports valid: false", () =>
		Effect.gen(function* () {
			const instance = requireScenario("validFalse");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(false);
		}),
	);

	it.live("reports isServerKeyValidated: false when the key has expired", () =>
		Effect.gen(function* () {
			const instance = requireScenario("expiredMeta");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(false);
		}),
	);

	it.live("reports isServerKeyValidated: false when the expiry is not a date", () =>
		Effect.gen(function* () {
			const instance = requireScenario("malformedMeta");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(false);
		}),
	);
});

describe("GET /system/config when Unkey is unavailable", () => {
	it.live("fails safe to false and keeps the server healthy when Unkey returns 500", () =>
		Effect.gen(function* () {
			const instance = requireScenario("serverError");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(false);
			const health = yield* client.call((c) => c.system.health());
			expect(health.status).toBe("healthy");
		}),
	);

	it.live("fails safe to false and keeps the server healthy when Unkey is unreachable", () =>
		Effect.gen(function* () {
			const instance = requireScenario("unreachable");
			const client = makeSession(instance.backendUrl);
			const data = yield* client.call((c) => c.system.config());
			expect(data.pro.isServerKeyValidated).toBe(false);
			const health = yield* client.call((c) => c.system.health());
			expect(health.status).toBe("healthy");
		}),
	);
});

describe("Pro Key verification cache", () => {
	it.live("issues exactly one Unkey request across repeated /system/config hits", () =>
		Effect.gen(function* () {
			const instance = requireScenario("cache");
			const client = makeSession(instance.backendUrl);
			for (let attempt = 0; attempt < 3; attempt++) {
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(true);
			}
			expect(requireFake(instance).requests).toHaveLength(1);
		}),
	);
});
