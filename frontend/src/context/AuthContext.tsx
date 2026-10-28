import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { authService } from "../services/authService";
import {
	isMockMode,
	setMockMode as persistMockMode,
	resetMockData,
} from "../services/ticketService";
import type { Person, Role } from "../types/api";

interface AuthContextType {
	user: Person | null;
	role: Role;
	isAuthenticated: boolean;
	mockMode: boolean;
	login: (email: string, pass: string) => Promise<void>;
	logout: () => void;
	switchRole: (role: Role) => void;
	toggleMockMode: (enabled: boolean) => void;
	resetDemoData: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<Person | null>(() =>
		authService.getCurrentUser(),
	);
	const [mockMode, setMockModeState] = useState<boolean>(() => isMockMode());

	useEffect(() => {
		// If in mock mode and no user is logged in, default to the requester persona
		if (mockMode && !user) {
			const initial = authService.switchPersona("requester");
			setUser(initial);
		}
	}, [mockMode, user]);

	const login = useCallback(async (email: string, pass: string) => {
		const result = await authService.login(email, pass);
		setUser(result.person);
	}, []);

	const logout = useCallback(() => {
		authService.logout();
		setUser(null);
	}, []);

	const switchRole = useCallback((newRole: Role) => {
		const switched = authService.switchPersona(newRole);
		setUser(switched);
	}, []);

	const toggleMockMode = useCallback((enabled: boolean) => {
		persistMockMode(enabled);
		setMockModeState(enabled);
	}, []);

	const resetDemoData = useCallback(() => {
		resetMockData();
	}, []);

	return (
		<AuthContext.Provider
			value={{
				user,
				role: user?.role || "requester",
				isAuthenticated: Boolean(user),
				mockMode,
				login,
				logout,
				switchRole,
				toggleMockMode,
				resetDemoData,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthContextType {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
