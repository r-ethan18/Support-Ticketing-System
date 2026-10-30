import { Mail, Phone, Search, UserPlus, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Avatar } from "../../components/common/Avatar";
import { RoleBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { Input } from "../../components/common/Input";
import { Modal } from "../../components/common/Modal";
import { Select } from "../../components/common/Select";
import { TableSkeleton } from "../../components/common/Skeleton";
import { useToast } from "../../context/ToastContext";
import { apiRequest } from "../../services/apiClient";
import { isMockMode, ticketService } from "../../services/ticketService";
import type { Department, Person, Role, Vendor } from "../../types/api";

const PASSWORD_ALPHABET =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random one-time password for a new account (about 93 bits). */
function generatePassword(length = 16): string {
	const bytes = crypto.getRandomValues(new Uint32Array(length));
	return Array.from(
		bytes,
		(b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length],
	).join("");
}

export function UserManagementPage() {
	const { showToast } = useToast();
	const [people, setPeople] = useState<Person[]>([]);
	const [departments, setDepartments] = useState<Department[]>([]);
	const [vendors, setVendors] = useState<Vendor[]>([]);
	const [loading, setLoading] = useState(true);

	// Filters
	const [searchQuery, setSearchQuery] = useState("");
	const [roleFilter, setRoleFilter] = useState<string>("all");

	// Add User Modal
	const [addUserModalOpen, setAddUserModalOpen] = useState(false);
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const [newPhone, setNewPhone] = useState("");
	const [newRole, setNewRole] = useState<Role>("requester");
	const [newDeptId, setNewDeptId] = useState("");
	const [newVendorId, setNewVendorId] = useState("");
	const [creatingUser, setCreatingUser] = useState(false);
	// Shown once after a live account is created; the server never reveals it again.
	const [createdCredentials, setCreatedCredentials] = useState<{
		email: string;
		password: string;
	} | null>(null);

	useEffect(() => {
		async function loadData() {
			try {
				setLoading(true);
				const [loadedPeople, loadedDepts, loadedVendors] = await Promise.all([
					ticketService.listPeople(),
					ticketService.listDepartments(),
					ticketService.listVendors(),
				]);
				setPeople(loadedPeople);
				setDepartments(loadedDepts);
				setVendors(loadedVendors);
			} catch (err) {
				console.error("Failed to load user management data", err);
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, []);

	const handleAddUser = async (e: FormEvent) => {
		e.preventDefault();
		if (!newName.trim() || !newEmail.trim()) return;

		setCreatingUser(true);
		try {
			if (!isMockMode()) {
				const password = generatePassword();
				const phone = newPhone.trim() || "+1-555-0000";
				const email = newEmail.trim();
				if (newRole === "admin") {
					await apiRequest("/admins", {
						method: "POST",
						body: JSON.stringify({
							name: newName.trim(),
							email,
							phone,
							password,
						}),
					});
				} else {
					const reg = await apiRequest<Person>("/auth/register", {
						method: "POST",
						body: JSON.stringify({
							name: newName.trim(),
							email,
							phone,
							password,
						}),
					});

					if (newRole !== "requester") {
						try {
							await apiRequest(`/people/${reg.id}/role`, {
								method: "PUT",
								body: JSON.stringify({
									role: newRole,
									departmentId:
										newRole === "supervisor"
											? newDeptId || departments[0]?.id || null
											: null,
									vendorId:
										newRole === "assignee"
											? newVendorId || vendors[0]?.id || null
											: null,
								}),
							});
						} catch (err) {
							// Don't leave a half-provisioned requester behind.
							await apiRequest(`/people/${reg.id}`, {
								method: "DELETE",
							}).catch(() => {});
							throw err;
						}
					}
				}

				setPeople(await ticketService.listPeople());
				setCreatedCredentials({ email, password });
			} else {
				const newPerson: Person = {
					id: `p-${Date.now()}`,
					name: newName.trim(),
					email: newEmail.trim(),
					phone: newPhone.trim() || "+1 (555) 000-0000",
					role: newRole,
					departmentId: newDeptId || null,
					vendorId: newVendorId || null,
				};
				setPeople((prev) => [newPerson, ...prev]);
				setAddUserModalOpen(false);
			}

			setNewName("");
			setNewEmail("");
			setNewPhone("");
			showToast(`Created new ${newRole} account for ${newName}`, "success");
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to create user",
				"error",
			);
		} finally {
			setCreatingUser(false);
		}
	};

	const closeAddUserModal = () => {
		setAddUserModalOpen(false);
		setCreatedCredentials(null);
	};

	const filteredPeople = people.filter((p) => {
		if (roleFilter !== "all" && p.role !== roleFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			return (
				p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
			);
		}
		return true;
	});

	return (
		<div className="page-wrapper">
			<div className="page-header">
				<div>
					<h2 className="page-title">Personnel & Role Management</h2>
					<p className="page-description">
						Manage staff accounts, assign departmental supervisors, and
						configure service contractor technician access.
					</p>
				</div>
				<Button
					variant="primary"
					icon={<UserPlus size={16} />}
					onClick={() => setAddUserModalOpen(true)}
				>
					Add Personnel
				</Button>
			</div>

			{/* Filters Toolbar */}
			<div className="filter-toolbar">
				<div className="search-box">
					<Input
						placeholder="Search personnel by name or email address..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						leftIcon={<Search size={16} />}
						className="input-sm"
					/>
				</div>

				<div className="filter-controls">
					<div className="filter-select-wrap">
						<Select
							value={roleFilter}
							onChange={(e) => setRoleFilter(e.target.value)}
							className="select-sm"
						>
							<option value="all">All Roles</option>
							<option value="requester">Requesters</option>
							<option value="assignee">Assignees (Field Techs)</option>
							<option value="supervisor">Supervisors</option>
							<option value="admin">Administrators</option>
						</Select>
					</div>
				</div>
			</div>

			{/* Users Data Table */}
			<div className="card table-card">
				{loading ? (
					<TableSkeleton rows={5} cols={5} />
				) : filteredPeople.length === 0 ? (
					<EmptyState
						icon={<Users size={32} />}
						title="No personnel found"
						description="No accounts match your current filter parameters."
					/>
				) : (
					<div className="table-responsive">
						<table className="data-table">
							<thead>
								<tr>
									<th>Person</th>
									<th>Contact</th>
									<th>Role</th>
									<th>Department / Vendor</th>
									<th className="text-right">Action</th>
								</tr>
							</thead>
							<tbody>
								{filteredPeople.map((person) => {
									const dept = departments.find(
										(d) => d.id === person.departmentId,
									);
									const vendor = vendors.find((v) => v.id === person.vendorId);

									return (
										<tr key={person.id}>
											<td>
												<div className="user-table-cell">
													<Avatar name={person.name} size="sm" />
													<div className="user-text">
														<span className="font-medium text-slate">
															{person.name}
														</span>
														<span className="user-id-code text-muted text-xs">
															#{person.id}
														</span>
													</div>
												</div>
											</td>
											<td>
												<div className="flex flex-col text-sm">
													<span className="text-slate flex items-center gap-1">
														<Mail size={12} className="text-secondary" />
														{person.email}
													</span>
													{person.phone && (
														<span className="text-secondary text-xs flex items-center gap-1">
															<Phone size={11} />
															{person.phone}
														</span>
													)}
												</div>
											</td>
											<td>
												<RoleBadge role={person.role} size="sm" />
											</td>
											<td className="text-secondary text-sm">
												{dept
													? dept.name
													: vendor
														? `${vendor.name} (Contractor)`
														: "Enterprise General"}
											</td>
											<td className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														showToast(
															`Editing ${person.name} permissions`,
															"info",
														)
													}
												>
													Manage
												</Button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Add User Modal */}
			<Modal
				isOpen={addUserModalOpen}
				onClose={closeAddUserModal}
				title="Register Enterprise User"
				description="Provision a new account with appropriate workspace access rights."
				footer={
					createdCredentials ? (
						<div className="flex gap-2 justify-end w-full">
							<Button variant="primary" onClick={closeAddUserModal}>
								Done
							</Button>
						</div>
					) : (
						<div className="flex gap-2 justify-end w-full">
							<Button variant="secondary" onClick={closeAddUserModal}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isLoading={creatingUser}
								onClick={handleAddUser}
							>
								Create Account
							</Button>
						</div>
					)
				}
			>
				{createdCredentials ? (
					<div className="flex flex-col gap-3">
						<p className="text-sm">
							Account created. Share these sign-in details with the user
							securely; the password is shown only once.
						</p>
						<code className="text-sm">{createdCredentials.email}</code>
						<code className="text-sm">{createdCredentials.password}</code>
						<Button
							variant="secondary"
							onClick={() =>
								navigator.clipboard
									?.writeText(createdCredentials.password)
									.then(() => showToast("Password copied", "success"))
									.catch(() => showToast("Could not copy password", "error"))
							}
						>
							Copy Password
						</Button>
					</div>
				) : (
					<form onSubmit={handleAddUser} className="flex flex-col gap-4">
						<Input
							id="new-user-name"
							label="Full Name"
							placeholder="e.g. David Miller"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							required
						/>

						<Input
							id="new-user-email"
							label="Email Address"
							type="email"
							placeholder="d.miller@example.com"
							value={newEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							required
						/>

						<Input
							id="new-user-phone"
							label="Phone Number"
							placeholder="+1 (555) 234-5678"
							value={newPhone}
							onChange={(e) => setNewPhone(e.target.value)}
						/>

						<Select
							id="new-user-role"
							label="System Role"
							value={newRole}
							onChange={(e) => setNewRole(e.target.value as Role)}
							required
						>
							<option value="requester">Requester (Standard Employee)</option>
							<option value="assignee">Assignee (Field Technician)</option>
							<option value="supervisor">Supervisor (Department Head)</option>
							<option value="admin">Administrator (System Admin)</option>
						</Select>

						{newRole === "supervisor" && (
							<Select
								id="new-user-dept"
								label="Assign Department"
								value={newDeptId}
								onChange={(e) => setNewDeptId(e.target.value)}
							>
								<option value="">-- Choose department --</option>
								{departments.map((d) => (
									<option key={d.id} value={d.id}>
										{d.name}
									</option>
								))}
							</Select>
						)}

						{newRole === "assignee" && (
							<Select
								id="new-user-vendor"
								label="Assign Vendor Affiliation"
								value={newVendorId}
								onChange={(e) => setNewVendorId(e.target.value)}
							>
								<option value="">-- In-house or select vendor --</option>
								{vendors.map((v) => (
									<option key={v.id} value={v.id}>
										{v.name}
									</option>
								))}
							</Select>
						)}
					</form>
				)}
			</Modal>
		</div>
	);
}
