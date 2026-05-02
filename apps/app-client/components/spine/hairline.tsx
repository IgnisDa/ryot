import type { SharedValue } from "react-native-reanimated";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { RAIL_WIDTH } from "./rail";

type Props = { railTranslateX: SharedValue<number> };

export function SpineHairline({ railTranslateX }: Props) {
	const style = useAnimatedStyle(() => ({
		opacity: railTranslateX.value > RAIL_WIDTH - 8 ? 0.18 : 0,
	}));

	return (
		<Animated.View
			style={style}
			pointerEvents="none"
			className="absolute top-0 right-0 bottom-0 w-1 z-30 bg-ink"
		/>
	);
}
