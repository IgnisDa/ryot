import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { assert } from "@ryot-app/testing/assert";

/** Hundreds of stored saved views, which take the validation worker about a second to validate. */
export const heavyDefinitionBaseline = () => {
	const kernel = kernelDefinitionSource();
	const view = kernel.savedViews.find(({ dataSources }) => dataSources !== null);
	assert(view);
	return {
		...kernel,
		savedViews: [
			...kernel.savedViews,
			...Array.from({ length: 600 }, (_, index) => ({ ...view, slug: `${view.slug}-${index}` })),
		],
	};
};
