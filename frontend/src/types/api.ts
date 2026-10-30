/**
 * TypeScript types matching backend/openapi.yml specifications
 */

export type Role = "requester" | "assignee" | "supervisor" | "admin";

export type TicketPriority = "low" | "medium" | "high" | "critical";

export type TicketStatus =
	| "open"
	| "assigned"
	| "in_progress"
	| "resolved"
	| "closed";

export type AttachmentKind = "issue_evidence" | "completion_proof";

export type SortOrder = "asc" | "desc";

export type TicketSortField = "createdAt" | "closedAt" | "priority";

export interface Person {
	id: string;
	name: string;
	email: string;
	phone: string;
	role: Role;
	vendorId?: string | null;
	departmentId?: string | null;
}

export interface Department {
	id: string;
	name: string;
}

export interface Category {
	id: string;
	name: string;
	departmentId?: string | null;
}

export interface Vendor {
	id: string;
	name: string;
}

export interface Asset {
	id: string;
	name: string;
	departmentId: string;
	categoryId: string;
	location: string;
}

export interface Ticket {
	id: string;
	title: string;
	description: string;
	location: string;
	priority: TicketPriority;
	status: TicketStatus;
	createdAt: string;
	closedAt?: string | null;
	requesterId: string | null;
	assetId?: string | null;
	supervisorId?: string | null;
}

export interface TicketAssignment {
	id: string;
	ticketId: string;
	assigneeId: string | null;
	assignedAt: string;
	unassignedAt?: string | null;
}

export interface TicketComment {
	id: string;
	ticketId: string;
	authorId: string | null;
	body: string;
	createdAt: string;
}

export interface TicketAttachment {
	id: string;
	ticketId: string;
	uploadedById: string | null;
	kind: AttachmentKind;
	storageUrl: string;
	uploadedAt: string;
}

export interface TicketStatusHistoryEntry {
	id: string;
	ticketId: string;
	fromStatus?: TicketStatus | null;
	toStatus: TicketStatus;
	changedById: string | null;
	changedAt: string;
}

export interface TicketCreate {
	title: string;
	description: string;
	location: string;
	priority?: TicketPriority;
}

export interface TicketUpdate {
	title?: string | null;
	description?: string | null;
	location?: string | null;
	priority?: TicketPriority | null;
	status?: TicketStatus | null;
	assetId?: string | null;
	supervisorId?: string | null;
}

export interface TokenRequest {
	email: string;
	password: string;
}

export interface TokenResponse {
	accessToken: string;
	refreshToken: string;
	tokenType?: string;
	expiresIn: number;
}

export interface ErrorResponse {
	detail: string;
}

export interface PageResponse<T> {
	items: T[];
	total: number;
	limit: number;
	offset: number;
}
