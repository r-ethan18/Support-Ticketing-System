import type {
	Asset,
	Category,
	Department,
	Person,
	Ticket,
	TicketAssignment,
	TicketAttachment,
	TicketComment,
	TicketStatusHistoryEntry,
	Vendor,
} from "../types/api";

export const INITIAL_PEOPLE: Person[] = [
	{
		id: "p-req-1",
		name: "Jane Doe",
		email: "jane.requester@example.com",
		phone: "+1 (555) 019-2831",
		role: "requester",
		departmentId: "d-2",
	},
	{
		id: "p-asg-1",
		name: "Alex Rivera",
		email: "alex.assignee@example.com",
		phone: "+1 (555) 014-9923",
		role: "assignee",
		vendorId: "v-1",
	},
	{
		id: "p-asg-2",
		name: "Dev Sharma",
		email: "dev.assignee@example.com",
		phone: "+1 (555) 018-4412",
		role: "assignee",
		vendorId: "v-2",
	},
	{
		id: "p-sup-1",
		name: "Sarah Chen",
		email: "sarah.supervisor@example.com",
		phone: "+1 (555) 012-7740",
		role: "supervisor",
		departmentId: "d-1",
	},
	{
		id: "p-adm-1",
		name: "Marcus Vance",
		email: "marcus.admin@example.com",
		phone: "+1 (555) 010-8801",
		role: "admin",
	},
];

export const INITIAL_DEPARTMENTS: Department[] = [
	{ id: "d-1", name: "Facilities & Operations" },
	{ id: "d-2", name: "IT Infrastructure & Hardware" },
	{ id: "d-3", name: "Enterprise Software & Security" },
	{ id: "d-4", name: "Finance & Accounts" },
];

export const INITIAL_CATEGORIES: Category[] = [
	{ id: "c-1", name: "HVAC & Climate Control", departmentId: "d-1" },
	{ id: "c-2", name: "Electrical & Lighting", departmentId: "d-1" },
	{ id: "c-3", name: "Workstations & Hardware", departmentId: "d-2" },
	{ id: "c-4", name: "VPN & Network Connectivity", departmentId: "d-2" },
	{ id: "c-5", name: "Identity & Single Sign-On", departmentId: "d-3" },
	{ id: "c-6", name: "Billing & Vendor Invoices", departmentId: "d-4" },
];

export const INITIAL_VENDORS: Vendor[] = [
	{ id: "v-1", name: "Apex Facility Solutions LLC" },
	{ id: "v-2", name: "NextGen Managed IT Services" },
	{ id: "v-3", name: "Prime Electric & Hardware Corp" },
];

export const INITIAL_ASSETS: Asset[] = [
	{
		id: "a-1",
		name: "Floor 3 Server Room AC Unit #2",
		departmentId: "d-1",
		categoryId: "c-1",
		location: "Building B, Room 302",
	},
	{
		id: "a-2",
		name: "MacBook Pro 16'' (Asset #MBP-8821)",
		departmentId: "d-2",
		categoryId: "c-3",
		location: "Engineering Bay 4, Desk 12",
	},
	{
		id: "a-3",
		name: "Edge Gateway Switch 10Gbps (Cisco Catalyst)",
		departmentId: "d-2",
		categoryId: "c-4",
		location: "Data Closet IDF-4",
	},
	{
		id: "a-4",
		name: "Conference Room Atlas 85'' Display",
		departmentId: "d-1",
		categoryId: "c-2",
		location: "Executive Tower, Room 401",
	},
];

export const INITIAL_TICKETS: Ticket[] = [
	{
		id: "t-101",
		title: "Server Room AC Unit failure - Ambient temperature at 82°F",
		description:
			"The primary cooling unit in the 3rd floor server room has shut down. Ambient temperature has reached 82°F and equipment thermal alarms are sounding. Urgent response required to prevent server throttling.",
		location: "Building B, Room 302 (Primary Datacenter)",
		priority: "critical",
		status: "in_progress",
		createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
		requesterId: "p-req-1",
		assetId: "a-1",
		supervisorId: "p-sup-1",
	},
	{
		id: "t-102",
		title: "MacBook Pro kernel panic whenever external 4K monitor is connected",
		description:
			"Since macOS 15.2 update, plugging into the Dell UltraSharp monitor via USB-C triggers an immediate kernel panic crash. Work is blocked during client presentations.",
		location: "Engineering Bay 4, Desk 12",
		priority: "high",
		status: "assigned",
		createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
		requesterId: "p-req-1",
		assetId: "a-2",
		supervisorId: "p-sup-1",
	},
	{
		id: "t-103",
		title: "Flickering overhead LED panel causing migraine in QA area",
		description:
			"The ceiling fixture directly above the automated testing desk has been strobe flickering intermittently throughout the morning.",
		location: "Floor 2, East Wing QA Pod",
		priority: "medium",
		status: "open",
		createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
		requesterId: "p-req-1",
		assetId: "a-4",
	},
	{
		id: "t-104",
		title: "VPN tunnel dropping intermittently for remote contractors",
		description:
			"Contractors in Europe reporting WireGuard / IPsec tunnel drops every 15-20 minutes. Latency spikes up to 450ms before disconnection.",
		location: "Data Closet IDF-4 / Cloud Gateway",
		priority: "high",
		status: "in_progress",
		createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
		requesterId: "p-req-1",
		assetId: "a-3",
		supervisorId: "p-sup-1",
	},
	{
		id: "t-105",
		title: "Water pipe pressure valve leak in kitchen cafeteria",
		description:
			"Slow leak identified beneath the main commercial sink in the cafeteria. Puddle contained with towels but valve gasket needs replacement.",
		location: "Cafeteria, Ground Floor",
		priority: "critical",
		status: "resolved",
		createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
		closedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
		requesterId: "p-req-1",
		supervisorId: "p-sup-1",
	},
	{
		id: "t-106",
		title: "Request dual monitor arm mount for ergonomic workstation setup",
		description:
			"Occupational health review recommended dual-arm gas-spring desk mount for ergonomic compliance.",
		location: "Floor 3, Desk 42-B",
		priority: "low",
		status: "closed",
		createdAt: new Date(Date.now() - 3600000 * 96).toISOString(),
		closedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
		requesterId: "p-req-1",
		supervisorId: "p-sup-1",
	},
	{
		id: "t-107",
		title: "SSO login redirection loop following company domain migration",
		description:
			"Users trying to access Figma and GitHub SSO via corporate credentials get caught in an infinite auth redirect loop.",
		location: "Global / Remote",
		priority: "high",
		status: "open",
		createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
		requesterId: "p-req-1",
	},
	{
		id: "t-108",
		title: "Conference room Atlas audio echo during hybrid client meeting",
		description:
			"Microphone array pickup in Room Atlas is echoing back participant audio to remote attendees.",
		location: "Executive Tower, Room 401",
		priority: "medium",
		status: "assigned",
		createdAt: new Date(Date.now() - 3600000 * 30).toISOString(),
		requesterId: "p-req-1",
		assetId: "a-4",
		supervisorId: "p-sup-1",
	},
];

export const INITIAL_ASSIGNMENTS: TicketAssignment[] = [
	{
		id: "asg-101",
		ticketId: "t-101",
		assigneeId: "p-asg-1",
		assignedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
	},
	{
		id: "asg-102",
		ticketId: "t-102",
		assigneeId: "p-asg-2",
		assignedAt: new Date(Date.now() - 3600000 * 20).toISOString(),
	},
	{
		id: "asg-104",
		ticketId: "t-104",
		assigneeId: "p-asg-2",
		assignedAt: new Date(Date.now() - 3600000 * 16).toISOString(),
	},
	{
		id: "asg-105",
		ticketId: "t-105",
		assigneeId: "p-asg-1",
		assignedAt: new Date(Date.now() - 3600000 * 46).toISOString(),
	},
	{
		id: "asg-106",
		ticketId: "t-106",
		assigneeId: "p-asg-2",
		assignedAt: new Date(Date.now() - 3600000 * 90).toISOString(),
	},
	{
		id: "asg-108",
		ticketId: "t-108",
		assigneeId: "p-asg-1",
		assignedAt: new Date(Date.now() - 3600000 * 28).toISOString(),
	},
];

export const INITIAL_COMMENTS: TicketComment[] = [
	{
		id: "c-201",
		ticketId: "t-101",
		authorId: "p-sup-1",
		body: "Dispatched Alex Rivera on emergency call. Chillers inspected 20 mins ago; compressor fuse tripped.",
		createdAt: new Date(Date.now() - 3600000 * 3.5).toISOString(),
	},
	{
		id: "c-202",
		ticketId: "t-101",
		authorId: "p-asg-1",
		body: "On-site now. Replaced secondary breaker fuse. Running diagnostic cycle now, condenser fan has restarted.",
		createdAt: new Date(Date.now() - 3600000 * 2.8).toISOString(),
	},
	{
		id: "c-203",
		ticketId: "t-101",
		authorId: "p-req-1",
		body: "Temperature reading just lowered to 76°F. Appreciate the swift dispatch!",
		createdAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
	},
	{
		id: "c-204",
		ticketId: "t-102",
		authorId: "p-asg-2",
		body: "Can you confirm if disabling DisplayPort 1.4 DSC in the monitor OSD menu prevents the crash? We saw similar firmware conflicts with Dell U2723QE.",
		createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
	},
	{
		id: "c-205",
		ticketId: "t-105",
		authorId: "p-asg-1",
		body: "Replaced degraded 0.75-inch rubber O-ring gasket. Tested under full mains pressure for 30 minutes with zero weeping.",
		createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
	},
];

export const INITIAL_ATTACHMENTS: TicketAttachment[] = [
	{
		id: "att-301",
		ticketId: "t-101",
		uploadedById: "p-req-1",
		kind: "issue_evidence",
		storageUrl:
			"https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&q=80",
		uploadedAt: new Date(Date.now() - 3600000 * 3.9).toISOString(),
	},
	{
		id: "att-302",
		ticketId: "t-105",
		uploadedById: "p-asg-1",
		kind: "completion_proof",
		storageUrl:
			"https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&q=80",
		uploadedAt: new Date(Date.now() - 3600000 * 2.9).toISOString(),
	},
];

export const INITIAL_STATUS_HISTORY: TicketStatusHistoryEntry[] = [
	{
		id: "sh-1",
		ticketId: "t-101",
		fromStatus: null,
		toStatus: "open",
		changedById: "p-req-1",
		changedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
	},
	{
		id: "sh-2",
		ticketId: "t-101",
		fromStatus: "open",
		toStatus: "assigned",
		changedById: "p-sup-1",
		changedAt: new Date(Date.now() - 3600000 * 3.5).toISOString(),
	},
	{
		id: "sh-3",
		ticketId: "t-101",
		fromStatus: "assigned",
		toStatus: "in_progress",
		changedById: "p-asg-1",
		changedAt: new Date(Date.now() - 3600000 * 2.8).toISOString(),
	},
	{
		id: "sh-4",
		ticketId: "t-105",
		fromStatus: "in_progress",
		toStatus: "resolved",
		changedById: "p-asg-1",
		changedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
	},
];
