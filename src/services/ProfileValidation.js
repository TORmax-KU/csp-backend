// Validate the merged profile, including partial PATCH requests. Mongoose's
// per-field Number validators cannot enforce budget ordering or whole counts.
function validateProfilePatch(input, existing) {
  const errors = {};
  const ranges = {
    minBudget: { min: 0, nullable: true }, maxBudget: { min: 0, nullable: true },
    teamSize: { min: 0, whole: true, nullable: true }, capacity: { min: 0, whole: true, nullable: true },
    yearsInBusiness: { min: 0, max: 200, whole: true }, matchThreshold: { min: 50, max: 95, whole: true },
  };
  for (const [field, rule] of Object.entries(ranges)) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (value === null && rule.nullable) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < rule.min
      || (rule.max !== undefined && value > rule.max) || (rule.whole && !Number.isInteger(value))) {
      errors[field] = `${field} must be ${rule.whole ? "a whole number" : "a number"} from ${rule.min}${rule.max !== undefined ? ` to ${rule.max}` : " or more"}`;
    }
  }
  const min = input.minBudget !== undefined ? input.minBudget : existing.minBudget;
  const max = input.maxBudget !== undefined ? input.maxBudget : existing.maxBudget;
  if (!errors.minBudget && !errors.maxBudget && min != null && max != null && min > max) {
    errors.minBudget = errors.maxBudget = "Minimum budget cannot exceed maximum budget";
  }
  return errors;
}
module.exports = { validateProfilePatch };
