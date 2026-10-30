import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { SESSION_EXPIRED_EVENT } from "../services/apiClient";
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
	loading: boolean;
	mockMode: boolean;
	login: (email: string, pass: string) => Promise<Person>;
	register: (details: {
		name: string;
		email: string;
		phone: string;
		password: string;
	}) => Promise<Person>;
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
	const [loading, setLoading] = useState<boolean>(true);
	const [mockMode, setMockModeState] = useState<boolean>(() => isMockMode());

	useEffect(() => {
		let isMounted = true;
		// Verify and restore authenticated session against GET /api/v1/auth/me
		authService
			.restoreSession()
			.then((restored) => {
				if (isMounted) {
					setUser(restored);
					setLoading(false);
				}
			})
			.catch(() => {
				if (isMounted) {
					setUser(null);
					setLoading(false);
				}
			});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		// A refresh token was rejected mid-session; drop to the login screen.
		const onExpired = () => setUser(null);
		window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
		return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
	}, []);

	const login = useCallback(async (email: string, pass: string) => {
		const result = await authService.login(email, pass);
		setUser(result.person);
		return result.person;
	}, []);

	const register = useCallback(
		async (details: {
			name: string;
			email: string;
			phone: string;
			password: string;
		}) => {
			const result = await authService.register(details);
			setUser(result.person);
			return result.person;
		},
		[],
	);

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
		if (enabled) {
			const persona = authService.switchPersona("requester");
			setUser(persona);
		} else {
			// When switching to live mode, verify current token or logout
			authService
				.restoreSession()
				.then((u) => setUser(u))
				.catch(() => setUser(null));
		}
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
				loading,
				mockMode,
				login,
				register,
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
