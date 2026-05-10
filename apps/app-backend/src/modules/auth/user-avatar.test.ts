import { expect, it } from "@effect/vitest";

import { generateUserAvatar } from "./user-avatar";

const base64Prefix = "data:image/svg+xml;base64,";

const decodeAvatarSvg = (avatar: string) =>
	Buffer.from(avatar.slice(base64Prefix.length), "base64").toString("utf8");

it("returns a base64 data URI so native image loaders can decode it", () => {
	const avatar = generateUserAvatar("user-id");
	expect(avatar.startsWith(base64Prefix)).toBe(true);
	expect(decodeAvatarSvg(avatar).startsWith("<svg")).toBe(true);
});

it("is deterministic for the same seed", () => {
	expect(generateUserAvatar("user-id")).toBe(generateUserAvatar("user-id"));
});

it("produces different avatars for different seeds", () => {
	expect(generateUserAvatar("user-a")).not.toBe(generateUserAvatar("user-b"));
});

it("uses one of the configured background colors", () => {
	const svg = decodeAvatarSvg(generateUserAvatar("user-id"));
	const paletteColors = ["ff2e63", "00c2a8", "ffb300", "3d5afe", "8e24aa", "00e676"];
	expect(paletteColors.some((color) => svg.includes(color))).toBe(true);
});
