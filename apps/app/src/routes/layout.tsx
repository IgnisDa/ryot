import { component$, Slot } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";

export const useServerTimeLoader = routeLoader$(() => {
	return {
		date: new Date().toISOString(),
	};
});

export default component$(() => {
	return (
		<div class="page">
			<main>
				This is a header
				<Slot />
			</main>
			<div class="section dark">
				<div class="container">This is a footer</div>
			</div>
		</div>
	);
});
