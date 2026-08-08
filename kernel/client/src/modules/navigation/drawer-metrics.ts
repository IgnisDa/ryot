export const EDGE_SWIPE_WIDTH = 24;
export const DRAWER_MAX_WIDTH = 320;
export const DRAWER_WIDTH_RATIO = 0.82;

export const drawerWidth = (viewportWidth: number) =>
	Math.min(DRAWER_MAX_WIDTH, Math.round(viewportWidth * DRAWER_WIDTH_RATIO));
