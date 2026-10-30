import type {
	Asset,
	Category,
	Department,
	PageResponse,
	Person,
	Role,
	Ticket,
	TicketAssignment,
	TicketAttachment,
	TicketComment,
	TicketCreate,
	TicketPriority,
	TicketStatus,
	TicketStatusHistoryEntry,
	TicketUpdate,
	Vendor,
} from "../types/api";
import { ApiError, apiRequest } from "./apiClient";
import {
	INITIAL_ASSETS,
	INITIAL_ASSIGNMENTS,
	INITIAL_ATTACHMENTS,
	INITIAL_CATEGORIES,
	INITIAL_COMMENTS,
	INITIAL_DEPARTMENTS,
	INITIAL_PEOPLE,
	INITIAL_STATUS_HISTORY,
	INITIAL_TICKETS,
	INITIAL_VENDORS,
} from "./mockData";

// Local storage keys for persistent mock store in browser
const KEYS = {
	TICKETS: "sts_mock_tickets",
	COMMENTS: "sts_mock_comments",
	ASSIGNMENTS: "sts_mock_assignments",
	ATTACHMENTS: "sts_mock_attachments",
	STATUS_HISTORY: "sts_mock_status_history",
	PEOPLE: "sts_mock_people",
	DEPARTMENTS: "sts_mock_departments",
	VENDORS: "sts_mock_vendors",
	CATEGORIES: "sts_mock_categories",
	ASSETS: "sts_mock_assets",
	ASSET_VENDORS: "sts_mock_asset_vendors",
	MOCK_MODE: "sts_use_mock_mode",
};

export const isMockMode = (): boolean => {
	try {
		// Mock mode defaults to false: Real API is primary in production/integration
		return localStorage.getItem(KEYS.MOCK_MODE) === "true";
	} catch {
		return false;
	}
};

export const setMockMode = (enabled: boolean): void => {
	try {
		localStorage.setItem(KEYS.MOCK_MODE, String(enabled));
	} catch {
		// Ignore storage errors
	}
};

function getStore<T>(key: string, initial: T[]): T[] {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) {
			localStorage.setItem(key, JSON.stringify(initial));
			return initial;
		}
		return JSON.parse(raw) as T[];
	} catch {
		return initial;
	}
}

function setStore<T>(key: string, data: T[]): void {
	try {
		localStorage.setItem(key, JSON.stringify(data));
	} catch {
		// Ignore storage errors
	}
}

export function resetMockData(): void {
	try {
		localStorage.setItem(KEYS.TICKETS, JSON.stringify(INITIAL_TICKETS));
		localStorage.setItem(KEYS.COMMENTS, JSON.stringify(INITIAL_COMMENTS));
		localStorage.setItem(KEYS.ASSIGNMENTS, JSON.stringify(INITIAL_ASSIGNMENTS));
		localStorage.setItem(KEYS.ATTACHMENTS, JSON.stringify(INITIAL_ATTACHMENTS));
		localStorage.setItem(
			KEYS.STATUS_HISTORY,
			JSON.stringify(INITIAL_STATUS_HISTORY),
		);
		localStorage.setItem(KEYS.PEOPLE, JSON.stringify(INITIAL_PEOPLE));
		localStorage.setItem(KEYS.DEPARTMENTS, JSON.stringify(INITIAL_DEPARTMENTS));
		localStorage.setItem(KEYS.VENDORS, JSON.stringify(INITIAL_VENDORS));
		localStorage.setItem(KEYS.CATEGORIES, JSON.stringify(INITIAL_CATEGORIES));
		localStorage.setItem(KEYS.ASSETS, JSON.stringify(INITIAL_ASSETS));
		localStorage.removeItem(KEYS.ASSET_VENDORS);
	} catch {
		// Ignore
	}
}

export interface TicketFilters {
	status?: TicketStatus[];
	priority?: TicketPriority[];
	requesterId?: string;
	assigneeId?: string;
	supervisorId?: string;
	departmentId?: string;
	assetId?: string;
	q?: string;
	limit?: number;
	offset?: number;
	sortBy?: "createdAt" | "closedAt" | "priority";
	order?: "asc" | "desc";
	callerRole?: Role;
	callerId?: string;
}

export const ticketService = {
	async listTickets(
		filters: TicketFilters = {},
	): Promise<PageResponse<Ticket>> {
		if (!isMockMode()) {
			return await apiRequest<PageResponse<Ticket>>("/tickets", {
				params: {
					status: filters.status,
					priority: filters.priority,
					requesterId: filters.requesterId,
					assigneeId: filters.assigneeId,
					supervisorId: filters.supervisorId,
					departmentId: filters.departmentId,
					assetId: filters.assetId,
					q: filters.q,
					limit: filters.limit ?? 25,
					offset: filters.offset ?? 0,
					sortBy: filters.sortBy,
					order: filters.order,
				},
			});
		}

		// Mock Data filtering
		let tickets = getStore<Ticket>(KEYS.TICKETS, INITIAL_TICKETS);
		const assignments = getStore<TicketAssignment>(
			KEYS.ASSIGNMENTS,
			INITIAL_ASSIGNMENTS,
		);

		// Scoping by role (per openapi.yml spec)
		if (filters.callerRole === "requester" && filters.callerId) {
			tickets = tickets.filter((t) => t.requesterId === filters.callerId);
		} else if (filters.callerRole === "assignee" && filters.callerId) {
			const assignedTicketIds = new Set(
				assignments
					.filter((a) => a.assigneeId === filters.callerId && !a.unassignedAt)
					.map((a) => a.ticketId),
			);
			tickets = tickets.filter((t) => assignedTicketIds.has(t.id));
		}

		if (filters.status && filters.status.length > 0) {
			tickets = tickets.filter((t) => filters.status?.includes(t.status));
		}

		if (filters.priority && filters.priority.length > 0) {
			tickets = tickets.filter((t) => filters.priority?.includes(t.priority));
		}

		if (filters.assigneeId) {
			const assignedIds = new Set(
				assignments
					.filter((a) => a.assigneeId === filters.assigneeId && !a.unassignedAt)
					.map((a) => a.ticketId),
			);
			tickets = tickets.filter((t) => assignedIds.has(t.id));
		}

		if (filters.q) {
			const query = filters.q.toLowerCase();
			tickets = tickets.filter(
				(t) =>
					t.title.toLowerCase().includes(query) ||
					t.description.toLowerCase().includes(query) ||
					t.location.toLowerCase().includes(query) ||
					t.id.toLowerCase().includes(query),
			);
		}

		// Sort
		tickets.sort((a, b) => {
			const dir = filters.order === "asc" ? 1 : -1;
			if (filters.sortBy === "priority") {
				const pWeights = { critical: 4, high: 3, medium: 2, low: 1 };
				return (pWeights[a.priority] - pWeights[b.priority]) * dir;
			}
			return (
				(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
				dir
			);
		});

		const limit = filters.limit ?? 25;
		const offset = filters.offset ?? 0;
		const paginated = tickets.slice(offset, offset + limit);

		return {
			items: paginated,
			total: tickets.length,
			limit,
			offset,
		};
	},

	async getTicket(ticketId: string): Promise<Ticket> {
		if (!isMockMode()) {
			return await apiRequest<Ticket>(`/tickets/${ticketId}`);
		}
		const tickets = getStore<Ticket>(KEYS.TICKETS, INITIAL_TICKETS);
		const found = tickets.find((t) => t.id === ticketId);
		if (!found) {
			throw new Error(`Ticket ${ticketId} not found`);
		}
		return found;
	},

	async createTicket(body: TicketCreate, requesterId: string): Promise<Ticket> {
		if (!isMockMode()) {
			// Requesters can't pick an asset; a supervisor sets it during triage.
			return await apiRequest<Ticket>("/tickets", {
				method: "POST",
				body: JSON.stringify({
					title: body.title,
					description: body.description,
					location: body.location,
					priority: body.priority || "medium",
				}),
			});
		}

		const tickets = getStore<Ticket>(KEYS.TICKETS, INITIAL_TICKETS);
		const newId = `t-${Math.floor(100 + Math.random() * 900)}`;
		const now = new Date().toISOString();

		const newTicket: Ticket = {
			id: newId,
			title: body.title,
			description: body.description,
			location: body.location,
			priority: body.priority || "medium",
			status: "open",
			createdAt: now,
			requesterId,
			assetId: null,
		};

		tickets.unshift(newTicket);
		setStore(KEYS.TICKETS, tickets);

		// Status history log
		const history = getStore<TicketStatusHistoryEntry>(
			KEYS.STATUS_HISTORY,
			INITIAL_STATUS_HISTORY,
		);
		history.push({
			id: `sh-${Date.now()}`,
			ticketId: newId,
			fromStatus: null,
			toStatus: "open",
			changedById: requesterId,
			changedAt: now,
		});
		setStore(KEYS.STATUS_HISTORY, history);

		return newTicket;
	},

	async updateTicket(
		ticketId: string,
		update: TicketUpdate,
		callerId: string,
	): Promise<Ticket> {
		if (!isMockMode()) {
			const payload: Record<string, unknown> = {};
			if (update.title !== undefined) payload.title = update.title;
			if (update.description !== undefined)
				payload.description = update.description;
			if (update.location !== undefined) payload.location = update.location;
			if (update.priority !== undefined) payload.priority = update.priority;
			if (update.status !== undefined) payload.status = update.status;
			if (update.assetId !== undefined) payload.assetId = update.assetId;
			if (update.supervisorId !== undefined)
				payload.supervisorId = update.supervisorId;

			return await apiRequest<Ticket>(`/tickets/${ticketId}`, {
				method: "PATCH",
				body: JSON.stringify(payload),
			});
		}

		const tickets = getStore<Ticket>(KEYS.TICKETS, INITIAL_TICKETS);
		const idx = tickets.findIndex((t) => t.id === ticketId);
		if (idx === -1) {
			throw new Error("Ticket not found");
		}

		const current = tickets[idx];
		const updated: Ticket = {
			...current,
			title: update.title ?? current.title,
			description: update.description ?? current.description,
			location: update.location ?? current.location,
			priority: update.priority ?? current.priority,
			status: update.status ?? current.status,
			assetId: update.assetId !== undefined ? update.assetId : current.assetId,
			supervisorId:
				update.supervisorId !== undefined
					? update.supervisorId
					: current.supervisorId,
			closedAt:
				update.status === "closed"
					? new Date().toISOString()
					: update.status
						? null
						: current.closedAt,
		};

		if (update.status && update.status !== current.status) {
			const history = getStore<TicketStatusHistoryEntry>(
				KEYS.STATUS_HISTORY,
				INITIAL_STATUS_HISTORY,
			);
			history.push({
				id: `sh-${Date.now()}`,
				ticketId,
				fromStatus: current.status,
				toStatus: update.status,
				changedById: callerId,
				changedAt: new Date().toISOString(),
			});
			setStore(KEYS.STATUS_HISTORY, history);
		}

		tickets[idx] = updated;
		setStore(KEYS.TICKETS, tickets);
		return updated;
	},

	async deleteTicket(ticketId: string): Promise<void> {
		if (!isMockMode()) {
			await apiRequest<void>(`/tickets/${ticketId}`, {
				method: "DELETE",
			});
			return;
		}
		let tickets = getStore<Ticket>(KEYS.TICKETS, INITIAL_TICKETS);
		tickets = tickets.filter((t) => t.id !== ticketId);
		setStore(KEYS.TICKETS, tickets);
	},

	async assignTicket(
		ticketId: string,
		assigneeId: string,
		callerId: string,
	): Promise<TicketAssignment> {
		if (!isMockMode()) {
			return await apiRequest<TicketAssignment>(
				`/tickets/${ticketId}/assignments`,
				{
					method: "POST",
					body: JSON.stringify({ assigneeId }),
				},
			);
		}

		const assignments = getStore<TicketAssignment>(
			KEYS.ASSIGNMENTS,
			INITIAL_ASSIGNMENTS,
		);
		const now = new Date().toISOString();

		if (
			assignments.some(
				(a) =>
					a.ticketId === ticketId &&
					a.assigneeId === assigneeId &&
					!a.unassignedAt,
			)
		) {
			throw new Error("Assignee is already on this ticket");
		}

		const newAssignment: TicketAssignment = {
			id: `asg-${Date.now()}`,
			ticketId,
			assigneeId,
			assignedAt: now,
		};

		assignments.push(newAssignment);
		setStore(KEYS.ASSIGNMENTS, assignments);

		const tickets = getStore<Ticket>(KEYS.TICKETS, INITIAL_TICKETS);
		const ticket = tickets.find((t) => t.id === ticketId);
		if (ticket && ticket.status === "open") {
			ticket.status = "assigned";
			ticket.supervisorId = callerId;
			setStore(KEYS.TICKETS, tickets);
		}

		return newAssignment;
	},

	async deleteAssignment(
		ticketId: string,
		assignmentId: string,
	): Promise<void> {
		if (!isMockMode()) {
			await apiRequest<void>(
				`/tickets/${ticketId}/assignments/${assignmentId}`,
				{
					method: "DELETE",
				},
			);
			return;
		}
		const assignments = getStore<TicketAssignment>(
			KEYS.ASSIGNMENTS,
			INITIAL_ASSIGNMENTS,
		);
		const match = assignments.find((a) => a.id === assignmentId);
		if (match) {
			match.unassignedAt = new Date().toISOString();
			setStore(KEYS.ASSIGNMENTS, assignments);
		}
	},

	async listAssignments(ticketId: string): Promise<TicketAssignment[]> {
		if (!isMockMode()) {
			return await apiRequest<TicketAssignment[]>(
				`/tickets/${ticketId}/assignments`,
			);
		}
		const assignments = getStore<TicketAssignment>(
			KEYS.ASSIGNMENTS,
			INITIAL_ASSIGNMENTS,
		);
		return assignments.filter((a) => a.ticketId === ticketId);
	},

	async listComments(ticketId: string): Promise<TicketComment[]> {
		if (!isMockMode()) {
			return await apiRequest<TicketComment[]>(`/tickets/${ticketId}/comments`);
		}
		const comments = getStore<TicketComment>(KEYS.COMMENTS, INITIAL_COMMENTS);
		return comments
			.filter((c) => c.ticketId === ticketId)
			.sort(
				(a, b) =>
					new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
			);
	},

	async createComment(
		ticketId: string,
		body: string,
		authorId: string,
	): Promise<TicketComment> {
		if (!isMockMode()) {
			return await apiRequest<TicketComment>(`/tickets/${ticketId}/comments`, {
				method: "POST",
				body: JSON.stringify({ body }),
			});
		}

		const comments = getStore<TicketComment>(KEYS.COMMENTS, INITIAL_COMMENTS);
		const newComment: TicketComment = {
			id: `c-${Date.now()}`,
			ticketId,
			authorId,
			body,
			createdAt: new Date().toISOString(),
		};
		comments.push(newComment);
		setStore(KEYS.COMMENTS, comments);
		return newComment;
	},

	async listAttachments(
		ticketId: string,
		kind?: "issue_evidence" | "completion_proof",
	): Promise<TicketAttachment[]> {
		if (!isMockMode()) {
			return await apiRequest<TicketAttachment[]>(
				`/tickets/${ticketId}/attachments`,
				{
					params: kind ? { kind } : undefined,
				},
			);
		}
		const attachments = getStore<TicketAttachment>(
			KEYS.ATTACHMENTS,
			INITIAL_ATTACHMENTS,
		);
		return attachments.filter(
			(a) => a.ticketId === ticketId && (!kind || a.kind === kind),
		);
	},

	async addAttachment(
		ticketId: string,
		kind: "issue_evidence" | "completion_proof",
		storageUrl: string,
		uploadedById: string,
	): Promise<TicketAttachment> {
		if (!isMockMode()) {
			return await apiRequest<TicketAttachment>(
				`/tickets/${ticketId}/attachments`,
				{
					method: "POST",
					body: JSON.stringify({ kind, storageUrl }),
				},
			);
		}

		const attachments = getStore<TicketAttachment>(
			KEYS.ATTACHMENTS,
			INITIAL_ATTACHMENTS,
		);
		const newAttachment: TicketAttachment = {
			id: `att-${Date.now()}`,
			ticketId,
			uploadedById,
			kind,
			storageUrl,
			uploadedAt: new Date().toISOString(),
		};
		attachments.push(newAttachment);
		setStore(KEYS.ATTACHMENTS, attachments);
		return newAttachment;
	},

	async listStatusHistory(
		ticketId: string,
	): Promise<TicketStatusHistoryEntry[]> {
		if (!isMockMode()) {
			return await apiRequest<TicketStatusHistoryEntry[]>(
				`/tickets/${ticketId}/status-history`,
			);
		}
		const history = getStore<TicketStatusHistoryEntry>(
			KEYS.STATUS_HISTORY,
			INITIAL_STATUS_HISTORY,
		);
		return history
			.filter((h) => h.ticketId === ticketId)
			.sort(
				(a, b) =>
					new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
			);
	},

	async listPeople(filters?: {
		role?: Role;
		vendorId?: string;
		departmentId?: string;
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<Person[]> {
		if (!isMockMode()) {
			try {
				const res = await apiRequest<PageResponse<Person>>("/people", {
					params: filters,
				});
				return res.items;
			} catch (err) {
				// Requesters are 403 on list_people per API spec
				if (err instanceof ApiError && err.isForbidden) return [];
				throw err;
			}
		}
		let people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		if (filters?.role) {
			people = people.filter((p) => p.role === filters.role);
		}
		if (filters?.q) {
			const q = filters.q.toLowerCase();
			people = people.filter(
				(p) =>
					p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
			);
		}
		return people;
	},

	/** Public sign-up; always creates a requester. */
	async registerPerson(body: {
		name: string;
		email: string;
		phone: string;
		password: string;
	}): Promise<Person> {
		if (!isMockMode()) {
			return await apiRequest<Person>("/auth/register", {
				method: "POST",
				body: JSON.stringify(body),
				skipAuthRefresh: true,
			});
		}
		const people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		if (
			people.some((p) => p.email.toLowerCase() === body.email.toLowerCase())
		) {
			throw new Error("An account with this email already exists.");
		}
		const person: Person = {
			id: `p-${Date.now()}`,
			name: body.name,
			email: body.email,
			phone: body.phone,
			role: "requester",
		};
		setStore(KEYS.PEOPLE, [person, ...people]);
		return person;
	},

	/** Admin-only: set an existing person's role (never `admin`). */
	async assignRole(
		personId: string,
		assignment: {
			role: Exclude<Role, "admin">;
			departmentId: string | null;
			vendorId: string | null;
		},
	): Promise<Person> {
		if (!isMockMode()) {
			return await apiRequest<Person>(`/people/${personId}/role`, {
				method: "PUT",
				body: JSON.stringify(assignment),
			});
		}
		const people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		const found = people.find((p) => p.id === personId);
		if (!found) throw new Error("Person not found");
		Object.assign(found, assignment);
		setStore(KEYS.PEOPLE, people);
		return found;
	},

	/** Admin-only: create another admin with full system privileges. */
	async createAdminUser(body: {
		name: string;
		email: string;
		phone: string;
		password: string;
	}): Promise<Person> {
		if (!isMockMode()) {
			return await apiRequest<Person>("/admins", {
				method: "POST",
				body: JSON.stringify(body),
			});
		}
		const people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		const person: Person = {
			id: `p-${Date.now()}`,
			name: body.name,
			email: body.email,
			phone: body.phone,
			role: "admin",
		};
		setStore(KEYS.PEOPLE, [person, ...people]);
		return person;
	},

	/** Admin-only: delete/deactivate a person account. */
	async deletePerson(personId: string): Promise<void> {
		if (!isMockMode()) {
			await apiRequest<void>(`/people/${personId}`, {
				method: "DELETE",
			});
			return;
		}
		let people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		people = people.filter((p) => p.id !== personId);
		setStore(KEYS.PEOPLE, people);
	},

	async getPerson(personId: string): Promise<Person> {
		if (!isMockMode()) {
			return await apiRequest<Person>(`/people/${personId}`);
		}
		const people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		const found = people.find((p) => p.id === personId);
		if (!found) throw new Error("Person not found");
		return found;
	},

	/**
	 * Look up the given people one by one. Unlike `listPeople`, this works for
	 * requesters and assignees, who may read the staff on their tickets (and an
	 * assignee the requester). Anyone the caller may not see, or who has been
	 * deleted, is left out.
	 */
	async getPeopleByIds(ids: string[]): Promise<Person[]> {
		const results = await Promise.allSettled(
			[...new Set(ids)].map((id) => ticketService.getPerson(id)),
		);
		return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
	},

	async listDepartments(): Promise<Department[]> {
		if (!isMockMode()) {
			const res = await apiRequest<PageResponse<Department>>("/departments");
			return res.items;
		}
		return getStore<Department>(KEYS.DEPARTMENTS, INITIAL_DEPARTMENTS);
	},

	async listCategories(): Promise<Category[]> {
		if (!isMockMode()) {
			const res = await apiRequest<PageResponse<Category>>("/categories");
			return res.items;
		}
		return getStore<Category>(KEYS.CATEGORIES, INITIAL_CATEGORIES);
	},

	async listVendors(): Promise<Vendor[]> {
		if (!isMockMode()) {
			const res = await apiRequest<PageResponse<Vendor>>("/vendors");
			return res.items;
		}
		return getStore<Vendor>(KEYS.VENDORS, INITIAL_VENDORS);
	},

	async listAssets(): Promise<Asset[]> {
		if (!isMockMode()) {
			const res = await apiRequest<PageResponse<Asset>>("/assets");
			return res.items;
		}
		return getStore<Asset>(KEYS.ASSETS, INITIAL_ASSETS);
	},

	async getAsset(assetId: string): Promise<Asset> {
		if (!isMockMode()) {
			return await apiRequest<Asset>(`/assets/${assetId}`);
		}
		const found = getStore<Asset>(KEYS.ASSETS, INITIAL_ASSETS).find(
			(a) => a.id === assetId,
		);
		if (!found) throw new Error("Asset not found");
		return found;
	},

	// --- Directory management (departments, vendors and categories are
	// admin-only; assets are managed by supervisors for their own department).

	async createDepartment(name: string): Promise<Department> {
		return createNamed<Department>(
			"/departments",
			KEYS.DEPARTMENTS,
			INITIAL_DEPARTMENTS,
			name,
		);
	},
	async deleteDepartment(id: string): Promise<void> {
		return deleteNamed(
			"/departments",
			KEYS.DEPARTMENTS,
			INITIAL_DEPARTMENTS,
			id,
		);
	},
	async createVendor(name: string): Promise<Vendor> {
		return createNamed<Vendor>("/vendors", KEYS.VENDORS, INITIAL_VENDORS, name);
	},
	async deleteVendor(id: string): Promise<void> {
		return deleteNamed("/vendors", KEYS.VENDORS, INITIAL_VENDORS, id);
	},
	async createCategory(name: string): Promise<Category> {
		return createNamed<Category>(
			"/categories",
			KEYS.CATEGORIES,
			INITIAL_CATEGORIES,
			name,
		);
	},
	async deleteCategory(id: string): Promise<void> {
		return deleteNamed("/categories", KEYS.CATEGORIES, INITIAL_CATEGORIES, id);
	},

	/** `departmentId` is required for admins; supervisors always use their own. */
	async createAsset(body: {
		name: string;
		categoryId: string;
		departmentId?: string;
	}): Promise<Asset> {
		if (!isMockMode()) {
			return await apiRequest<Asset>("/assets", {
				method: "POST",
				body: JSON.stringify(body),
			});
		}
		const assets = getStore<Asset>(KEYS.ASSETS, INITIAL_ASSETS);
		const asset: Asset = {
			id: `a-${Date.now()}`,
			name: body.name,
			categoryId: body.categoryId,
			departmentId: body.departmentId ?? "",
		};
		setStore(KEYS.ASSETS, [...assets, asset]);
		return asset;
	},

	async updateAsset(
		assetId: string,
		body: { name?: string; categoryId?: string },
	): Promise<Asset> {
		if (!isMockMode()) {
			return await apiRequest<Asset>(`/assets/${assetId}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			});
		}
		const assets = getStore<Asset>(KEYS.ASSETS, INITIAL_ASSETS);
		const found = assets.find((a) => a.id === assetId);
		if (!found) throw new Error("Asset not found");
		Object.assign(found, body);
		setStore(KEYS.ASSETS, assets);
		return found;
	},

	/** Fails with 409 while tickets still refer to the asset. */
	async deleteAsset(assetId: string): Promise<void> {
		if (!isMockMode()) {
			await apiRequest<void>(`/assets/${assetId}`, { method: "DELETE" });
			return;
		}
		const assets = getStore<Asset>(KEYS.ASSETS, INITIAL_ASSETS);
		setStore(
			KEYS.ASSETS,
			assets.filter((a) => a.id !== assetId),
		);
	},

	/** The vendors responsible for an asset. */
	async listAssetVendors(assetId: string): Promise<Vendor[]> {
		if (!isMockMode()) {
			return await apiRequest<Vendor[]>(`/assets/${assetId}/vendors`);
		}
		const links = getStore<{ assetId: string; vendorId: string }>(
			KEYS.ASSET_VENDORS,
			[],
		);
		const vendors = getStore<Vendor>(KEYS.VENDORS, INITIAL_VENDORS);
		return vendors.filter((v) =>
			links.some((l) => l.assetId === assetId && l.vendorId === v.id),
		);
	},

	async addAssetVendor(assetId: string, vendorId: string): Promise<void> {
		if (!isMockMode()) {
			await apiRequest<void>(`/assets/${assetId}/vendors/${vendorId}`, {
				method: "PUT",
			});
			return;
		}
		const links = getStore<{ assetId: string; vendorId: string }>(
			KEYS.ASSET_VENDORS,
			[],
		);
		if (!links.some((l) => l.assetId === assetId && l.vendorId === vendorId)) {
			setStore(KEYS.ASSET_VENDORS, [...links, { assetId, vendorId }]);
		}
	},

	async removeAssetVendor(assetId: string, vendorId: string): Promise<void> {
		if (!isMockMode()) {
			await apiRequest<void>(`/assets/${assetId}/vendors/${vendorId}`, {
				method: "DELETE",
			});
			return;
		}
		const links = getStore<{ assetId: string; vendorId: string }>(
			KEYS.ASSET_VENDORS,
			[],
		);
		setStore(
			KEYS.ASSET_VENDORS,
			links.filter((l) => !(l.assetId === assetId && l.vendorId === vendorId)),
		);
	},
};

/** POST a `{ name }` record, or add one to the mock store. */
async function createNamed<T extends { id: string; name: string }>(
	endpoint: string,
	key: string,
	initial: T[],
	name: string,
): Promise<T> {
	if (!isMockMode()) {
		return await apiRequest<T>(endpoint, {
			method: "POST",
			body: JSON.stringify({ name }),
		});
	}
	const items = getStore<T>(key, initial);
	if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
		throw new Error(`"${name}" already exists.`);
	}
	const created = { id: `n-${Date.now()}`, name } as T;
	setStore(key, [...items, created]);
	return created;
}

async function deleteNamed<T extends { id: string }>(
	endpoint: string,
	key: string,
	initial: T[],
	id: string,
): Promise<void> {
	if (!isMockMode()) {
		await apiRequest<void>(`${endpoint}/${id}`, { method: "DELETE" });
		return;
	}
	setStore(
		key,
		getStore<T>(key, initial).filter((i) => i.id !== id),
	);
}
