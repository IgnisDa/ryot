import type { RyotClientAdapter } from "./index";

// Fills only the required capabilities, so tests of a missing optional one still see
// `unsupported-capability`.
export const createTestRyotAdapter = (
	overrides: Partial<RyotClientAdapter> = {},
): RyotClientAdapter => ({
	query: () => Promise.resolve({}),
	uploadTemporary: () =>
		Promise.resolve({ token: "test-upload-token", expiresAt: "2026-01-01T00:00:00.000Z" }),
	...overrides,
});
