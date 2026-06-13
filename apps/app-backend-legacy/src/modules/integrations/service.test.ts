import { describe, expect, it } from "bun:test";

import type { ListedIntegration } from "./schemas";
import { createCheckAndAutoDisable, validateProgressThresholds } from "./service";

const makeIntegration = (
	overrides: Partial<ListedIntegration & { userId: string }> = {},
): ListedIntegration & { userId: string } => ({
	name: null,
	id: "int_1",
	lot: "yank",
	userId: "user_1",
	isDisabled: false,
	syncOwnership: false,
	lastFinishedAt: null,
	minimumProgress: "2",
	maximumProgress: "95",
	createdAt: new Date(),
	updatedAt: new Date(),
	provider: "audiobookshelf",
	extraSettings: { disableOnContinuousErrors: true },
	providerSpecifics: { kind: "audiobookshelf", baseUrl: "http://abs.local", token: "tok" },
	...overrides,
});

describe("validateProgressThresholds", () => {
	it("returns null for valid thresholds", () => {
		expect(validateProgressThresholds(2, 95)).toBeNull();
		expect(validateProgressThresholds(0, 100)).toBeNull();
		expect(validateProgressThresholds(50, 50)).toBeNull();
	});

	it("rejects minimumProgress below 0", () => {
		expect(validateProgressThresholds(-1, 95)).toMatch(/minimumProgress/);
	});

	it("rejects minimumProgress above 100", () => {
		expect(validateProgressThresholds(101, 101)).toMatch(/minimumProgress/);
	});

	it("rejects maximumProgress above 100", () => {
		expect(validateProgressThresholds(2, 101)).toMatch(/maximumProgress/);
	});

	it("rejects minimum greater than maximum", () => {
		expect(validateProgressThresholds(96, 95)).toMatch(/minimumProgress must not exceed/);
	});
});

const makeFailedRun = () => ({ status: "failed" as const });
const makePassedRun = () => ({ status: "completed" as const });
const updateIntegration = () => {
	throw new Error("should not be called");
};

describe("createCheckAndAutoDisable", () => {
	it("no-ops when integration is not found", async () => {
		const checkAndAutoDisable = createCheckAndAutoDisable({
			updateIntegration,
			getLastRuns: async () => Promise.resolve([]),
			removeYankJob: async () => Promise.resolve(undefined),
			getIntegration: async () => Promise.resolve(undefined),
		});
		const result = await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(result).toBeUndefined();
	});

	it("no-ops when disableOnContinuousErrors is false", async () => {
		const checkAndAutoDisable = createCheckAndAutoDisable({
			updateIntegration,
			removeYankJob: async () => Promise.resolve(undefined),
			getLastRuns: async () => Promise.resolve(Array(5).fill(makeFailedRun())),
			getIntegration: async () =>
				Promise.resolve(makeIntegration({ extraSettings: { disableOnContinuousErrors: false } })),
		});
		const result = await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(result).toBeUndefined();
	});

	it("no-ops when fewer than 5 runs exist", async () => {
		const checkAndAutoDisable = createCheckAndAutoDisable({
			updateIntegration,
			removeYankJob: async () => Promise.resolve(undefined),
			getIntegration: async () => Promise.resolve(makeIntegration()),
			getLastRuns: async () => Promise.resolve(Array(4).fill(makeFailedRun())),
		});
		const result = await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(result).toBeUndefined();
	});

	it("no-ops when not all 5 runs failed", async () => {
		const checkAndAutoDisable = createCheckAndAutoDisable({
			updateIntegration,
			removeYankJob: async () => Promise.resolve(undefined),
			getIntegration: async () => Promise.resolve(makeIntegration()),
			getLastRuns: async () =>
				Promise.resolve([
					makeFailedRun(),
					makeFailedRun(),
					makeFailedRun(),
					makeFailedRun(),
					makePassedRun(),
				]),
		});
		const result = await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(result).toBeUndefined();
	});

	it("disables the integration after 5 consecutive failures", async () => {
		let disabledId: string | undefined;
		const checkAndAutoDisable = createCheckAndAutoDisable({
			removeYankJob: async () => Promise.resolve(undefined),
			getIntegration: async () => Promise.resolve(makeIntegration()),
			getLastRuns: async () => Promise.resolve(Array(5).fill(makeFailedRun())),
			updateIntegration: async (input) => {
				disabledId = input.id;
				return Promise.resolve(makeIntegration({ isDisabled: true }));
			},
		});
		await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(disabledId).toBe("int_1");
	});

	it("removes the repeat job for yank integrations after auto-disable", async () => {
		let removedId: string | undefined;
		const checkAndAutoDisable = createCheckAndAutoDisable({
			getIntegration: async () => Promise.resolve(makeIntegration({ lot: "yank" })),
			getLastRuns: async () => Promise.resolve(Array(5).fill(makeFailedRun())),
			updateIntegration: async () => Promise.resolve(makeIntegration({ isDisabled: true })),
			removeYankJob: async (id) => {
				removedId = id;
				return Promise.resolve();
			},
		});
		await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(removedId).toBe("int_1");
	});

	it("does not remove the repeat job for non-yank integrations after auto-disable", async () => {
		let removeJobCalled = false;
		const checkAndAutoDisable = createCheckAndAutoDisable({
			getLastRuns: async () => Promise.resolve(Array(5).fill(makeFailedRun())),
			updateIntegration: async () => Promise.resolve(makeIntegration({ isDisabled: true })),
			getIntegration: async () =>
				Promise.resolve(makeIntegration({ lot: "sink", provider: "kodi" })),
			removeYankJob: () => {
				removeJobCalled = true;
				return Promise.resolve();
			},
		});
		await checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" });
		expect(removeJobCalled).toBe(false);
	});
});
