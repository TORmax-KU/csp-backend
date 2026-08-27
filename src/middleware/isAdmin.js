const isAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
  if (req.user.role !== "Admin") return res.status(403).json({ message: "Admin access required" });
  next();
};

module.exports = isAdmin;
