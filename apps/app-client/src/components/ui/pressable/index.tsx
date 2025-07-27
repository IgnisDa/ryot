import { createPressable } from "@gluestack-ui/core/pressable/creator";
import React from "react";
import { Pressable as RNPressable } from "react-native";

const UIPressable = createPressable({ Root: RNPressable });

type IPressableProps = React.ComponentPropsWithoutRef<typeof UIPressable> & {
	className?: string;
};

const Pressable = React.forwardRef<React.ComponentRef<typeof UIPressable>, IPressableProps>(
	function Pressable(props, ref) {
		const { className, ...rest } = props;
		return <UIPressable ref={ref} {...rest} className={className} />;
	},
);

Pressable.displayName = "Pressable";

export { Pressable };
