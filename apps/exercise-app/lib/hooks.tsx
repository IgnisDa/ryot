import { AUTH_KEY, URL_KEY } from "@/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
	LogoutUserDocument,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getAuthHeader } from "@ryot/graphql/client";
import request from "graphql-request";
import { createContext, useContext, useEffect, useState } from "react";

type AuthData = {
	token: string;
};

type AuthContextData = {
	authData?: AuthData;
	loading: boolean;
	signIn: (url: string, token: string) => Promise<void>;
	signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider = ({ children }: { children: JSX.Element }) => {
	const [authData, setAuthData] = useState<AuthData>();
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => await loadStorageData())();
	}, []);

	async function loadStorageData(): Promise<void> {
		try {
			const authDataSerialized = await AsyncStorage.getItem(AUTH_KEY);
			if (authDataSerialized) {
				const _authData: AuthData = JSON.parse(authDataSerialized);
				setAuthData(_authData);
			}
			setLoading(false);
		} catch (e) {
			console.error(e);
		}
	}

	const signIn = async (url: string, token: string) => {
		try {
			const { userDetails } = await request(
				`${url}/graphql`,
				UserDetailsDocument,
				undefined,
				getAuthHeader(token),
			);
			if (userDetails.__typename === "UserDetailsError")
				throw new Error("Incorrect details provided");
			const _authData: AuthData = { token };
			setAuthData(_authData);
			await AsyncStorage.setItem(URL_KEY, url);
			await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(_authData));
		} catch {
			throw new Error("Incorrect server url provided");
		}
	};

	const signOut = async () => {
		const instanceUrl = await AsyncStorage.getItem(URL_KEY);
		const token = await AsyncStorage.getItem(AUTH_KEY);
		await request(
			`${instanceUrl}/graphql`,
			LogoutUserDocument,
			undefined,
			getAuthHeader(token),
		);
		setAuthData(null);
		await AsyncStorage.removeItem(URL_KEY);
		await AsyncStorage.removeItem(AUTH_KEY);
	};

	return (
		<AuthContext.Provider value={{ authData, loading, signIn, signOut }}>
			{children}
		</AuthContext.Provider>
	);
};

export const useAuth = () => {
	const context = useContext(AuthContext);
	if (!context) throw new Error("useAuth must be used within an AuthProvider");
	return context;
};
