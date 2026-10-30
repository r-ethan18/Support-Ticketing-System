import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { Input } from "../../components/common/Input";
import { Modal } from "../../components/common/Modal";
import { Select } from "../../components/common/Select";
import { TableSkeleton } from "../../components/common/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ticketService } from "../../services/ticketService";
import type { Asset, Category, Department, Vendor } from "../../types/api";

type Tab = "assets" | "departments" | "vendors" | "categories";

type Named = { id: string; name: string };

interface NamedTabProps {
	noun: string;
	items: Named[];
	onCreate: (name: string) => Promise<void>;
	onDelete: (item: Named) => Promise<void>;
}

/** Add-and-delete list for the admin-managed reference data. */
function NamedTab({ noun, items, onCreate, onDelete }: NamedTabProps) {
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<Named | null>(null);
	const [deleting, setDeleting] = useState(false);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		setSaving(true);
		try {
			await onCreate(name.trim());
			setName("");
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!pendingDelete) return;
		setDeleting(true);
		try {
			await onDelete(pendingDelete);
			setPendingDelete(null);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<>
			<form onSubmit={handleCreate} className="filter-toolbar">
				<div className="search-box">
					<Input
						id={`new-${noun}`}
						placeholder={`New ${noun} name`}
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={200}
						className="input-sm"
					/>
				</div>
				<Button
					type="submit"
					variant="primary"
					icon={<Plus size={16} />}
					isLoading={saving}
				>
					Add {noun}
				</Button>
			</form>

			<div className="card table-card">
				{items.length === 0 ? (
					<EmptyState
						title={`No ${noun}s yet`}
						description={`Add a ${noun} above to get started.`}
					/>
				) : (
					<div className="table-responsive">
						<table className="data-table">
							<thead>
								<tr>
									<th>Name</th>
									<th className="text-right">Action</th>
								</tr>
							</thead>
							<tbody>
								{items.map((item) => (
									<tr key={item.id}>
										<td>{item.name}</td>
										<td className="text-right">
											<Button
												variant="ghost"
												size="sm"
												icon={<Trash2 size={14} />}
												onClick={() => setPendingDelete(item)}
											>
												Delete
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			<Modal
				isOpen={pendingDelete !== null}
				onClose={() => setPendingDelete(null)}
				title={`Delete ${noun}`}
				description={`Delete "${pendingDelete?.name}"? This fails while people, assets or tickets still refer to it.`}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button variant="secondary" onClick={() => setPendingDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="danger"
							isLoading={deleting}
							onClick={handleDelete}
						>
							Delete
						</Button>
					</div>
				}
			>
				<p className="text-sm text-secondary">This cannot be undone.</p>
			</Modal>
		</>
	);
}

export function DirectoryPage() {
	const { user, role } = useAuth();
	const { showToast } = useToast();
	const isAdmin = role === "admin";

	const [tab, setTab] = useState<Tab>("assets");
	const [loading, setLoading] = useState(true);
	const [departments, setDepartments] = useState<Department[]>([]);
	const [vendors, setVendors] = useState<Vendor[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [assets, setAssets] = useState<Asset[]>([]);
	const [assetVendors, setAssetVendors] = useState<Record<string, Vendor[]>>(
		{},
	);

	// Asset create/edit modal
	const [assetModalOpen, setAssetModalOpen] = useState(false);
	const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
	const [assetName, setAssetName] = useState("");
	const [assetCategoryId, setAssetCategoryId] = useState("");
	const [assetDepartmentId, setAssetDepartmentId] = useState("");
	const [savingAsset, setSavingAsset] = useState(false);

	// Asset vendors / delete modals
	const [vendorsAsset, setVendorsAsset] = useState<Asset | null>(null);
	const [vendorToAdd, setVendorToAdd] = useState("");
	const [linkingVendor, setLinkingVendor] = useState(false);
	const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
	const [deletingAsset, setDeletingAsset] = useState(false);

	const fail = useCallback(
		(err: unknown, fallback: string) =>
			showToast(err instanceof Error ? err.message : fallback, "error"),
		[showToast],
	);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [d, v, c, a] = await Promise.all([
				ticketService.listDepartments(),
				ticketService.listVendors(),
				ticketService.listCategories(),
				ticketService.listAssets(),
			]);
			setDepartments(d);
			setVendors(v);
			setCategories(c);
			setAssets(a);
			const links = await Promise.all(
				a.map(
					async (asset) =>
						[asset.id, await ticketService.listAssetVendors(asset.id)] as const,
				),
			);
			setAssetVendors(Object.fromEntries(links));
		} catch (err) {
			fail(err, "Failed to load the directory");
		} finally {
			setLoading(false);
		}
	}, [fail]);

	useEffect(() => {
		load();
	}, [load]);

	/** Supervisors manage only their own department's assets. */
	const canManage = (asset: Asset) =>
		isAdmin || asset.departmentId === user?.departmentId;

	const departmentName = (id: string) =>
		departments.find((d) => d.id === id)?.name ?? "—";
	const categoryName = (id: string) =>
		categories.find((c) => c.id === id)?.name ?? "—";

	const openAssetModal = (asset: Asset | null) => {
		setEditingAsset(asset);
		setAssetName(asset?.name ?? "");
		setAssetCategoryId(asset?.categoryId ?? "");
		setAssetDepartmentId(asset?.departmentId ?? "");
		setAssetModalOpen(true);
	};

	const handleSaveAsset = async (e: FormEvent) => {
		e.preventDefault();
		if (!assetName.trim() || !assetCategoryId) return;
		if (!editingAsset && isAdmin && !assetDepartmentId) return;
		setSavingAsset(true);
		try {
			if (editingAsset) {
				const updated = await ticketService.updateAsset(editingAsset.id, {
					name: assetName.trim(),
					categoryId: assetCategoryId,
				});
				setAssets((prev) =>
					prev.map((a) => (a.id === updated.id ? updated : a)),
				);
				showToast("Asset updated", "success");
			} else {
				const created = await ticketService.createAsset({
					name: assetName.trim(),
					categoryId: assetCategoryId,
					departmentId: isAdmin ? assetDepartmentId : undefined,
				});
				setAssets((prev) => [...prev, created]);
				setAssetVendors((prev) => ({ ...prev, [created.id]: [] }));
				showToast("Asset created", "success");
			}
			setAssetModalOpen(false);
		} catch (err) {
			fail(err, "Failed to save asset");
		} finally {
			setSavingAsset(false);
		}
	};

	const handleDeleteAsset = async () => {
		if (!assetToDelete) return;
		setDeletingAsset(true);
		try {
			await ticketService.deleteAsset(assetToDelete.id);
			setAssets((prev) => prev.filter((a) => a.id !== assetToDelete.id));
			showToast("Asset deleted", "success");
			setAssetToDelete(null);
		} catch (err) {
			fail(err, "Failed to delete asset");
		} finally {
			setDeletingAsset(false);
		}
	};

	const linkedVendors = vendorsAsset
		? (assetVendors[vendorsAsset.id] ?? [])
		: [];

	const handleAddVendor = async () => {
		if (!vendorsAsset || !vendorToAdd) return;
		setLinkingVendor(true);
		try {
			await ticketService.addAssetVendor(vendorsAsset.id, vendorToAdd);
			const vendor = vendors.find((v) => v.id === vendorToAdd);
			if (vendor) {
				setAssetVendors((prev) => ({
					...prev,
					[vendorsAsset.id]: [
						...(prev[vendorsAsset.id] ?? []).filter((v) => v.id !== vendor.id),
						vendor,
					],
				}));
			}
			setVendorToAdd("");
		} catch (err) {
			fail(err, "Failed to link vendor");
		} finally {
			setLinkingVendor(false);
		}
	};

	const handleRemoveVendor = async (vendor: Vendor) => {
		if (!vendorsAsset) return;
		try {
			await ticketService.removeAssetVendor(vendorsAsset.id, vendor.id);
			setAssetVendors((prev) => ({
				...prev,
				[vendorsAsset.id]: (prev[vendorsAsset.id] ?? []).filter(
					(v) => v.id !== vendor.id,
				),
			}));
		} catch (err) {
			fail(err, "Failed to unlink vendor");
		}
	};

	/** Run a create/delete, then update the list and toast the outcome. */
	const namedHandlers = <T extends Named>(
		noun: string,
		setItems: (fn: (prev: T[]) => T[]) => void,
		create: (name: string) => Promise<T>,
		remove: (id: string) => Promise<void>,
	) => ({
		onCreate: async (name: string) => {
			try {
				const created = await create(name);
				setItems((prev) => [...prev, created]);
				showToast(`${noun} "${name}" created`, "success");
			} catch (err) {
				fail(err, `Failed to create ${noun.toLowerCase()}`);
			}
		},
		onDelete: async (item: Named) => {
			try {
				await remove(item.id);
				setItems((prev) => prev.filter((i) => i.id !== item.id));
				showToast(`${noun} "${item.name}" deleted`, "success");
			} catch (err) {
				fail(err, `Failed to delete ${noun.toLowerCase()}`);
			}
		},
	});

	const tabs: { id: Tab; label: string }[] = isAdmin
		? [
				{ id: "assets", label: "Assets" },
				{ id: "departments", label: "Departments" },
				{ id: "vendors", label: "Vendors" },
				{ id: "categories", label: "Categories" },
			]
		: [{ id: "assets", label: "Assets" }];

	return (
		<div className="page-wrapper">
			<div className="page-header">
				<div>
					<h2 className="page-title">
						{isAdmin ? "Directory" : "Department Assets"}
					</h2>
					<p className="page-description">
						{isAdmin
							? "Departments, vendors, categories and the assets they own."
							: "Assets in your department, and the vendors responsible for them."}
					</p>
				</div>
				{tab === "assets" && (
					<Button
						variant="primary"
						icon={<Plus size={16} />}
						onClick={() => openAssetModal(null)}
					>
						Add Asset
					</Button>
				)}
			</div>

			{tabs.length > 1 && (
				<div className="tab-header">
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							className={`tab-btn ${tab === t.id ? "active" : ""}`}
							onClick={() => setTab(t.id)}
						>
							<span>{t.label}</span>
						</button>
					))}
				</div>
			)}

			{loading ? (
				<div className="card table-card">
					<TableSkeleton rows={5} cols={4} />
				</div>
			) : tab === "assets" ? (
				<div className="card table-card">
					{assets.length === 0 ? (
						<EmptyState
							title="No assets yet"
							description="Add the equipment and facilities tickets can refer to."
						/>
					) : (
						<div className="table-responsive">
							<table className="data-table">
								<thead>
									<tr>
										<th>Asset</th>
										<th>Department</th>
										<th>Category</th>
										<th>Responsible Vendors</th>
										<th className="text-right">Action</th>
									</tr>
								</thead>
								<tbody>
									{assets.map((asset) => (
										<tr key={asset.id}>
											<td>{asset.name}</td>
											<td>{departmentName(asset.departmentId)}</td>
											<td>{categoryName(asset.categoryId)}</td>
											<td className="text-secondary text-sm">
												{(assetVendors[asset.id] ?? [])
													.map((v) => v.name)
													.join(", ") || "None"}
											</td>
											<td className="text-right">
												{canManage(asset) ? (
													<div className="flex gap-2 justify-end">
														<Button
															variant="ghost"
															size="sm"
															onClick={() => openAssetModal(asset)}
														>
															Edit
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => {
																setVendorsAsset(asset);
																setVendorToAdd("");
															}}
														>
															Vendors
														</Button>
														<Button
															variant="ghost"
															size="sm"
															icon={<Trash2 size={14} />}
															onClick={() => setAssetToDelete(asset)}
														>
															Delete
														</Button>
													</div>
												) : (
													<span className="text-muted text-xs">
														Other department
													</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			) : tab === "departments" ? (
				<NamedTab
					noun="department"
					items={departments}
					{...namedHandlers(
						"Department",
						setDepartments,
						ticketService.createDepartment,
						ticketService.deleteDepartment,
					)}
				/>
			) : tab === "vendors" ? (
				<NamedTab
					noun="vendor"
					items={vendors}
					{...namedHandlers(
						"Vendor",
						setVendors,
						ticketService.createVendor,
						ticketService.deleteVendor,
					)}
				/>
			) : (
				<NamedTab
					noun="category"
					items={categories}
					{...namedHandlers(
						"Category",
						setCategories,
						ticketService.createCategory,
						ticketService.deleteCategory,
					)}
				/>
			)}

			{/* Create / edit asset */}
			<Modal
				isOpen={assetModalOpen}
				onClose={() => setAssetModalOpen(false)}
				title={editingAsset ? "Edit Asset" : "Add Asset"}
				description={
					editingAsset
						? "Rename the asset or change its category."
						: isAdmin
							? "Create an asset in any department."
							: "The asset is created in your department."
				}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button
							variant="secondary"
							onClick={() => setAssetModalOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							isLoading={savingAsset}
							onClick={handleSaveAsset}
						>
							{editingAsset ? "Save" : "Create Asset"}
						</Button>
					</div>
				}
			>
				<form onSubmit={handleSaveAsset} className="flex flex-col gap-4">
					<Input
						id="asset-name"
						label="Name"
						value={assetName}
						onChange={(e) => setAssetName(e.target.value)}
						maxLength={200}
						required
					/>
					<Select
						id="asset-category"
						label="Category"
						value={assetCategoryId}
						onChange={(e) => setAssetCategoryId(e.target.value)}
						required
					>
						<option value="">-- Choose category --</option>
						{categories.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</Select>
					{isAdmin && !editingAsset && (
						<Select
							id="asset-department"
							label="Department"
							value={assetDepartmentId}
							onChange={(e) => setAssetDepartmentId(e.target.value)}
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
				</form>
			</Modal>

			{/* Responsible vendors */}
			<Modal
				isOpen={vendorsAsset !== null}
				onClose={() => setVendorsAsset(null)}
				title="Responsible Vendors"
				description={
					vendorsAsset
						? `Only technicians employed by these vendors can be assigned to tickets for ${vendorsAsset.name}.`
						: ""
				}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button variant="secondary" onClick={() => setVendorsAsset(null)}>
							Done
						</Button>
					</div>
				}
			>
				<div className="flex flex-col gap-4">
					{linkedVendors.length === 0 ? (
						<p className="text-sm text-secondary">
							No vendor is linked, so no technician can be assigned to tickets
							for this asset until one is added.
						</p>
					) : (
						<ul className="flex flex-col gap-2">
							{linkedVendors.map((v) => (
								<li key={v.id} className="flex justify-between items-center">
									<span>{v.name}</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleRemoveVendor(v)}
									>
										Remove
									</Button>
								</li>
							))}
						</ul>
					)}
					<div className="flex gap-2 items-end">
						<div className="flex-1">
							<Select
								id="asset-vendor-add"
								label="Add vendor"
								value={vendorToAdd}
								onChange={(e) => setVendorToAdd(e.target.value)}
							>
								<option value="">-- Choose vendor --</option>
								{vendors
									.filter((v) => !linkedVendors.some((l) => l.id === v.id))
									.map((v) => (
										<option key={v.id} value={v.id}>
											{v.name}
										</option>
									))}
							</Select>
						</div>
						<Button
							variant="primary"
							isLoading={linkingVendor}
							disabled={!vendorToAdd}
							onClick={handleAddVendor}
						>
							Add
						</Button>
					</div>
				</div>
			</Modal>

			{/* Delete asset */}
			<Modal
				isOpen={assetToDelete !== null}
				onClose={() => setAssetToDelete(null)}
				title="Delete Asset"
				description={`Delete "${assetToDelete?.name}"? This fails while tickets still refer to it.`}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button variant="secondary" onClick={() => setAssetToDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="danger"
							isLoading={deletingAsset}
							onClick={handleDeleteAsset}
						>
							Delete
						</Button>
					</div>
				}
			>
				<p className="text-sm text-secondary">This cannot be undone.</p>
			</Modal>
		</div>
	);
}
