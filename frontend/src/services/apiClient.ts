/**
 * Centralized API client for communicating with /api/v1
 */

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

export const removeStoredToken = (): void => {
	try {
		localStorage.removeItem(TOKEN_KEY);
	} catch {
		// Ignore storage errors
	}
};

export interface RequestOptions extends RequestInit {
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

export async function apiRequest<T>(
	endpoint: string,
	options: RequestOptions = {},
): Promise<T> {
	const token = getStoredToken();

	// Ensure clean path construction without duplicate /api or /api/v1 prefixes
	let normalizedPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
	if (!normalizedPath.startsWith("/api/")) {
		normalizedPath = `/api/v1${normalizedPath}`;
	}

	let url = `${getApiBaseUrl()}${normalizedPath}`;

	if (options.params) {
		const searchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(options.params)) {
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
		...(options.headers as Record<string, string>),
	};

	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	try {
		const response = await fetch(url, {
			...options,
			headers,
		});

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
