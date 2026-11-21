// Defense-in-depth against NoSQL operator injection (ASVS V1.2.4): strips any object key
// that starts with "$" or contains "." from user-controlled input before it can reach a
// Mongoose query (e.g. ?status[$ne]=null, parsed by Express into { status: { $ne: null } }).
// Mutates objects in place rather than reassigning req.query/req.body/req.params, since
// Express 5 exposes those as getter-only properties.
function sanitize(value) {
  if (Array.isArray(value)) {
    value.forEach(sanitize);
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key.startsWith("$") || key.includes(".")) {
        delete value[key];
        continue;
      }
      sanitize(value[key]);
    }
  }
  return value;
}

module.exports = function sanitizeInput(req, res, next) {
  sanitize(req.body);
  sanitize(req.query);
  sanitize(req.params);
  next();
};
