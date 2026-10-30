import {
	AlertTriangle,
	Eye,
	EyeOff,
	Lock,
	Mail,
	Phone,
	Search,
	ShieldCheck,
	Trash2,
	UserPlus,
	Users,
} from "lucide-react";
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
import { ticketService } from "../../services/ticketService";
import type { Department, Person, Role, Vendor } from "../../types/api";

export function UserManagementPage() {
	const { showToast } = useToast();
	const [people, setPeople] = useState<Person[]>([]);
	const [departments, setDepartments] = useState<Department[]>([]);
	const [vendors, setVendors] = useState<Vendor[]>([]);
	const [loading, setLoading] = useState(true);

	// Filter state
	const [searchQuery, setSearchQuery] = useState("");
	const [roleFilter, setRoleFilter] = useState<string>("all");

	// Add User Modal State
	const [addUserModalOpen, setAddUserModalOpen] = useState(false);
	const [newName, setNewName] = useState("");
	const [newEmail, setNewEmail] = useState("");
	const [newPhone, setNewPhone] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [showNewPassword, setShowNewPassword] = useState(false);
	const [newRole, setNewRole] = useState<Role>("requester");
	const [newDeptId, setNewDeptId] = useState("");
	const [newVendorId, setNewVendorId] = useState("");
	const [creatingUser, setCreatingUser] = useState(false);

	// Manage User Modal State
	const [managingPerson, setManagingPerson] = useState<Person | null>(null);
	const [editRole, setEditRole] = useState<Exclude<Role, "admin">>("requester");
	const [editDeptId, setEditDeptId] = useState("");
	const [editVendorId, setEditVendorId] = useState("");
	const [savingRole, setSavingRole] = useState(false);
	const [deletingUser, setDeletingUser] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	useEffect(() => {
		async function loadData() {
			try {
				setLoading(true);
				const [loadedPeople, loadedDepts, loadedVendors] = await Promise.all([
					ticketService.listPeople({ limit: 100 }),
					ticketService.listDepartments(),
					ticketService.listVendors(),
				]);
				setPeople(loadedPeople);
				setDepartments(loadedDepts);
				setVendors(loadedVendors);
			} catch (err) {
				console.error("Failed to load user management data", err);
				showToast("Failed to load personnel data from backend", "error");
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, [showToast]);

	// Open Manage Modal
	const openManageModal = (person: Person) => {
		setManagingPerson(person);
		setEditRole(person.role === "admin" ? "requester" : person.role);
		setEditDeptId(person.departmentId ?? "");
		setEditVendorId(person.vendorId ?? "");
		setShowDeleteConfirm(false);
	};

	// Handle Create User
	const handleCreateUser = async (e: FormEvent) => {
		e.preventDefault();
		if (!newName.trim() || !newEmail.trim()) {
			showToast("Name and email are required", "error");
			return;
		}
		if (newPassword.length < 12) {
			showToast("Password must be at least 12 characters", "error");
			return;
		}
		if (newRole === "supervisor" && !newDeptId) {
			showToast("Department is required for supervisors", "error");
			return;
		}
		if (newRole === "assignee" && !newVendorId) {
			showToast("Vendor affiliation is required for assignees", "error");
			return;
		}

		setCreatingUser(true);
		try {
			let created: Person;
			if (newRole === "admin") {
				created = await ticketService.createAdminUser({
					name: newName.trim(),
					email: newEmail.trim(),
					phone: newPhone.trim() || "+1-555-0100",
					password: newPassword,
				});
			} else {
				// Register account with the specified password
				created = await ticketService.registerPerson({
					name: newName.trim(),
					email: newEmail.trim(),
					phone: newPhone.trim() || "+1-555-0100",
					password: newPassword,
				});

				// If admin assigned a role other than requester, assign it now
				if (newRole !== "requester") {
					created = await ticketService.assignRole(created.id, {
						role: newRole,
						departmentId: newRole === "supervisor" ? newDeptId : null,
						vendorId: newRole === "assignee" ? newVendorId : null,
					});
				}
			}

			setPeople((prev) => [created, ...prev]);
			showToast(
				`Successfully created ${created.name} (${created.role.toUpperCase()})`,
				"success",
			);
			setAddUserModalOpen(false);
			setNewName("");
			setNewEmail("");
			setNewPhone("");
			setNewPassword("");
			setNewRole("requester");
			setNewDeptId("");
			setNewVendorId("");
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to create user",
				"error",
			);
		} finally {
			setCreatingUser(false);
		}
	};

	// Handle Update Role
	const handleAssignRole = async (e: FormEvent) => {
		e.preventDefault();
		if (!managingPerson) return;
		if (editRole === "supervisor" && !editDeptId) {
			showToast("Choose a department for the supervisor.", "error");
			return;
		}
		if (editRole === "assignee" && !editVendorId) {
			showToast("Choose the vendor employing the assignee.", "error");
			return;
		}

		setSavingRole(true);
		try {
			const updated = await ticketService.assignRole(managingPerson.id, {
				role: editRole,
				departmentId: editRole === "supervisor" ? editDeptId : null,
				vendorId: editRole === "assignee" ? editVendorId : null,
			});
			setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
			showToast(
				`Updated ${updated.name}'s role to ${updated.role.toUpperCase()}`,
				"success",
			);
			setManagingPerson(null);
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to update role",
				"error",
			);
		} finally {
			setSavingRole(false);
		}
	};

	// Handle Delete User
	const handleDeleteUser = async () => {
		if (!managingPerson) return;

		setDeletingUser(true);
		try {
			await ticketService.deletePerson(managingPerson.id);
			setPeople((prev) => prev.filter((p) => p.id !== managingPerson.id));
			showToast(`Deactivated account for ${managingPerson.name}`, "success");
			setManagingPerson(null);
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to delete user",
				"error",
			);
		} finally {
			setDeletingUser(false);
			setShowDeleteConfirm(false);
		}
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
						Once users register, roles are unassigned by default. Promote
						personnel to Supervisors or Vendor Technicians below.
					</p>
				</div>
				<Button
					variant="primary"
					icon={<UserPlus size={16} />}
					onClick={() => setAddUserModalOpen(true)}
				>
					Create User
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
							<option value="requester">Requesters (Standard Employees)</option>
							<option value="assignee">Assignees (Field Techs)</option>
							<option value="supervisor">Supervisors (Department Leads)</option>
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
									<th>Assigned Role</th>
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
															#{person.id.slice(0, 8)}
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
														: "General Employee"}
											</td>
											<td className="text-right">
												{person.role === "admin" ? (
													<span className="text-muted text-xs font-semibold">
														System Admin
													</span>
												) : (
													<Button
														variant="secondary"
														size="sm"
														icon={<ShieldCheck size={14} />}
														onClick={() => openManageModal(person)}
													>
														Manage
													</Button>
												)}
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
				onClose={() => setAddUserModalOpen(false)}
				title="Create System User"
				description="Provision a new employee or staff account with credentials and access permissions."
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button
							variant="secondary"
							onClick={() => setAddUserModalOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							isLoading={creatingUser}
							onClick={handleCreateUser}
						>
							Create User
						</Button>
					</div>
				}
			>
				<form onSubmit={handleCreateUser} className="flex flex-col gap-4">
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

					{/* Explicit Password Field as requested */}
					<Input
						id="new-user-password"
						label="Account Password (min. 12 characters)"
						type={showNewPassword ? "text" : "password"}
						placeholder="Minimum 12 characters"
						minLength={12}
						value={newPassword}
						onChange={(e) => setNewPassword(e.target.value)}
						required
						leftIcon={<Lock size={16} />}
						rightElement={
							<button
								type="button"
								className="password-toggle-btn"
								onClick={() => setShowNewPassword(!showNewPassword)}
								aria-label={showNewPassword ? "Hide password" : "Show password"}
							>
								{showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
							</button>
						}
					/>

					<Select
						id="new-user-role"
						label="Assign System Role"
						value={newRole}
						onChange={(e) => setNewRole(e.target.value as Role)}
						required
					>
						<option value="requester">
							Requester (Standard Employee - Base Access)
						</option>
						<option value="assignee">Assignee (Vendor Technician)</option>
						<option value="supervisor">Supervisor (Department Head)</option>
						<option value="admin">Administrator (System Admin)</option>
					</Select>

					{newRole === "supervisor" && (
						<Select
							id="new-user-dept"
							label="Assign Department"
							value={newDeptId}
							onChange={(e) => setNewDeptId(e.target.value)}
							required
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
							label="Assign Employing Vendor"
							value={newVendorId}
							onChange={(e) => setNewVendorId(e.target.value)}
							required
						>
							<option value="">-- Choose vendor --</option>
							{vendors.map((v) => (
								<option key={v.id} value={v.id}>
									{v.name}
								</option>
							))}
						</Select>
					)}
				</form>
			</Modal>

			{/* Manage User Modal */}
			<Modal
				isOpen={managingPerson !== null}
				onClose={() => setManagingPerson(null)}
				title="Manage User & Assign Role"
				description={
					managingPerson
						? `${managingPerson.name} (${managingPerson.email})`
						: "Assign roles or manage permissions."
				}
				footer={
					<div className="flex gap-2 justify-between w-full">
						<div>
							{!showDeleteConfirm ? (
								<Button
									variant="danger"
									size="sm"
									icon={<Trash2 size={14} />}
									onClick={() => setShowDeleteConfirm(true)}
								>
									Deactivate
								</Button>
							) : (
								<div className="flex items-center gap-2">
									<Button
										variant="danger"
										size="sm"
										isLoading={deletingUser}
										onClick={handleDeleteUser}
									>
										Confirm Delete
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setShowDeleteConfirm(false)}
									>
										Cancel
									</Button>
								</div>
							)}
						</div>
						<div className="flex gap-2">
							<Button
								variant="secondary"
								onClick={() => setManagingPerson(null)}
							>
								Close
							</Button>
							<Button
								variant="primary"
								isLoading={savingRole}
								onClick={handleAssignRole}
							>
								Save Role
							</Button>
						</div>
					</div>
				}
			>
				{managingPerson && (
					<form onSubmit={handleAssignRole} className="flex flex-col gap-4">
						{showDeleteConfirm && (
							<div className="bg-danger-subtle border border-danger p-3 rounded text-sm text-danger flex items-start gap-2">
								<AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
								<span>
									Are you sure you want to delete this user? Their active
									assignments will be released.
								</span>
							</div>
						)}

						<div className="p-3 bg-muted rounded-md flex flex-col gap-1 text-sm">
							<span className="font-semibold text-slate">
								User Account: {managingPerson.name}
							</span>
							<span className="text-secondary">{managingPerson.email}</span>
							<span className="text-secondary text-xs">
								Current Role:{" "}
								<strong>{managingPerson.role.toUpperCase()}</strong>
							</span>
						</div>

						<Select
							id="edit-role"
							label="Assign System Role"
							value={editRole}
							onChange={(e) =>
								setEditRole(e.target.value as Exclude<Role, "admin">)
							}
						>
							<option value="requester">Requester (Standard Employee)</option>
							<option value="assignee">Assignee (Vendor Technician)</option>
							<option value="supervisor">Supervisor (Department Head)</option>
						</Select>

						{editRole === "supervisor" && (
							<Select
								id="edit-dept"
								label="Supervised Department"
								value={editDeptId}
								onChange={(e) => setEditDeptId(e.target.value)}
								required
							>
								<option value="">-- Choose department --</option>
								{departments.map((d) => (
									<option key={d.id} value={d.id}>
										{d.name}
									</option>
								))}
							</Select>
						)}

						{editRole === "assignee" && (
							<Select
								id="edit-vendor"
								label="Employing Contractor / Vendor"
								value={editVendorId}
								onChange={(e) => setEditVendorId(e.target.value)}
								required
							>
								<option value="">-- Choose vendor --</option>
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
