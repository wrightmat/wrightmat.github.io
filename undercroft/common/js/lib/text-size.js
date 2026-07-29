// Shared text-size scale + pt/px conversion — used by both Press's and
// Workbench's Text Size / Font Size (pt) inspector controls, so the two
// tools' size steps stay numerically identical instead of each keeping a
// separately-maintained copy (Workbench's own pre-existing rem values
// already matched these exactly at the standard 16px root — this just
// makes that a real shared constant instead of a coincidence).
export const TEXT_SIZE_PX = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export function pxToPt(value) {
  if (!Number.isFinite(value)) return "";
  return (value * 0.75).toFixed(1).replace(/\.0$/, "");
}

export function ptToPx(value) {
  if (!Number.isFinite(value)) return null;
  return value * (4 / 3);
}
