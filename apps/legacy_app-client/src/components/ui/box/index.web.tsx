import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";

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
	{ className, onLayout: _onLayout, ...props },
	ref,
) {
	return <div ref={ref} className={boxStyle({ class: className })} {...props} />;
});

Box.displayName = "Box";

export { Box };
