import { getOpenClawStatus } from '@/lib/openclaw/status';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/openclaw/status - Check OpenClaw connection status
export async function GET() {
  return getOpenClawStatus();
}
