import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HEADER_ROW_HEIGHT } from "./header-metrics";

export const useHeaderContentOffset = () => useSafeAreaInsets().top + HEADER_ROW_HEIGHT;
