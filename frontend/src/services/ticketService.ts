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
import { apiRequest } from "./apiClient";
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

	async createTicket(
		body: TicketCreate,
		requesterId: string,
		assetId?: string,
	): Promise<Ticket> {
		if (!isMockMode()) {
			// Backend TicketCreate takes title, description, location, priority
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
			assetId: assetId || null,
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

		for (const a of assignments) {
			if (a.ticketId === ticketId && !a.unassignedAt) {
				a.unassignedAt = now;
			}
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
			} catch (_err) {
				// Requesters are 403 on list_people per API spec; gracefully return empty
				return [];
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

	async getPerson(personId: string): Promise<Person> {
		if (!isMockMode()) {
			return await apiRequest<Person>(`/people/${personId}`);
		}
		const people = getStore<Person>(KEYS.PEOPLE, INITIAL_PEOPLE);
		const found = people.find((p) => p.id === personId);
		if (!found) throw new Error("Person not found");
		return found;
	},

	async listDepartments(): Promise<Department[]> {
		if (!isMockMode()) {
			try {
				const res = await apiRequest<PageResponse<Department>>("/departments");
				return res.items;
			} catch {
				return INITIAL_DEPARTMENTS;
			}
		}
		return INITIAL_DEPARTMENTS;
	},

	async listCategories(): Promise<Category[]> {
		if (!isMockMode()) {
			try {
				const res = await apiRequest<PageResponse<Category>>("/categories");
				return res.items;
			} catch {
				return INITIAL_CATEGORIES;
			}
		}
		return INITIAL_CATEGORIES;
	},

	async listVendors(): Promise<Vendor[]> {
		if (!isMockMode()) {
			try {
				const res = await apiRequest<PageResponse<Vendor>>("/vendors");
				return res.items;
			} catch {
				return INITIAL_VENDORS;
			}
		}
		return INITIAL_VENDORS;
	},

	async listAssets(): Promise<Asset[]> {
		if (!isMockMode()) {
			try {
				const res = await apiRequest<PageResponse<Asset>>("/assets");
				return res.items;
			} catch {
				return INITIAL_ASSETS;
			}
		}
		return INITIAL_ASSETS;
	},

	async getAsset(assetId: string): Promise<Asset> {
		if (!isMockMode()) {
			return await apiRequest<Asset>(`/assets/${assetId}`);
		}
		const found = INITIAL_ASSETS.find((a) => a.id === assetId);
		if (!found) throw new Error("Asset not found");
		return found;
	},
};
