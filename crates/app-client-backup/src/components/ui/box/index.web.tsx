import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { StyleSheet } from "react-native";

import { boxStyle } from "./styles";

type IBoxProps = React.ComponentPropsWithoutRef<"div"> &
	VariantProps<typeof boxStyle> & {
		className?: string;
		// React Native prop — ignored on web
		onLayout?: (event: {
			nativeEvent: { layout: { height: number; width: number; x: number; y: number } };
		}) => void;
	};

const Box = React.forwardRef<HTMLDivElement, IBoxProps>(function Box(
	{ className, onLayout: _onLayout, style, ...props },
	ref,
) {
	return (
		<div
			ref={ref}
			className={boxStyle({ class: className })}
			style={StyleSheet.flatten(style)}
			{...props}
		/>
	);
});

Box.displayName = "Box";

export { Box };
