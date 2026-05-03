import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";
import { centerStyle } from "./styles";

type ICenterProps = ViewProps & VariantProps<typeof centerStyle>;

const Center = React.forwardRef<React.ComponentRef<typeof View>, ICenterProps>(
	function Center({ className, ...props }, ref) {
		return (
			<View
				className={centerStyle({ class: className })}
				{...props}
				ref={ref}
			/>
		);
	},
);

Center.displayName = "Center";

export { Center };
