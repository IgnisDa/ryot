import { isWeb, tva } from "@gluestack-ui/utils/nativewind-utils";
import clsx from "clsx";

// oxlint-disable-next-line typescript-eslint/no-unnecessary-condition
const baseStyle = isWeb ? "flex flex-col relative z-0" : "";

export const centerStyle = tva({
	base: clsx("justify-center items-center", baseStyle),
});
