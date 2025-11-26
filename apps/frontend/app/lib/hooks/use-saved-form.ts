import type { UseFormInput, UseFormReturnType } from "@mantine/form";
import { useForm } from "@mantine/form";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useUserDetails } from "../shared/hooks";

interface UseSavedFormConfig<TValues> extends UseFormInput<TValues> {
	storageKeyPrefix: string;
}

export const useSavedForm = <TValues extends Record<string, unknown>>(
	config: UseSavedFormConfig<TValues>,
): UseFormReturnType<TValues> & {
	clearSavedState: () => void;
} => {
	const userDetails = useUserDetails();
	const [savedValues, setSavedValues] = useLocalStorage<TValues | null>(
		`${config.storageKeyPrefix}-${userDetails.id}`,
		null,
	);

	const initialValues = savedValues || config.initialValues;

	const form = useForm<TValues>({ ...config, initialValues });

	useEffect(() => {
		if (form.isDirty()) setSavedValues(form.values);
	}, [form.values, form.isDirty, setSavedValues]);

	const clearSavedState = () => {
		form.reset();
		setSavedValues(null);
	};

	return { ...form, clearSavedState };
};
