export function settingsChanged(baseline, current) {
  return baseline != null && Object.keys(baseline).some((key) => baseline[key] !== current[key]);
}
