import { useTheme } from "next-themes";
import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

function isTheme(s: string): s is "dark" | "light" | "system" {
	return (["dark", "light", "system"] as string[]).includes(s);
}

const Toaster = (props: ToasterProps) => {
	const { theme: rawTheme = "system" } = useTheme();
	const theme: ToasterProps["theme"] = isTheme(rawTheme) ? rawTheme : undefined;

	return (
		<Sonner
			theme={theme}
			className="toaster group"
			toastOptions={{
				classNames: {
					toast:
						"group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
					description: "group-[.toast]:text-muted-foreground",
					actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
					cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
