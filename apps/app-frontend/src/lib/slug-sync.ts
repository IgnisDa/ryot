import { normalizeSlug } from "@ryot/ts-utils";

export interface ResolveNextSlugInput {
	name: string;
	slug: string;
	previousDerivedSlug?: string;
}

export const resolveNextSlug = (input: ResolveNextSlugInput) => {
	if (
		input.slug.trim() !== "" &&
		input.slug.trim() !== input.previousDerivedSlug?.trim()
	) {
		return input.slug;
	}

	return normalizeSlug(input.name);
};

export interface SlugForm {
	getFieldValue(field: "slug"): string;
	setFieldValue(field: "slug", value: string): void;
}

export function syncSlugOnNameChange(props: {
	name: string;
	form: SlugForm;
	previousDerivedSlug: string;
}) {
	const slug = props.form.getFieldValue("slug");
	const isAutoDerivedSlug =
		slug.trim() === "" || slug.trim() === props.previousDerivedSlug.trim();
	const nextSlug = resolveNextSlug({
		slug,
		name: props.name,
		previousDerivedSlug: props.previousDerivedSlug,
	});

	if (nextSlug === slug) {
		return isAutoDerivedSlug;
	}

	props.form.setFieldValue("slug", nextSlug);

	return isAutoDerivedSlug;
}

export function createNameFieldListeners(props: {
	form: SlugForm;
	previousDerivedSlug: { current: string };
}) {
	return {
		onChange: ({ value }: { value: string }) => {
			const shouldTrackDerivedSlug = syncSlugOnNameChange({
				name: value,
				form: props.form,
				previousDerivedSlug: props.previousDerivedSlug.current,
			});
			if (!shouldTrackDerivedSlug) {
				return;
			}
			props.previousDerivedSlug.current = resolveNextSlug({
				slug: "",
				name: value,
			});
		},
	};
}
