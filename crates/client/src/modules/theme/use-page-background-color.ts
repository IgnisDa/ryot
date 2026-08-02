import { useAtomValue } from "@effect/atom-react";
import { useColorScheme } from "react-native";

import { themeAtom } from "./atoms";
import { pageBackgroundColor } from "./page-background-color";

export const usePageBackgroundColor = () =>
	pageBackgroundColor(useAtomValue(themeAtom), useColorScheme());
