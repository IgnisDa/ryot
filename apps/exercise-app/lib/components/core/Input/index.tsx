import { Icon, Root, StyledInput } from "./styled-components";
import { createInput } from "@gluestack-ui/input";

export const Input = createInput({
	Root,
	Icon,
	Input: StyledInput,
});
