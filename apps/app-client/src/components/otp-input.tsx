import clsx from "clsx";
import { useRef, useState } from "react";
import { TextInput } from "react-native";

import { Box } from "@/components/ui/box";

const DIGIT_COUNT = 6;
const OTP_POSITIONS = [0, 1, 2, 3, 4, 5] as const;

type OtpInputProps = {
	disabled?: boolean;
	onComplete: (code: string) => void;
};

export function OtpInput(props: OtpInputProps) {
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const refs = useRef<(TextInput | null)[]>(Array(DIGIT_COUNT).fill(null));
	const [digits, setDigits] = useState(Array<string>(DIGIT_COUNT).fill(""));

	function handleChangeText(index: number, value: string) {
		const filtered = value.replace(/\D/g, "");
		if (!filtered) {
			return;
		}

		if (filtered.length >= DIGIT_COUNT) {
			const chars = filtered.slice(0, DIGIT_COUNT).split("");
			setDigits(chars);
			refs.current[DIGIT_COUNT - 1]?.focus();
			props.onComplete(filtered.slice(0, DIGIT_COUNT));
			return;
		}

		const next = [...digits];
		next[index] = filtered[filtered.length - 1];
		setDigits(next);
		if (index < DIGIT_COUNT - 1) {
			refs.current[index + 1]?.focus();
		}
		if (next.every((d) => d !== "")) {
			props.onComplete(next.join(""));
		}
	}

	function handleKeyPress(index: number, key: string) {
		if (key !== "Backspace") {
			return;
		}
		const next = [...digits];
		if (digits[index]) {
			next[index] = "";
			setDigits(next);
		} else if (index > 0) {
			next[index - 1] = "";
			setDigits(next);
			refs.current[index - 1]?.focus();
		}
	}

	return (
		<Box className="flex-row gap-3 justify-center">
			{OTP_POSITIONS.map((pos) => (
				<Box
					key={pos}
					className={clsx(
						"w-12 h-14 rounded-lg border overflow-hidden",
						props.disabled && "opacity-50",
						focusedIndex === pos ? "border-ring" : "border-border",
					)}
				>
					<TextInput
						value={digits[pos]}
						autoFocus={pos === 0}
						keyboardType="number-pad"
						editable={!props.disabled}
						onBlur={() => setFocusedIndex(-1)}
						onFocus={() => setFocusedIndex(pos)}
						className="text-xl font-semibold text-foreground"
						onChangeText={(val) => handleChangeText(pos, val)}
						style={{ flex: 1, textAlign: "center", textAlignVertical: "center" }}
						onKeyPress={({ nativeEvent }) => handleKeyPress(pos, nativeEvent.key)}
						ref={(el) => {
							refs.current[pos] = el;
						}}
					/>
				</Box>
			))}
		</Box>
	);
}
