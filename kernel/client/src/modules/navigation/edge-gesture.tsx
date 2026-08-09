import { type MotionValue, animate, motion, useReducedMotion } from "motion/react";
import { useRef } from "react";

import { EDGE_SWIPE_WIDTH, drawerWidth, gestureSpring } from "#/modules/navigation/drawer-metrics";
import type { EdgeResolution } from "#/modules/navigation/edge-intent";
import { impactLight } from "#/modules/navigation/haptics";

const OPEN_VELOCITY_PX_PER_SECOND = 500;
const ACTIVATION_DISTANCE = 6;

export const completesEdgeGesture = (offset: number, width: number, velocity: number) =>
	offset > width / 3 || velocity > OPEN_VELOCITY_PX_PER_SECOND;

type EdgeGestureProps = {
	readonly isOpen: boolean;
	readonly onBack: () => void;
	readonly edge: EdgeResolution;
	readonly progress: MotionValue<number>;
	readonly onOpenChange: (open: boolean) => void;
};

export function EdgeGesture(props: EdgeGestureProps) {
	const width = useRef(0);
	const { intent, owner } = props.edge;
	const engaged = useRef(false);
	const reduceMotion = useReducedMotion() === true;

	if (props.isOpen || owner !== "kernel" || intent === "none") {
		return null;
	}

	const settle = (open: boolean, velocity: number) => {
		if (open !== props.isOpen) {
			props.onOpenChange(open);
			return;
		}
		if (reduceMotion) {
			props.progress.set(open ? 1 : 0);
			return;
		}
		void animate(props.progress, open ? 1 : 0, gestureSpring(velocity));
	};

	return (
		<motion.div
			aria-hidden="true"
			data-testid="edge-gesture"
			className="fixed inset-y-0 left-0 z-30 md:hidden"
			style={{ width: EDGE_SWIPE_WIDTH, touchAction: "pan-y" }}
			onPan={(_event, info) => {
				if (!engaged.current) {
					const horizontal = Math.abs(info.offset.x) > Math.abs(info.offset.y);
					if (info.offset.x <= ACTIVATION_DISTANCE || !horizontal) {
						return;
					}
					engaged.current = true;
					width.current = drawerWidth(window.innerWidth);
				}
				if (intent === "drawer") {
					props.progress.set(Math.min(1, Math.max(0, info.offset.x / width.current)));
				}
			}}
			onPanEnd={(_event, info) => {
				if (!engaged.current) {
					return;
				}
				engaged.current = false;
				const completed = completesEdgeGesture(info.offset.x, width.current, info.velocity.x);
				if (completed) {
					impactLight();
				}
				if (intent === "back") {
					if (completed) {
						props.onBack();
					}
					return;
				}
				settle(completed, info.velocity.x / width.current);
			}}
		/>
	);
}
