import type { Person, Role, TokenResponse } from "../types/api";
import {
	ApiError,
	apiRequest,
	getStoredToken,
	removeStoredToken,
	setStoredToken,
} from "./apiClient";
import { INITIAL_PEOPLE } from "./mockData";
import { isMockMode } from "./ticketService";

export interface DemoCredential {
	role: Role;
	email: string;
	password: string;
	name: string;
	description: string;
}

export const DEMO_CREDENTIALS: Record<Role, DemoCredential> = {
	requester: {
		role: "requester",
		email: "requester@example.com",
		password: "requesterpassword123",
		name: "Alice Chen",
		description: "End-user service consumer submitting facility requests",
	},
	assignee: {
		role: "assignee",
		email: "assignee@example.com",
		password: "assigneepassword123",
		name: "Carlos Mendoza",
		description: "Field technician from Metro Tech Services",
	},
	supervisor: {
		role: "supervisor",
		email: "supervisor@example.com",
		password: "supervisorpassword123",
		name: "David Miller",
		description: "Facilities operations supervisor managing triage & dispatch",
	},
	admin: {
		role: "admin",
		email: "admin@example.com",
		password: "adminpassword123",
		name: "Administrator",
		description: "Full system administrator with directory & tenant control",
	},
};

export const DEMO_USERS: Record<Role, Person> = {
	requester: {
		id: "eb3d9342-ca03-4809-966c-47fce90dd4db",
		name: "Alice Chen",
		email: "requester@example.com",
		phone: "+1-555-0103",
		role: "requester",
	},
	assignee: {
		id: "526f9b59-fa3e-4c97-82b3-b6fa1f2fa8db",
		name: "Carlos Mendoza",
		email: "assignee@example.com",
		phone: "+1-555-0102",
		role: "assignee",
	},
	supervisor: {
		id: "d26801a2-a7d8-4f9c-a0a1-7029ceb4e698",
		name: "David Miller",
		email: "supervisor@example.com",
		phone: "+1-555-0101",
		role: "supervisor",
	},
	admin: {
		id: "5ba70647-0121-486f-b5e2-c297ef835c42",
		name: "Administrator",
		email: "admin@example.com",
		phone: "+1-555-0100",
		role: "admin",
	},
};

const USER_SESSION_KEY = "sts_current_user";

export const authService = {
	async login(
		email: string,
		password: string,
	): Promise<{ person: Person; token: string }> {
		if (isMockMode()) {
			const matched =
				INITIAL_PEOPLE.find(
					(p) => p.email.toLowerCase() === email.toLowerCase(),
				) ||
				Object.values(DEMO_USERS).find(
					(u) => u.email.toLowerCase() === email.toLowerCase(),
				) ||
				DEMO_USERS.requester;
			const fakeToken = `mock_token_${matched.role}_${Date.now()}`;
			setStoredToken(fakeToken);
			localStorage.setItem(USER_SESSION_KEY, JSON.stringify(matched));
			return { person: matched, token: fakeToken };
		}

		try {
			// Real API authentication against POST /api/v1/auth/token
			const res = await apiRequest<
				TokenResponse & { accessToken?: string; access_token?: string }
			>("/auth/token", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			});

			const token = res.accessToken || res.access_token;
			if (!token) {
				throw new Error(
					"Authentication response did not contain an access token.",
				);
			}

			setStoredToken(token);

			// Fetch real authenticated user profile from GET /api/v1/auth/me
			const person = await apiRequest<Person>("/auth/me");
			localStorage.setItem(USER_SESSION_KEY, JSON.stringify(person));
			return { person, token };
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				throw new Error("Incorrect email or password.");
			}
			throw err;
		}
	},

	async restoreSession(): Promise<Person | null> {
		const token = getStoredToken();
		if (!token) return null;

		if (isMockMode()) {
			const raw = localStorage.getItem(USER_SESSION_KEY);
			return raw ? (JSON.parse(raw) as Person) : DEMO_USERS.requester;
		}

		try {
			const person = await apiRequest<Person>("/auth/me");
			localStorage.setItem(USER_SESSION_KEY, JSON.stringify(person));
			return person;
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				// Expired or invalid token
				authService.logout();
				return null;
			}
			// In case of temporary network glitch, fallback to cached user
			const cached = localStorage.getItem(USER_SESSION_KEY);
			return cached ? (JSON.parse(cached) as Person) : null;
		}
	},

	getCurrentUser(): Person | null {
		try {
			const raw = localStorage.getItem(USER_SESSION_KEY);
			if (raw) {
				return JSON.parse(raw) as Person;
			}
			return null;
		} catch {
			return null;
		}
	},

	logout(): void {
		removeStoredToken();
		localStorage.removeItem(USER_SESSION_KEY);
	},

	switchPersona(role: Role): Person {
		const target = DEMO_USERS[role];
		const fakeToken = `mock_token_${target.role}_${Date.now()}`;
		setStoredToken(fakeToken);
		localStorage.setItem(USER_SESSION_KEY, JSON.stringify(target));
		return target;
	},
};
