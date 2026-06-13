import { Effect, Option, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { getSandboxAppConfigValue } from "./app-config";

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
	port: 3000,
	tmpDir: "/tmp",
	nodeEnv: "test",
	timezone: "Etc/GMT",
	builtinExercisePreloadLimit: 873,
	frontendUrl: "http://localhost:3000",
	frontend: { oidcButtonLabel: Option.none() },
	redisUrl: Redacted.make("redis://localhost"),
	databaseUrl: Redacted.make("postgres://localhost"),
	users: { allowRegistration: true, disableLocalAuth: false },
	scheduler: { frequentCronJobsSchedule: "every 5 minutes", progressUpdateThresholdHours: 2 },
	sandbox: {
		timeoutMs: 5000,
		denoDir: "/tmp/deno",
		workerConcurrency: 5,
		jobIdSecret: Redacted.make("test-secret"),
	},
	server: {
		corsOrigins: Option.none<string>(),
		adminAccessToken: Redacted.make("admin-token"),
		oidc: {
			clientId: Option.none<string>(),
			issuerUrl: Option.none<string>(),
			clientSecret: Option.none<Redacted.Redacted>(),
		},
	},
	fileStorage: {
		url: Option.none(),
		region: Option.none(),
		bucketName: Option.none(),
		accessKeyId: Option.none(),
		secretAccessKey: Option.none(),
	},
	providers: {
		tvdbApiKey: Option.none(),
		malClientId: Option.none(),
		traktClientId: Option.none(),
		metronUsername: Option.none(),
		twitchClientId: Option.none(),
		tmdbAccessToken: Option.none(),
		metronPassword: Option.none(),
		hardcoverApiKey: Option.none(),
		spotifyClientId: Option.none(),
		giantBombApiKey: Option.none(),
		googleBooksApiKey: Option.none(),
		listennotesApiKey: Option.none(),
		twitchClientSecret: Option.none(),
		spotifyClientSecret: Option.none(),
	},
	...overrides,
});

const run = (key: string, isBuiltin: boolean, config = makeConfig()) =>
	Effect.runSync(Effect.either(getSandboxAppConfigValue(config, key, isBuiltin)));

describe("getSandboxAppConfigValue", () => {
	it("returns the value for a non-sensitive top-level key", () => {
		const result = run("port", false);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe(3000);
		}
	});

	it("returns the value for a non-sensitive nested key", () => {
		const result = run("sandbox.denoDir", false);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("/tmp/deno");
		}
	});

	it("fails for a key that does not exist in the meta", () => {
		const result = run("nonexistent.key", false);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toContain("does not exist");
		}
	});

	it("fails for a key with an empty segment", () => {
		const result = run(".invalid", false);
		expect(result._tag).toBe("Left");
	});

	it("fails for a key that resolves to a group, not a field", () => {
		const result = run("sandbox", false);
		expect(result._tag).toBe("Left");
	});

	it("fails for a sensitive key when the script is not builtin", () => {
		const result = run("sandbox.jobIdSecret", false);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toContain("sensitive");
		}
	});

	it("unwraps a Redacted value for a sensitive key when the script is builtin", () => {
		const result = run("sandbox.jobIdSecret", true);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("test-secret");
		}
	});

	it("fails when an optional key is not configured (Option.none)", () => {
		const result = run("server.corsOrigins", false);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toContain("not configured");
		}
	});

	it("returns the inner value when an optional key is configured (Option.some)", () => {
		const config = makeConfig({
			server: {
				...makeConfig().server,
				corsOrigins: Option.some("http://localhost:3000"),
			},
		});
		const result = run("server.corsOrigins", false, config);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("http://localhost:3000");
		}
	});

	it("returns the plain string value for a non-sensitive non-secret key", () => {
		const result = run("timezone", false);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("Etc/GMT");
		}
	});
});
