import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const paletteCss = readFileSync(`${import.meta.dirname}/palette.css`, "utf8");

const blockAt = (marker: string) => {
	const start = paletteCss.indexOf(marker);
	if (start === -1) {
		throw new Error(`palette.css has no "${marker}" block`);
	}
	return paletteCss.slice(start, paletteCss.indexOf("\n}", start));
};

const declarationsOf = (block: string) =>
	new Map(
		[...block.matchAll(/^\t+(--[\w-]+):\s*([^;]+);$/gm)].map(([, token, value]) => [
			token,
			value.trim(),
		]),
	);

const light = declarationsOf(blockAt(":root,"));
const mediaDark = declarationsOf(blockAt("@media (prefers-color-scheme: dark) {"));
const attributeDark = declarationsOf(blockAt(':root[data-theme="dark"] {'));
const dark = new Map([...light, ...mediaDark]);

const colorOf = (palette: Map<string, string>, token: string) => {
	const value = palette.get(token);
	if (value === undefined || !/^#[\da-f]{6}$/i.test(value)) {
		throw new Error(`Token ${token} is not a six-digit hex color: ${String(value)}`);
	}
	const channel = (offset: number) => {
		const srgb = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
		return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const contrastRatio = (palette: Map<string, string>, foreground: string, background: string) => {
	const first = colorOf(palette, foreground);
	const second = colorOf(palette, background);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

const readableSurfaces = ["--bg", "--surface", "--surface-2", "--raised"] as const;

const textPairs = [
	["--info", readableSurfaces],
	["--danger", readableSurfaces],
	["--accent-ink", ["--accent"]],
	["--text-subtle", readableSurfaces],
	["--danger-ink", ["--danger-solid"]],
	["--text-muted", [...readableSurfaces, "--accent-soft"]],
	["--success", [...readableSurfaces, "--success-soft"]],
	["--accent-text", [...readableSurfaces, "--accent-soft"]],
	["--text", [...readableSurfaces, "--accent-soft", "--success-soft"]],
] as const;

const boundaryPairs = [
	["--focus", readableSurfaces],
	["--border-strong", readableSurfaces],
	["--accent-border", ["--accent-soft"]],
	["--accent-deep", ["--bg", "--surface", "--accent-soft"]],
] as const;

const themes = [
	["light", light],
	["dark", dark],
] as const;

describe("palette contrast", () => {
	it("resolves the dark theme identically from the media query and the theme attribute", () => {
		expect([...attributeDark]).toEqual([...mediaDark]);
	});

	it("declares a decorative border token", () => {
		expect(light.get("--border")).toMatch(/^#[\da-f]{6}$/i);
		expect(dark.get("--border")).toMatch(/^#[\da-f]{6}$/i);
	});

	for (const [theme, palette] of themes) {
		it(`keeps ${theme} text pairs at or above 4.5:1`, () => {
			for (const [foreground, backgrounds] of textPairs) {
				for (const background of backgrounds) {
					const ratio = contrastRatio(palette, foreground, background);
					expect(
						ratio,
						`${theme}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below the 4.5:1 text threshold`,
					).toBeGreaterThanOrEqual(4.5);
				}
			}
		});

		it(`keeps ${theme} boundary and state pairs at or above 3:1`, () => {
			for (const [foreground, backgrounds] of boundaryPairs) {
				for (const background of backgrounds) {
					const ratio = contrastRatio(palette, foreground, background);
					expect(
						ratio,
						`${theme}: ${foreground} against ${background} is ${ratio.toFixed(2)}:1, below the 3:1 non-text threshold`,
					).toBeGreaterThanOrEqual(3);
				}
			}
		});
	}
});
