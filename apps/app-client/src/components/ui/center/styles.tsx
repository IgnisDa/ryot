import { isWeb, tva } from "@gluestack-ui/utils/nativewind-utils";

// oxlint-disable-next-line typescript-eslint/no-unnecessary-condition
const baseStyle = isWeb ? "flex flex-col relative z-0" : "";

export const centerStyle = tva({
	base: `justify-center items-center ${baseStyle}`,
});
