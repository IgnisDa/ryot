module.exports = {
	watchman: false,
	preset: "jest-expo",
	testMatch: ["<rootDir>/src/**/*.component.test.tsx"],
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
	transform: { "^.+\\.mjs$": "babel-jest" },
	transformIgnorePatterns: [
		"node_modules/(?!(.bun|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-native-svg|lucide-react-native|effect|@effect/.*|@tanstack/.*))",
	],
};
