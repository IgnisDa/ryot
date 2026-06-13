import type { ImageColorsResult } from "react-native-image-colors";

type AndroidColors = Pick<
	Extract<ImageColorsResult, { platform: "android" }>,
	"darkMuted" | "dominant" | "platform"
>;
type IOSColors = Pick<Extract<ImageColorsResult, { platform: "ios" }>, "background" | "platform">;
type WebColors = Pick<
	Extract<ImageColorsResult, { platform: "web" }>,
	"darkMuted" | "dominant" | "platform"
>;

type SavedViewImageColors = AndroidColors | IOSColors | WebColors;

export const SAVED_VIEW_COLOR_FALLBACK = "#010203";

const parseHexColor = (color: string) => {
	if (!/^#[\dA-F]{3}(?:[\dA-F]{3})?$/i.test(color)) {
		return undefined;
	}
	const hex =
		color.length === 4
			? Array.from(color.slice(1), (value) => value.repeat(2)).join("")
			: color.slice(1);
	return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
};

const normalizeTint = (color: string) => {
	const rgb = parseHexColor(color);
	if (!rgb || color.toUpperCase() === SAVED_VIEW_COLOR_FALLBACK) {
		return undefined;
	}
	const max = Math.max(...rgb);
	const min = Math.min(...rgb);
	const delta = max - min;
	const lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	let hue = 0;
	if (delta !== 0) {
		if (max === rgb[0]) {
			hue = ((rgb[1] - rgb[2]) / delta) % 6;
		}
		if (max === rgb[1]) {
			hue = (rgb[2] - rgb[0]) / delta + 2;
		}
		if (max === rgb[2]) {
			hue = (rgb[0] - rgb[1]) / delta + 4;
		}
		hue = (hue * 60 + 360) % 360;
	}
	const normalizedLightness = Math.min(0.37, Math.max(0.27, lightness));
	const normalizedSaturation = Math.min(0.4, saturation);
	const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
	const segment = hue / 60;
	const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
	let channels = [chroma, 0, secondary];
	if (segment < 1) {
		channels = [chroma, secondary, 0];
	} else if (segment < 2) {
		channels = [secondary, chroma, 0];
	} else if (segment < 3) {
		channels = [0, chroma, secondary];
	} else if (segment < 4) {
		channels = [0, secondary, chroma];
	} else if (segment < 5) {
		channels = [secondary, 0, chroma];
	}
	const match = normalizedLightness - chroma / 2;
	return `#${channels
		.map((channel) =>
			Math.round((channel + match) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`.toUpperCase();
};

export const deriveSavedViewTint = (colors: SavedViewImageColors) => {
	const candidates =
		colors.platform === "ios" ? [colors.background] : [colors.darkMuted, colors.dominant];
	for (const color of candidates) {
		const tint = normalizeTint(color);
		if (tint) {
			return tint;
		}
	}
	return undefined;
};

export const getSavedViewTintGradientStops = (tint: string) => {
	const normalized = parseHexColor(tint);
	if (!normalized) {
		return undefined;
	}
	const hex = normalized
		.map((channel) =>
			Math.round(channel * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")
		.toUpperCase();
	return [`#${hex}52`, `#${hex}1F`, `#${hex}00`] as const;
};
