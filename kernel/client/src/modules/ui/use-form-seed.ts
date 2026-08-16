import type { SchemaFormApi, SchemaFormValues } from "@ryot-app/client-ui-sdk/schema-form";
import { useEffect, useState } from "react";

export function useFormSeed(
	form: SchemaFormApi,
	key: string | undefined,
	values: () => SchemaFormValues,
) {
	const [seed, setSeed] = useState(() => ({ key, values: values() }));
	if (seed.key !== key) {
		setSeed({ key, values: values() });
	}

	useEffect(() => {
		form.reset(seed.values);
	}, [form, seed.values]);
}
