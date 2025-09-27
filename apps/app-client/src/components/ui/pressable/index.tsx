import { createPressable } from "@gluestack-ui/core/pressable/creator";
import React from "react";
import { Pressable as RNPressable } from "react-native";

const UIPressable = createPressable({ Root: RNPressable });

type IPressableProps = React.ComponentPropsWithoutRef<typeof UIPressable> & {
	className?: string;
};

const Pressable = React.forwardRef<
	React.ComponentRef<typeof UIPressable>,
	IPressableProps
>(function Pressable({ className, ...props }, ref) {
	return <UIPressable ref={ref} {...props} className={className} />;
});

Pressable.displayName = "Pressable";

export { Pressable };
