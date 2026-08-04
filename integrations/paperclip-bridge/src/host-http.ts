import type { PluginContext } from "@paperclipai/plugin-sdk";

export const PAPERCLIP_HOST_SDK_COMMIT = "021ab2f08e07463b038c3d1472f227d2d5f68ca4";

/**
 * Paperclip 021ab2f requires proactive worker HTTP calls to carry company
 * scope so trusted-loopback policy can be resolved. The bridge pins the SDK
 * built from that exact host commit, so this call is compiled and serialized
 * through the real three-argument Worker RPC implementation.
 */
export function scopedHostFetch(
  ctx: Pick<PluginContext, "http">,
  companyId: string,
  url: string,
  init?: RequestInit,
) {
  return ctx.http.fetch(url, init, { companyId });
}
