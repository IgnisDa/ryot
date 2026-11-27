import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";

import { boxStyle } from "./styles";

type IBoxProps = ViewProps & VariantProps<typeof boxStyle> & { className?: string };

const Box = React.forwardRef<React.ComponentRef<typeof View>, IBoxProps>(function Box(props, ref) {
	const { className, ...rest } = props;
	return <View ref={ref} {...rest} className={boxStyle({ class: className })} />;
});

Box.displayName = "Box";

export { Box };
