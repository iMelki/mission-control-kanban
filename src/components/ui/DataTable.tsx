'use client';

import { useMemo, useReducer, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingFn,
  type SortingState,
} from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
    headerClassName?: string;
  }
}

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => unknown;
  searchValue?: (row: T) => string;
  className?: string;
  headerClassName?: string;
  enableSorting?: boolean;
  enableGlobalFilter?: boolean;
  hidden?: boolean;
  sortingFn?: SortingFn<T>;
  filterFn?: FilterFn<T>;
}

export interface DataTableFilter {
  id: string;
  label: string;
  columnId: string;
  options: Array<{ label: string; value: string }>;
  allLabel?: string;
}

export interface DataTableBulkAction<T> {
  label: string;
  onClick: (rows: T[]) => void | Promise<void>;
  disabled?: boolean | ((rows: T[]) => boolean);
  variant?: 'default' | 'danger';
}

interface DataTableSearchConfig {
  placeholder?: string;
  label?: string;
}

interface DataTableProps<T extends { id?: string }> {
  columns: DataTableColumn<T>[];
  rows: T[];
  empty: string;
  getRowKey?: (row: T, index: number) => string;
  caption?: string;
  search?: boolean | DataTableSearchConfig;
  filters?: DataTableFilter[];
  initialSorting?: SortingState;
  enableRowSelection?: boolean | ((row: T) => boolean);
  bulkActions?: DataTableBulkAction<T>[];
  selectedRowsLabel?: (selected: number, total: number) => string;
}


const EMPTY_FILTERS: DataTableFilter[] = [];
const EMPTY_SORTING: SortingState = [];
const EMPTY_BULK_ACTIONS: DataTableBulkAction<{ id?: string }>[] = [];

type DataTableState = {
  sorting: SortingState;
  globalFilter: string;
  columnFilters: ColumnFiltersState;
  rowSelection: RowSelectionState;
  pendingAction: string | null;
};

type DataTableAction =
  | { type: 'sorting'; value: SortingState | ((current: SortingState) => SortingState) }
  | { type: 'globalFilter'; value: string }
  | { type: 'columnFilters'; value: ColumnFiltersState | ((current: ColumnFiltersState) => ColumnFiltersState) }
  | { type: 'rowSelection'; value: RowSelectionState | ((current: RowSelectionState) => RowSelectionState) }
  | { type: 'pendingAction'; value: string | null };

function resolveUpdater<TValue>(value: TValue | ((current: TValue) => TValue), current: TValue): TValue {
  return typeof value === 'function' ? (value as (current: TValue) => TValue)(current) : value;
}

function dataTableReducer(state: DataTableState, action: DataTableAction): DataTableState {
  switch (action.type) {
    case 'sorting':
      return { ...state, sorting: resolveUpdater(action.value, state.sorting) };
    case 'globalFilter':
      return { ...state, globalFilter: action.value };
    case 'columnFilters':
      return { ...state, columnFilters: resolveUpdater(action.value, state.columnFilters) };
    case 'rowSelection':
      return { ...state, rowSelection: resolveUpdater(action.value, state.rowSelection) };
    case 'pendingAction':
      return { ...state, pendingAction: action.value };
    default:
      return state;
  }
}

function createGlobalFilter<TData>(searchAccessors: Map<string, (row: TData) => string>): FilterFn<TData> {
  return (row, columnId, filterValue) => {
    const query = String(filterValue || '').trim().toLowerCase();
    if (!query) return true;
    const value = searchAccessors.get(columnId)?.(row.original) ?? row.getValue(columnId);
    return String(value ?? '').toLowerCase().includes(query);
  };
}

function createSelectFilter<TData>(): FilterFn<TData> {
  return (row, columnId, filterValue) => {
    if (!filterValue) return true;
    return String(row.getValue(columnId) ?? '') === String(filterValue);
  };
}

function getDefaultAccessor<T>(column: DataTableColumn<T>) {
  return (row: T) => {
    if (column.accessor) return column.accessor(row);
    if (column.searchValue) return column.searchValue(row);
    const keyedValue = (row as Record<string, unknown>)[column.key];
    if (typeof keyedValue === 'string' || typeof keyedValue === 'number' || typeof keyedValue === 'boolean') {
      return keyedValue;
    }
    return '';
  };
}

function IndeterminateCheckbox({ indeterminate, ...props }: InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  return (
    <input
      {...props}
      ref={(input) => {
        if (input) input.indeterminate = Boolean(indeterminate) && !props.checked;
      }}
      type="checkbox"
      className={`size-4 rounded border-mc-border bg-mc-bg accent-mc-accent ${props.className || ''}`}
    />
  );
}

function SortIndicator({ sortState }: { sortState: false | 'asc' | 'desc' }) {
  if (sortState === 'asc') return <span aria-hidden="true"> ↑</span>;
  if (sortState === 'desc') return <span aria-hidden="true"> ↓</span>;
  return null;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  empty,
  getRowKey,
  caption,
  search = false,
  filters = EMPTY_FILTERS,
  initialSorting = EMPTY_SORTING,
  enableRowSelection = false,
  bulkActions = EMPTY_BULK_ACTIONS as DataTableBulkAction<T>[],
  selectedRowsLabel,
}: DataTableProps<T>) {
  const [state, dispatch] = useReducer(dataTableReducer, {
    sorting: initialSorting,
    globalFilter: '',
    columnFilters: [],
    rowSelection: {},
    pendingAction: null,
  });
  const { sorting, globalFilter, columnFilters, rowSelection, pendingAction } = state;

  const filterColumnIds = useMemo(() => new Set(filters.map((filter) => filter.columnId)), [filters]);
  const searchAccessors = useMemo(() => new Map(columns
    .flatMap((column) => column.searchValue ? [[column.key, column.searchValue] as const] : [])), [columns]);
  const globalFilterFn = useMemo(() => createGlobalFilter<T>(searchAccessors), [searchAccessors]);
  const selectFilterFn = useMemo(() => createSelectFilter<T>(), []);

  const tableColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    const selectionColumn: ColumnDef<T, unknown>[] = enableRowSelection
      ? [{
          id: '__select',
          header: ({ table }) => (
            <IndeterminateCheckbox
              aria-label="Select all visible rows"
              checked={table.getIsAllPageRowsSelected()}
              indeterminate={table.getIsSomePageRowsSelected()}
              onChange={table.getToggleAllPageRowsSelectedHandler()}
            />
          ),
          cell: ({ row }) => (
            <IndeterminateCheckbox
              aria-label="Select row"
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect()}
              indeterminate={row.getIsSomeSelected()}
              onChange={row.getToggleSelectedHandler()}
            />
          ),
          enableSorting: false,
          enableColumnFilter: false,
          enableGlobalFilter: false,
          meta: { className: 'w-10', headerClassName: 'w-10' },
        }]
      : [];

    const dataColumns: ColumnDef<T, unknown>[] = columns.map((column): ColumnDef<T, unknown> => ({
        id: column.key,
        header: () => column.header,
        accessorFn: getDefaultAccessor(column),
        cell: ({ row }: { row: Row<T> }) => column.render ? column.render(row.original) : String(row.getValue(column.key) ?? ''),
        enableSorting: column.enableSorting ?? Boolean(column.accessor || column.searchValue),
        enableGlobalFilter: column.enableGlobalFilter ?? true,
        enableHiding: true,
        sortingFn: column.sortingFn,
        filterFn: column.filterFn ?? (filterColumnIds.has(column.key) ? selectFilterFn : undefined),
        meta: {
          className: column.className,
          headerClassName: column.headerClassName,
        },
      }));

    return [...selectionColumn, ...dataColumns];
  }, [columns, enableRowSelection, filterColumnIds, selectFilterFn]);

  const columnVisibility = useMemo(
    () => columns.reduce<Record<string, boolean>>((acc, column) => {
      if (column.hidden) acc[column.key] = false;
      return acc;
    }, {}),
    [columns]
  );

  const table = useReactTable<T>({
    data: rows,
    columns: tableColumns,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      rowSelection,
      columnVisibility,
    },
    onSortingChange: (value) => dispatch({ type: 'sorting', value }),
    onGlobalFilterChange: (value) => dispatch({ type: 'globalFilter', value: String(value) }),
    onColumnFiltersChange: (value) => dispatch({ type: 'columnFilters', value }),
    onRowSelectionChange: (value) => dispatch({ type: 'rowSelection', value }),
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row, index) => getRowKey ? getRowKey(row, index) : row.id || String(index),
    enableRowSelection: typeof enableRowSelection === 'function'
      ? (row) => enableRowSelection(row.original)
      : enableRowSelection,
  });


  const searchConfig = typeof search === 'object' ? search : {};
  const showToolbar = Boolean(search || filters.length || bulkActions.length);
  const selectedRows = table.getFilteredSelectedRowModel().rows.map((row) => row.original);
  const selectedCount = selectedRows.length;
  const visibleCount = table.getRowModel().rows.length;
  const totalCount = table.getCoreRowModel().rows.length;

  const handleBulkAction = async (action: DataTableBulkAction<T>) => {
    dispatch({ type: 'pendingAction', value: action.label });
    try {
      await action.onClick(selectedRows);
    } catch (error) {
      console.error('DataTable bulk action failed:', error);
    } finally {
      dispatch({ type: 'pendingAction', value: null });
    }
  };

  return (
    <div className="space-y-3">
      {showToolbar ? (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-mc-border bg-mc-bg-secondary p-3">
          <div className="flex flex-wrap items-end gap-3">
            {search ? (
              <label className="flex min-w-64 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-mc-text-secondary">
                {searchConfig.label || 'Search'}
                <input
                  type="search"
                  value={globalFilter}
                  onChange={(event) => dispatch({ type: 'globalFilter', value: event.target.value })}
                  placeholder={searchConfig.placeholder || 'Search table…'}
                  className="rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm normal-case tracking-normal text-mc-text outline-none focus:border-mc-accent"
                />
              </label>
            ) : null}
            {filters.map((filter) => {
              const value = String(table.getColumn(filter.columnId)?.getFilterValue() || '');
              return (
                <label key={filter.id} className="flex min-w-40 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-mc-text-secondary">
                  {filter.label}
                  <select
                    value={value}
                    onChange={(event) => table.getColumn(filter.columnId)?.setFilterValue(event.target.value || undefined)}
                    className="rounded border border-mc-border bg-mc-bg px-3 py-2 text-sm normal-case tracking-normal text-mc-text outline-none focus:border-mc-accent"
                  >
                    <option value="">{filter.allLabel || `All ${filter.label.toLowerCase()}`}</option>
                    {filter.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-mc-text-secondary">
            <span aria-live="polite">
              {visibleCount === totalCount ? `${totalCount} rows` : `${visibleCount} of ${totalCount} rows`}
            </span>
            {bulkActions.length ? (
              <>
                <span aria-live="polite">
                  {selectedRowsLabel ? selectedRowsLabel(selectedCount, visibleCount) : `${selectedCount} selected`}
                </span>
                {selectedCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => table.resetRowSelection()}
                    className="rounded border border-mc-border px-2 py-1 text-xs hover:bg-mc-bg-tertiary"
                  >
                    Clear selection
                  </button>
                ) : null}
                {bulkActions.map((action) => {
                  const disabled = selectedCount === 0 || pendingAction !== null || (typeof action.disabled === 'function' ? action.disabled(selectedRows) : Boolean(action.disabled));
                  return (
                    <button
                      key={action.label}
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleBulkAction(action)}
                      className={`rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                        action.variant === 'danger'
                          ? 'border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
                          : 'border-mc-border hover:bg-mc-bg-tertiary'
                      }`}
                    >
                      {pendingAction === action.label ? 'Working…' : action.label}
                    </button>
                  );
                })}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-mc-border bg-mc-bg-secondary">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead className="bg-mc-bg-tertiary text-xs uppercase tracking-wide text-mc-text-secondary">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sortState = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    const sortLabel = sortState === 'asc' ? 'ascending' : sortState === 'desc' ? 'descending' : 'none';
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={canSort ? sortLabel : undefined}
                        className={`px-3 py-2 text-left font-medium ${header.column.columnDef.meta?.headerClassName || header.column.columnDef.meta?.className || ''}`}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 text-left uppercase tracking-wide hover:text-mc-text"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIndicator sortState={sortState} />
                            <span className="sr-only">Sort state: {sortLabel}</span>
                          </button>
                        ) : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-mc-border/60">
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-6 text-center text-mc-text-secondary">{empty}</td>
                </tr>
              ) : table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-mc-bg-tertiary/40">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={`px-3 py-2 align-top ${cell.column.columnDef.meta?.className || ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
