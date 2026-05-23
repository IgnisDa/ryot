module.exports = {
	watchman: false,
	preset: "jest-expo",
	testMatch: ["<rootDir>/src/**/*.component.test.tsx"],
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
	transformIgnorePatterns: [
		"node_modules/(?!(.bun|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-native-svg|@tanstack/.*))",
	],
};
