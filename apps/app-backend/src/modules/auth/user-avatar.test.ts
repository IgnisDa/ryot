import { expect, it } from "@effect/vitest";

import { generateUserAvatar } from "./user-avatar";

it("returns a data URI for the generated SVG", () => {
	expect(generateUserAvatar("user-id").startsWith("data:image/svg+xml;")).toBe(true);
});

it("is deterministic for the same seed", () => {
	expect(generateUserAvatar("user-id")).toBe(generateUserAvatar("user-id"));
});

it("produces different avatars for different seeds", () => {
	expect(generateUserAvatar("user-a")).not.toBe(generateUserAvatar("user-b"));
});

it("uses one of the configured background colors", () => {
	const avatar = generateUserAvatar("user-id");
	const paletteColors = ["ff2e63", "00c2a8", "ffb300", "3d5afe", "8e24aa", "00e676"];
	expect(paletteColors.some((color) => avatar.includes(color))).toBe(true);
});
