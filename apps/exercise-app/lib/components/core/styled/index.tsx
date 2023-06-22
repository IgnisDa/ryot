import { AnimationResolver } from "@gluestack-style/animation-plugin";
import {
	createStyled,
	// FontResolver
} from "@gluestack-style/react";

// const fontMapper = (style: any) => {};

export const styled = createStyled([
	new AnimationResolver({}),
	// new FontResolver({
	// mapFonts: fontMapper,
	// }),
]);
