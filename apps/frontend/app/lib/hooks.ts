import { useMantineTheme } from "@mantine/core";
import { useSearchParams } from "@remix-run/react";
import { getStringAsciiValue } from "./generals";

export function useGetMantineColor() {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
	const getColor = (input: string) =>
		colors[(getStringAsciiValue(input) + colors.length) % colors.length];

	return getColor;
}

export function useSearchParam() {
	const [searchParams, setSearchParams] = useSearchParams();

	const setP = (key: string, value?: string | null) => {
		setSearchParams((prev) => {
			if (!value) delP(key);
			else prev.set(key, value);
			return prev;
		});
	};

	const delP = (key: string) => {
		setSearchParams((prev) => {
			prev.delete(key);
			return prev;
		});
	};

	return [searchParams, { setP, delP }] as const;
}
