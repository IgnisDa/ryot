import { Effect } from "effect";
import { motion } from "motion/react";

import { impactHaptic } from "#/modules/device/haptics";
import { EDGE_SWIPE_WIDTH } from "#/modules/navigation/drawer-metrics";
import type { EdgeResolution } from "#/modules/navigation/edge-intent";

const OPEN_VELOCITY_PX_PER_SECOND = 500;
const DRAWER_MAX_WIDTH = 320;
const DRAWER_WIDTH_RATIO = 0.82;

export const completesEdgeGesture = (offset: number, width: number, velocity: number) =>
	offset > width / 3 || velocity > OPEN_VELOCITY_PX_PER_SECOND;

export function EdgeGesture(props: {
	readonly isOpen: boolean;
	readonly onBack: () => void;
	readonly edge: EdgeResolution;
}) {
	if (props.isOpen || props.edge.owner === "plugin" || props.edge.intent !== "back") {
		return null;
	}

	return (
		<motion.div
			aria-hidden="true"
			data-testid="edge-gesture"
			className="fixed inset-y-0 left-0 z-30 md:hidden"
			style={{ touchAction: "pan-y", width: EDGE_SWIPE_WIDTH }}
			onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
			onPanEnd={(_event, info) => {
				const width = Math.min(
					DRAWER_MAX_WIDTH,
					Math.round(window.innerWidth * DRAWER_WIDTH_RATIO),
				);
				if (
					info.offset.x <= Math.abs(info.offset.y) ||
					!completesEdgeGesture(info.offset.x, width, info.velocity.x)
				) {
					return;
				}
				Effect.runFork(impactHaptic);
				props.onBack();
			}}
		/>
	);
}
