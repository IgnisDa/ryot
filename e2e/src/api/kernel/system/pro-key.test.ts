import { Effect } from "effect";
import getPort from "get-port";

import { makeSession } from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import { buildApiEnv, startApiProcess, startCoreTestInfrastructure } from "~/support/provisioning";
import { makeTestResourceScope } from "~/support/resource-scope";

const S3_BUCKET_NAME = "ryot-pro-key-test";
const VALID_KEY_ENV_VALUE = "e2e-pro-key";

const unkeyEnvelope = (data: { code: string; valid: boolean; meta?: Record<string, unknown> }) =>
	Response.json({ data, meta: { requestId: crypto.randomUUID() } });

const validKeyRespond = () =>
	unkeyEnvelope({ valid: true, code: "VALID", meta: { expiry: "2030-01-01" } });

type ScenarioName =
	| "noKey"
	| "cache"
	| "validTrue"
	| "validFalse"
	| "expiredMeta"
	| "serverError"
	| "unreachable"
	| "malformedMeta";

type ScenarioConfig = {
	unreachable?: boolean;
	extraEnv?: Record<string, string>;
	respond?: (url: URL, request: Request) => Response | Effect.Effect<Response>;
};

const scenarioConfigs: Record<ScenarioName, ScenarioConfig> = {
	noKey: { extraEnv: { SERVER_PRO_KEY: "" } },
	unreachable: { unreachable: true, extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE } },
	cache: { respond: () => validKeyRespond(), extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE } },
	validTrue: {
		respond: () => validKeyRespond(),
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
	},
	serverError: {
		extraEnv: { SERVER_PRO_KEY: VALID_KEY_ENV_VALUE },
		respond: () => new Response(null, { status: 500 }),
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
};

type Infrastructure = Effect.Success<ReturnType<typeof startCoreTestInfrastructure>>;

type ScenarioInstance = {
	fake?: Effect.Success<ReturnType<typeof startFakeHttpServerScoped>>;
	target: Effect.Success<ReturnType<typeof startApiProcess>>["target"];
};

let infrastructure: undefined | Infrastructure;
const resources = makeTestResourceScope();

function requireFake(instance: ScenarioInstance) {
	return requirePresent(instance.fake, "Fake Unkey server is not initialised for this scenario");
}

beforeAll(() =>
	runPromise(
		resources.run(
			Effect.gen(function* () {
				infrastructure = yield* startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });
			}),
		),
	),
);

// Each scenario's API lives only for its test, so at most one runs at a time.
const withScenario = <A, E, R>(
	name: ScenarioName,
	body: (instance: ScenarioInstance) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const shared = requirePresent(infrastructure, "Pro key infrastructure is not initialised");
		const config = scenarioConfigs[name];
		const port = yield* Effect.promise(() => getPort());
		const fake = config.unreachable ? undefined : yield* startFakeHttpServerScoped(config.respond);
		const verificationUrl = config.unreachable
			? `http://127.0.0.1:${yield* Effect.promise(() => getPort())}`
			: requirePresent(fake, `Fake Unkey server missing for scenario '${name}'`).url;
		const apiOrigin = `http://127.0.0.1:${port}`;
		const process = yield* startApiProcess(
			buildApiEnv({
				port,
				dbUrl: shared.dbUrl,
				frontendUrl: apiOrigin,
				label: `Pro key ${name}`,
				s3BucketName: S3_BUCKET_NAME,
				s3Endpoint: shared.s3Endpoint,
				extraEnv: { SERVER_PRO_KEY_VERIFICATION_URL: verificationUrl, ...config.extraEnv },
			}),
			`Pro key ${name}`,
		);
		return yield* body({ fake, target: process.target });
	});

afterAll(() => runPromise(resources.close));

describe("GET /system/config without SERVER_PRO_KEY", () => {
	it.live("reports isServerKeyValidated: false and makes no Unkey request", () =>
		withScenario("noKey", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(false);
				expect(requireFake(instance).requests).toHaveLength(0);
			}),
		),
	);
});

describe("GET /system/config with a valid Pro Key", () => {
	it.live("reports isServerKeyValidated: true", () =>
		withScenario("validTrue", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(true);
			}),
		),
	);
});

describe("GET /system/config with an invalid Pro Key", () => {
	it.live("reports isServerKeyValidated: false when Unkey reports valid: false", () =>
		withScenario("validFalse", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(false);
			}),
		),
	);

	it.live("reports isServerKeyValidated: false when the key has expired", () =>
		withScenario("expiredMeta", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(false);
			}),
		),
	);

	it.live("reports isServerKeyValidated: false when the expiry is not a date", () =>
		withScenario("malformedMeta", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(false);
			}),
		),
	);
});

describe("GET /system/config when Unkey is unavailable", () => {
	it.live("fails safe to false and keeps the server healthy when Unkey returns 500", () =>
		withScenario("serverError", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(false);
				const health = yield* client.call((c) => c.system.health());
				expect(health.status).toBe("healthy");
			}),
		),
	);

	it.live("fails safe to false and keeps the server healthy when Unkey is unreachable", () =>
		withScenario("unreachable", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				const data = yield* client.call((c) => c.system.config());
				expect(data.pro.isServerKeyValidated).toBe(false);
				const health = yield* client.call((c) => c.system.health());
				expect(health.status).toBe("healthy");
			}),
		),
	);
});

describe("Pro Key verification cache", () => {
	it.live("issues exactly one Unkey request across repeated /system/config hits", () =>
		withScenario("cache", (instance) =>
			Effect.gen(function* () {
				const client = makeSession(instance.target);
				for (let attempt = 0; attempt < 3; attempt++) {
					const data = yield* client.call((c) => c.system.config());
					expect(data.pro.isServerKeyValidated).toBe(true);
				}
				expect(requireFake(instance).requests).toHaveLength(1);
			}),
		),
	);
});
