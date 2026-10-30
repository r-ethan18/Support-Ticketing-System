import { Mail, Phone, Search, Users } from "lucide-react";
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

	// Filters
	const [searchQuery, setSearchQuery] = useState("");
	const [roleFilter, setRoleFilter] = useState<string>("all");

	// Role assignment modal
	const [editing, setEditing] = useState<Person | null>(null);
	const [editRole, setEditRole] = useState<Exclude<Role, "admin">>("requester");
	const [editDeptId, setEditDeptId] = useState("");
	const [editVendorId, setEditVendorId] = useState("");
	const [saving, setSaving] = useState(false);

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

	const openRoleModal = (person: Person) => {
		setEditing(person);
		setEditRole(person.role === "admin" ? "requester" : person.role);
		setEditDeptId(person.departmentId ?? "");
		setEditVendorId(person.vendorId ?? "");
	};

	const handleAssignRole = async (e: FormEvent) => {
		e.preventDefault();
		if (!editing) return;
		if (editRole === "supervisor" && !editDeptId) {
			showToast("Choose a department for the supervisor.", "error");
			return;
		}
		if (editRole === "assignee" && !editVendorId) {
			showToast("Choose the vendor employing the assignee.", "error");
			return;
		}

		setSaving(true);
		try {
			const updated = await ticketService.assignRole(editing.id, {
				role: editRole,
				departmentId: editRole === "supervisor" ? editDeptId : null,
				vendorId: editRole === "assignee" ? editVendorId : null,
			});
			setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
			showToast(`${updated.name} is now a ${updated.role}`, "success");
			setEditing(null);
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to update role",
				"error",
			);
		} finally {
			setSaving(false);
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
						People sign up themselves as requesters. Promote them to supervisors
						or vendor assignees here.
					</p>
				</div>
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
												{person.role === "admin" ? (
													<span className="text-muted text-xs">Fixed</span>
												) : (
													<Button
														variant="ghost"
														size="sm"
														onClick={() => openRoleModal(person)}
													>
														Change Role
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

			{/* Role Assignment Modal */}
			<Modal
				isOpen={editing !== null}
				onClose={() => setEditing(null)}
				title="Change Role"
				description={
					editing
						? `${editing.name} (${editing.email})`
						: "Assign a role to an existing account."
				}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button variant="secondary" onClick={() => setEditing(null)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							isLoading={saving}
							onClick={handleAssignRole}
						>
							Save Role
						</Button>
					</div>
				}
			>
				<form onSubmit={handleAssignRole} className="flex flex-col gap-4">
					<Select
						id="edit-role"
						label="System Role"
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
							label="Department"
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
							label="Employing Vendor"
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
			</Modal>
		</div>
	);
}
