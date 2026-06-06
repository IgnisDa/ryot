import { describe, expect, it, vi } from "vitest";

import type { ListedIntegration } from "./schemas";
import { createCheckAndAutoDisable, validateProgressThresholds } from "./service";

const makeIntegration = (overrides: Partial<ListedIntegration> = {}): ListedIntegration => ({
	name: null,
	id: "int_1",
	lot: "yank",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	lastFinishedAt: null,
	syncOwnership: false,
	provider: "audiobookshelf",
	createdAt: "2026-06-17T00:00:00.000Z",
	updatedAt: "2026-06-17T00:00:00.000Z",
	extraSettings: { disableOnContinuousErrors: true },
	providerSpecifics: { kind: "audiobookshelf", token: "tok", baseUrl: "http://abs.local" },
	...overrides,
});

const failedRun = { status: "failed" } as const;
const completedRun = { status: "completed" } as const;

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

describe("createCheckAndAutoDisable", () => {
	it("no-ops when integration is not found", () => {
		const disableIntegration = vi.fn(() => Promise.resolve(undefined));
		const listRecentStatuses = vi.fn(() => Promise.resolve([]));
		const checkAndAutoDisable = createCheckAndAutoDisable({
			disableIntegration,
			listRecentStatuses,
			getIntegration: () => Promise.resolve(null),
		});

		return expect(checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" }))
			.resolves.toBeUndefined()
			.then(() => {
				expect(listRecentStatuses).not.toHaveBeenCalled();
				expect(disableIntegration).not.toHaveBeenCalled();
				return undefined;
			});
	});

	it("no-ops when disableOnContinuousErrors is false", () => {
		const disableIntegration = vi.fn(() => Promise.resolve(undefined));
		const listRecentStatuses = vi.fn(() => Promise.resolve(Array(5).fill(failedRun)));
		const checkAndAutoDisable = createCheckAndAutoDisable({
			disableIntegration,
			listRecentStatuses,
			getIntegration: () =>
				Promise.resolve(makeIntegration({ extraSettings: { disableOnContinuousErrors: false } })),
		});

		return expect(checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" }))
			.resolves.toBeUndefined()
			.then(() => {
				expect(listRecentStatuses).not.toHaveBeenCalled();
				expect(disableIntegration).not.toHaveBeenCalled();
				return undefined;
			});
	});

	it("no-ops when fewer than 5 runs exist", () => {
		const disableIntegration = vi.fn(() => Promise.resolve(undefined));
		const listRecentStatuses = vi.fn(() => Promise.resolve(Array(4).fill(failedRun)));
		const checkAndAutoDisable = createCheckAndAutoDisable({
			disableIntegration,
			listRecentStatuses,
			getIntegration: () => Promise.resolve(makeIntegration()),
		});

		return expect(checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" }))
			.resolves.toBeUndefined()
			.then(() => {
				expect(disableIntegration).not.toHaveBeenCalled();
				return undefined;
			});
	});

	it("no-ops when not all 5 runs failed", () => {
		const disableIntegration = vi.fn(() => Promise.resolve(undefined));
		const listRecentStatuses = vi.fn(() =>
			Promise.resolve([failedRun, failedRun, failedRun, failedRun, completedRun]),
		);
		const checkAndAutoDisable = createCheckAndAutoDisable({
			disableIntegration,
			listRecentStatuses,
			getIntegration: () => Promise.resolve(makeIntegration()),
		});

		return expect(checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" }))
			.resolves.toBeUndefined()
			.then(() => {
				expect(disableIntegration).not.toHaveBeenCalled();
				return undefined;
			});
	});

	it("disables the integration after 5 consecutive failures", () => {
		const disableIntegration = vi.fn(() => Promise.resolve(undefined));
		const checkAndAutoDisable = createCheckAndAutoDisable({
			disableIntegration,
			getIntegration: () => Promise.resolve(makeIntegration()),
			listRecentStatuses: () => Promise.resolve(Array(5).fill(failedRun)),
		});

		return checkAndAutoDisable({ integrationId: "int_1", userId: "user_1" }).then(() => {
			expect(disableIntegration).toHaveBeenCalledWith({ userId: "user_1", integrationId: "int_1" });
			return undefined;
		});
	});
});
