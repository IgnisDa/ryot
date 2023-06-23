import {
	Error,
	ErrorIcon,
	ErrorText,
	Helper,
	HelperText,
	Label,
	LabelAstrick,
	LabelText,
	Root,
} from "./styled-components";
import { createFormControl } from "@gluestack-ui/form-control";

export const FormControl = createFormControl({
	Root,
	Error,
	ErrorText,
	ErrorIcon,
	Label,
	LabelText,
	LabelAstrick,
	Helper,
	HelperText,
});
