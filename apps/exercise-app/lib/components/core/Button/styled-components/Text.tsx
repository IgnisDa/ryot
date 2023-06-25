import { styled } from "../../styled";
import { Text } from "react-native";

export default styled(
	Text,
	{
		color: "$textLight0",
		fontFamily: "$body",
		//@ts-ignore
		userSelect: "none",
	},
	{ ancestorStyle: ["_text"], DEBUG: "STYLEDBUTTONTEXT" },
);
