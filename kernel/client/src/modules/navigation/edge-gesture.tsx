import { type MotionValue, animate, motion, useReducedMotion } from "motion/react";
import { useRef } from "react";

import { EDGE_SWIPE_WIDTH, drawerWidth } from "#/modules/navigation/drawer-metrics";
import type { EdgeIntent } from "#/modules/navigation/edge-intent";

const OPEN_VELOCITY = 0.5;
const ACTIVATION_DISTANCE = 6;
const TIMING = { duration: 0.24, ease: "easeOut" } as const;

type EdgeGestureProps = {
	readonly isOpen: boolean;
	readonly intent: EdgeIntent;
	readonly onBack: () => void;
	readonly progress: MotionValue<number>;
	readonly onOpenChange: (open: boolean) => void;
};

export function EdgeGesture(props: EdgeGestureProps) {
	const width = useRef(0);
	const engaged = useRef(false);
	const reduceMotion = useReducedMotion() === true;

	if (props.isOpen || props.intent === "none") {
		return null;
	}

	const settle = (open: boolean) => {
		if (open !== props.isOpen) {
			props.onOpenChange(open);
			return;
		}
		if (reduceMotion) {
			props.progress.set(open ? 1 : 0);
			return;
		}
		void animate(props.progress, open ? 1 : 0, TIMING);
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
				if (props.intent === "drawer") {
					props.progress.set(Math.min(1, Math.max(0, info.offset.x / width.current)));
				}
			}}
			onPanEnd={(_event, info) => {
				if (!engaged.current) {
					return;
				}
				engaged.current = false;
				const completed = info.offset.x > width.current / 3 || info.velocity.x > OPEN_VELOCITY;
				if (props.intent === "back") {
					if (completed) {
						props.onBack();
					}
					return;
				}
				settle(completed);
			}}
		/>
	);
}
