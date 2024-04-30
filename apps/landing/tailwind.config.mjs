/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			colors: {
				white: "#FFFFFF",
				black: "#161925",
				primary: "#1D4ED8",
				secondary: "#0C8346",
			},
		},
	},
	plugins: [require("tailwind-scrollbar")],
};
