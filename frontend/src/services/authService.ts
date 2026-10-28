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

export const DEMO_USERS: Record<Role, Person> = {
	requester: INITIAL_PEOPLE[0],
	assignee: INITIAL_PEOPLE[1],
	supervisor: INITIAL_PEOPLE[3],
	admin: INITIAL_PEOPLE[4],
};

const USER_SESSION_KEY = "sts_current_user";

export const authService = {
	async login(
		email: string,
		password: string,
	): Promise<{ person: Person; token: string }> {
		if (isMockMode()) {
			// Find persona matching email or default to requester
			const matched =
				INITIAL_PEOPLE.find(
					(p) => p.email.toLowerCase() === email.toLowerCase(),
				) || INITIAL_PEOPLE[0];
			const fakeToken = `mock_token_${matched.role}_${Date.now()}`;
			setStoredToken(fakeToken);
			localStorage.setItem(USER_SESSION_KEY, JSON.stringify(matched));
			return { person: matched, token: fakeToken };
		}

		try {
			// Live authentication against backend POST /api/v1/auth/token
			const res = await apiRequest<TokenResponse>("/auth/token", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			});

			setStoredToken(res.access_token);

			// Match local persona or parse JWT payload
			let person: Person = INITIAL_PEOPLE.find(
				(p) => p.email.toLowerCase() === email.toLowerCase(),
			) || {
				id: `user-${Date.now()}`,
				name: email.split("@")[0].replace(".", " "),
				email,
				phone: "",
				role: "requester",
			};

			try {
				const parts = res.access_token.split(".");
				if (parts.length === 3) {
					const payload = JSON.parse(atob(parts[1]));
					if (payload.role) {
						person = {
							...person,
							role: payload.role as Role,
							id: payload.sub || person.id,
						};
					}
				}
			} catch {
				// Non-JWT token
			}

			localStorage.setItem(USER_SESSION_KEY, JSON.stringify(person));
			return { person, token: res.access_token };
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				throw new Error("Invalid email or password.");
			}
			throw err;
		}
	},

	getCurrentUser(): Person | null {
		try {
			const raw = localStorage.getItem(USER_SESSION_KEY);
			if (raw) {
				return JSON.parse(raw) as Person;
			}
			// If mock mode is active and token exists, fallback to requester
			if (isMockMode() && getStoredToken()) {
				return DEMO_USERS.requester;
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
