const parseHexColor = (color: string) => {
	if (!/^#[\dA-F]{3}(?:[\dA-F]{3})?$/i.test(color)) {
		return undefined;
	}
	const hex =
		color.length === 4
			? Array.from(color.slice(1), (value) => value.repeat(2)).join("")
			: color.slice(1);
	const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
	return [channel(0), channel(2), channel(4)] satisfies [number, number, number];
};

const normalizeTint = (color: string) => {
	const rgb = parseHexColor(color);
	if (!rgb) {
		return undefined;
	}
	const [r, g, b] = rgb;
	const max = Math.max(...rgb);
	const min = Math.min(...rgb);
	const delta = max - min;
	const lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	let hue = 0;
	if (delta !== 0) {
		if (max === r) {
			hue = ((g - b) / delta) % 6;
		}
		if (max === g) {
			hue = (b - r) / delta + 2;
		}
		if (max === b) {
			hue = (r - g) / delta + 4;
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

export const deriveImageTint = (colors: {
	readonly dominant?: string | undefined;
	readonly darkMuted?: string | undefined;
}) => {
	const candidates = [colors.darkMuted, colors.dominant];
	for (const color of candidates) {
		const tint = color === undefined ? undefined : normalizeTint(color);
		if (tint) {
			return tint;
		}
	}
	return undefined;
};

export const getImageTintGradientStops = (tint: string) => {
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

const MIN_ALPHA = 125;

const BITS_PER_CHANNEL = 4;

const BUCKET_SHIFT = 8 - BITS_PER_CHANNEL;

const BUCKET_SIZE = 2 ** BITS_PER_CHANNEL;

type Bucket = { rSum: number; gSum: number; bSum: number; count: number };

const rgbToHls = (r: number, g: number, b: number) => {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	const lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	return { lightness, saturation };
};

const toHex = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");

export const quantizeImageTintPixels = (pixels: Uint8ClampedArray) => {
	const buckets = new Map<number, Bucket>();
	for (let index = 0; index < pixels.length; index += 4) {
		const alpha = pixels[index + 3];
		if (alpha === undefined || alpha < MIN_ALPHA) {
			continue;
		}
		const r = pixels[index];
		const g = pixels[index + 1];
		const b = pixels[index + 2];
		if (r === undefined || g === undefined || b === undefined) {
			continue;
		}
		const key =
			((r >> BUCKET_SHIFT) * BUCKET_SIZE + (g >> BUCKET_SHIFT)) * BUCKET_SIZE + (b >> BUCKET_SHIFT);
		const bucket = buckets.get(key) ?? { count: 0, rSum: 0, gSum: 0, bSum: 0 };
		bucket.rSum += r;
		bucket.gSum += g;
		bucket.bSum += b;
		bucket.count += 1;
		buckets.set(key, bucket);
	}

	let dominantBucket: Bucket | undefined;
	let darkMutedBucket: Bucket | undefined;

	for (const bucket of buckets.values()) {
		if (dominantBucket === undefined || bucket.count > dominantBucket.count) {
			dominantBucket = bucket;
		}
		const { lightness, saturation } = rgbToHls(
			bucket.rSum / bucket.count / 255,
			bucket.gSum / bucket.count / 255,
			bucket.bSum / bucket.count / 255,
		);
		const isMuted = lightness >= 0.1 && lightness <= 0.5 && saturation >= 0.1 && saturation <= 0.7;
		if (isMuted && (darkMutedBucket === undefined || bucket.count > darkMutedBucket.count)) {
			darkMutedBucket = bucket;
		}
	}

	const toColor = (bucket: Bucket) =>
		`#${toHex(bucket.rSum / bucket.count)}${toHex(bucket.gSum / bucket.count)}${toHex(bucket.bSum / bucket.count)}`.toUpperCase();

	return {
		...(dominantBucket === undefined ? {} : { dominant: toColor(dominantBucket) }),
		...(darkMutedBucket === undefined ? {} : { darkMuted: toColor(darkMutedBucket) }),
	};
};
