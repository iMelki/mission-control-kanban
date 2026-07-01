'use client';

import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  empty,
  getRowKey,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  empty: string;
  getRowKey?: (row: T, index: number) => string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-mc-border bg-mc-bg-secondary">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-mc-bg-tertiary text-xs uppercase tracking-wide text-mc-text-secondary">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-3 py-2 text-left font-medium ${column.className || ''}`}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-mc-border/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-mc-text-secondary">{empty}</td>
              </tr>
            ) : rows.map((row, index) => (
              <tr key={getRowKey ? getRowKey(row, index) : row.id || String(index)} className="hover:bg-mc-bg-tertiary/40">
                {columns.map((column) => (
                  <td key={column.key} className={`px-3 py-2 align-top ${column.className || ''}`}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
