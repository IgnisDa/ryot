export const CONTENT_SHIFT = 18;
export const EDGE_SWIPE_WIDTH = 24;
export const DRAWER_MAX_WIDTH = 320;
export const DRAWER_WIDTH_RATIO = 0.82;

export const drawerWidth = (viewportWidth: number) =>
	Math.min(DRAWER_MAX_WIDTH, Math.round(viewportWidth * DRAWER_WIDTH_RATIO));

export const gestureSpring = (velocity = 0) =>
	({ velocity, bounce: 0.05, type: "spring", visualDuration: 0.28 }) as const;
