import { StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { C } from "@/lib/theme";

type Props = { railTranslateX: SharedValue<number> };

export function SpineHairline({ railTranslateX }: Props) {
	const style = useAnimatedStyle(() => ({
		opacity: railTranslateX.value < -8 ? 0 : 0.18,
	}));

	return <Animated.View style={[styles.hairline, style]} />;
}

const styles = StyleSheet.create({
	hairline: {
		top: 0,
		right: 0,
		bottom: 0,
		width: 4,
		zIndex: 30,
		position: "absolute",
		pointerEvents: "none",
		backgroundColor: C.ink,
	},
});
