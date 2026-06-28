export const HEADER_ROW_HEIGHT = 54;
export const HEADER_LARGE_TITLE_HEIGHT = 56;

const SURFACE_FADE_HEIGHT = 28;
const TITLE_FADE_START_RATIO = 0.45;

const clampProgress = (value: number) => {
	"worklet";
	return Math.min(1, Math.max(0, value));
};

export const compactTitleProgress = (offset: number, heroHeight = 0) => {
	"worklet";
	const titleStart = heroHeight > 0 ? Math.max(0, heroHeight - HEADER_ROW_HEIGHT) : 0;
	const end = titleStart + HEADER_LARGE_TITLE_HEIGHT;
	const start = titleStart + HEADER_LARGE_TITLE_HEIGHT * TITLE_FADE_START_RATIO;
	return clampProgress((offset - start) / (end - start));
};

export const headerSurfaceProgress = (offset: number, heroHeight = 0) => {
	"worklet";
	const start =
		heroHeight > 0 ? Math.max(0, heroHeight - HEADER_ROW_HEIGHT - SURFACE_FADE_HEIGHT) : 0;
	return clampProgress((offset - start) / SURFACE_FADE_HEIGHT);
};
