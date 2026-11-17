import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'n8n sync history',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
