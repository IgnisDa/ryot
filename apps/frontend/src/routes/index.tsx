import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

export default component$(() => {
	const data = useSignal();

	useVisibleTask$(async (_tc) => {
		const res = await fetch(`https://api.randomuser.me/?page=${Math.random()}`);
		const json = await res.json();
		const b = json.results[0];
		data.value = b;
	});

	return (
		<div>
			This is the index page
			<div>{JSON.stringify(data)}</div>
		</div>
	);
});

export const head: DocumentHead = {
	title: "Trackona | Dashboard",
};
