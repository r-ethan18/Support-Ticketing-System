/**
 * Centralized API client for communicating with /api/v1
 */

import type { TokenResponse } from "../types/api";

export class ApiError extends Error {
	constructor(
		public status: number,
		public detail: string,
		public endpoint?: string,
	) {
		super(detail);
		this.name = "ApiError";
	}

	get isNotImplemented(): boolean {
		return this.status === 501;
	}

	get isUnauthorized(): boolean {
		return this.status === 401;
	}

	get isForbidden(): boolean {
		return this.status === 403;
	}

	get isNotFound(): boolean {
		return this.status === 404;
	}

	get isConflict(): boolean {
		return this.status === 409;
	}

	get isValidationError(): boolean {
		return this.status === 422;
	}
}

const TOKEN_KEY = "sts_auth_token";
const REFRESH_TOKEN_KEY = "sts_refresh_token";

/** Fired when a session can no longer be refreshed and the user must log in. */
export const SESSION_EXPIRED_EVENT = "sts:session-expired";

export const getStoredToken = (): string | null => {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
};

export const setStoredToken = (token: string): void => {
	try {
		localStorage.setItem(TOKEN_KEY, token);
	} catch {
		// Ignore storage errors in private browsing
	}
};

export const getStoredRefreshToken = (): string | null => {
	try {
		return localStorage.getItem(REFRESH_TOKEN_KEY);
	} catch {
		return null;
	}
};

export const setStoredRefreshToken = (token: string): void => {
	try {
		localStorage.setItem(REFRESH_TOKEN_KEY, token);
	} catch {
		// Ignore storage errors in private browsing
	}
};

export const removeStoredToken = (): void => {
	try {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(REFRESH_TOKEN_KEY);
	} catch {
		// Ignore storage errors
	}
};

export interface RequestOptions extends RequestInit {
	/** Don't try to refresh the access token if this request gets a 401. */
	skipAuthRefresh?: boolean;
	params?: Record<
		string,
		string | number | boolean | null | undefined | (string | number)[]
	>;
}

export const getApiBaseUrl = (): string => {
	const envUrl =
		import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_URL;
	if (!envUrl) return "";
	return envUrl.replace(/\/+$/, "");
};

const buildApiUrl = (endpoint: string): string => {
	// Ensure clean path construction without duplicate /api or /api/v1 prefixes
	const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
	return `${getApiBaseUrl()}${path.startsWith("/api/") ? path : `/api/v1${path}`}`;
};

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Trade the stored refresh token for a new token pair. Refresh tokens are
 * single-use, so concurrent callers share one request. Resolves `false`
 * without ending the session if the server couldn't be reached.
 */
export function refreshSession(): Promise<boolean> {
	refreshInFlight ??= (async () => {
		const refreshToken = getStoredRefreshToken();
		if (!refreshToken) return false;
		try {
			const response = await fetch(buildApiUrl("/auth/refresh"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refreshToken }),
			});
			if (response.ok) {
				const pair = (await response.json()) as TokenResponse;
				setStoredToken(pair.accessToken);
				setStoredRefreshToken(pair.refreshToken);
				return true;
			}
			if (response.status === 401) {
				removeStoredToken();
				window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
			}
			return false;
		} catch {
			return false;
		}
	})().finally(() => {
		refreshInFlight = null;
	});
	return refreshInFlight;
}

export async function apiRequest<T>(
	endpoint: string,
	options: RequestOptions = {},
): Promise<T> {
	const { skipAuthRefresh, ...fetchOptions } = options;
	const token = getStoredToken();

	let url = buildApiUrl(endpoint);

	if (fetchOptions.params) {
		const searchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(fetchOptions.params)) {
			if (value === undefined || value === null || value === "") continue;
			if (Array.isArray(value)) {
				for (const item of value) {
					if (item !== undefined && item !== null && item !== "") {
						searchParams.append(key, String(item));
					}
				}
			} else {
				searchParams.append(key, String(value));
			}
		}
		const queryString = searchParams.toString();
		if (queryString) {
			url += `${url.includes("?") ? "&" : "?"}${queryString}`;
		}
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(fetchOptions.headers as Record<string, string>),
	};

	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	try {
		const response = await fetch(url, {
			...fetchOptions,
			headers,
		});

		if (
			response.status === 401 &&
			token &&
			!skipAuthRefresh &&
			(await refreshSession())
		) {
			return await apiRequest<T>(endpoint, {
				...options,
				skipAuthRefresh: true,
			});
		}

		if (!response.ok) {
			let detail = `Request failed with status ${response.status}`;
			try {
				const errorJson = await response.json();
				if (typeof errorJson.detail === "string") {
					detail = errorJson.detail;
				} else if (Array.isArray(errorJson.detail)) {
					detail = errorJson.detail
						.map((e: { loc?: string[]; msg?: string }) => {
							const field = e.loc
								? e.loc.filter((l) => l !== "body").join(".")
								: "";
							return field ? `${field}: ${e.msg}` : e.msg || JSON.stringify(e);
						})
						.join(", ");
				}
			} catch {
				// Non-JSON response
			}

			if (response.status === 501) {
				detail = `Endpoint ${endpoint} is not implemented in the backend (HTTP 501).`;
			}

			throw new ApiError(response.status, detail, endpoint);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		return (await response.json()) as T;
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw new ApiError(
			0,
			error instanceof Error
				? error.message
				: "Network error or connection refused",
			endpoint,
		);
	}
}
