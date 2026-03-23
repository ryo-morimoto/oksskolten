/**
 * URL tracking parameter removal — ported from fork's url-cleaner.ts (unchanged).
 * Removes 60+ tracking parameters to improve deduplication accuracy.
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "fb_action_ids",
  "fb_action_types",
  "fb_source",
  "fb_ref",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "srsltid",
  "campaign_id",
  "campaign_medium",
  "campaign_name",
  "campaign_source",
  "campaign_term",
  "campaign_content",
  "twclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "mc_tc",
  "hsa_cam",
  "hsa_grp",
  "hsa_mt",
  "hsa_src",
  "hsa_ad",
  "hsa_acc",
  "hsa_net",
  "hsa_ver",
  "hsa_la",
  "hsa_ol",
  "hsa_kw",
  "hsa_tgt",
  "_hsenc",
  "_hsmi",
  "__hssc",
  "__hstc",
  "__hsfp",
  "_bhlid",
  "mkt_tok",
  "vero_id",
  "vero_conv",
  "yclid",
  "ysclid",
  "sc_cid",
  "ref_src",
  "ref_url",
  "_openstat",
  "ns_source",
  "ns_campaign",
  "ns_mchannel",
  "ns_linkname",
  "ns_fee",
  "igshid",
  "si",
]);

const TRACKING_PREFIXES = ["utm_", "mtm_"];

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PREFIXES.some((p) => lower.startsWith(p));
}

export function cleanUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const keysToDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (isTrackingParam(key)) keysToDelete.push(key);
  }

  if (keysToDelete.length === 0) return rawUrl;
  for (const key of keysToDelete) url.searchParams.delete(key);
  return url.toString();
}
