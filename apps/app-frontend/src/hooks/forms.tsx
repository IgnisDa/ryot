import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import {
	Select,
	SubscribeButton,
	TextArea,
	TextField,
} from "../components/demo.FormComponents";

export const { fieldContext, useFieldContext, formContext, useFormContext } =
	createFormHookContexts();

export const { useAppForm } = createFormHook({
	fieldContext,
	formContext,
	formComponents: { SubscribeButton },
	fieldComponents: { Select, TextArea, TextField },
});
