import { describe, expect, it } from "bun:test";
import {
	formatSidebarAccountDate,
	getSidebarAccountInitials,
	toSidebarAccount,
} from "./sidebar-account";

describe("toSidebarAccount", () => {
	it("maps route user data to sidebar account details", () => {
		const result = toSidebarAccount({
			id: "user-1",
			image: null,
			emailVerified: true,
			name: "Ada Lovelace",
			email: "ada@example.com",
			createdAt: "2026-03-01T12:00:00.000Z",
			updatedAt: "2026-03-10T08:30:00.000Z",
		});

		expect(result).toEqual({
			image: null,
			id: "user-1",
			emailVerified: true,
			name: "Ada Lovelace",
			email: "ada@example.com",
			createdAt: "2026-03-01T12:00:00.000Z",
			updatedAt: "2026-03-10T08:30:00.000Z",
		});
	});
});

describe("getSidebarAccountInitials", () => {
	it("uses initials from the account name", () => {
		expect(getSidebarAccountInitials("Ada Lovelace", "ada@example.com")).toBe(
			"AL",
		);
	});

	it("falls back to the email when name is blank", () => {
		expect(getSidebarAccountInitials("", "ada@example.com")).toBe("AD");
	});
});

describe("formatSidebarAccountDate", () => {
	it("formats iso dates for account metadata", () => {
		expect(formatSidebarAccountDate("2026-03-01T12:00:00.000Z")).toBe(
			"Mar 1, 2026",
		);
	});

	it("returns an em dash for missing values", () => {
		expect(formatSidebarAccountDate(undefined)).toBe("--");
	});
});
