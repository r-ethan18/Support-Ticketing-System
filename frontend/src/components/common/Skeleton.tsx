export function Skeleton({
	className = "",
	width,
	height,
}: {
	className?: string;
	width?: string | number;
	height?: string | number;
}) {
	return (
		<div
			className={`skeleton-pulse ${className}`}
			style={{ width, height }}
			aria-hidden="true"
		/>
	);
}

const SKELETON_ROWS = [
	"sk-row-1",
	"sk-row-2",
	"sk-row-3",
	"sk-row-4",
	"sk-row-5",
	"sk-row-6",
	"sk-row-7",
	"sk-row-8",
];

const SKELETON_COLS = [
	"sk-col-1",
	"sk-col-2",
	"sk-col-3",
	"sk-col-4",
	"sk-col-5",
	"sk-col-6",
];

export function TableSkeleton({
	rows = 5,
	cols = 5,
}: {
	rows?: number;
	cols?: number;
}) {
	const activeRows = SKELETON_ROWS.slice(
		0,
		Math.min(rows, SKELETON_ROWS.length),
	);
	const activeCols = SKELETON_COLS.slice(
		0,
		Math.min(cols, SKELETON_COLS.length),
	);

	return (
		<div className="table-skeleton-wrap" aria-hidden="true">
			{activeRows.map((rowKey) => (
				<div key={rowKey} className="skeleton-row">
					{activeCols.map((colKey, cIdx) => (
						<Skeleton
							key={`${rowKey}-${colKey}`}
							height={18}
							className={cIdx === 0 ? "skeleton-primary" : "skeleton-secondary"}
						/>
					))}
				</div>
			))}
		</div>
	);
}

export function CardSkeleton() {
	return (
		<div className="card-skeleton" aria-hidden="true">
			<Skeleton height={20} width="40%" className="mb-2" />
			<Skeleton height={32} width="60%" className="mb-4" />
			<Skeleton height={14} width="85%" />
		</div>
	);
}
