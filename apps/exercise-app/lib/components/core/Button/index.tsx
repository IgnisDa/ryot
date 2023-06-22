import {
	Group,
	GroupHSpacer,
	GroupVSpacer,
	Icon,
	Root,
	Spinner,
	Text,
} from "./styled-components";
import { createButton } from "@gluestack-ui/button";

export const Button = createButton({
	Root,
	Text,
	Group,
	GroupHSpacer,
	GroupVSpacer,
	Spinner,
	Icon,
});
