export const EDGE_SWIPE_WIDTH = 24;
export const COMMIT_VELOCITY = 0.5;
export const ACTIVATION_DISTANCE = 6;
export const PARALLAX_RATIO = 0.3;

export const shouldEngage = (input: { readonly dx: number; readonly dy: number }) =>
	input.dx > ACTIVATION_DISTANCE && Math.abs(input.dx) > Math.abs(input.dy);

export const shouldCommit = (input: {
	readonly dx: number;
	readonly vx: number;
	readonly width: number;
}) => input.dx > input.width / 3 || input.vx > COMMIT_VELOCITY;

export const dragProgress = (dx: number, width: number) =>
	width <= 0 ? 0 : Math.min(1, Math.max(0, dx / width));
