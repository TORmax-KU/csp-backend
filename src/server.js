require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const passport = require("./config/passport");
const { randomBytes } = require("node:crypto");

const app = express();

const PORT = process.env.PORT || 5001;

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/fullstack_db";

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || (() => {
      if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
      console.warn("Using an ephemeral development session secret; configure SESSION_SECRET for persistent logins.");
      return randomBytes(32).toString("hex");
    })(),
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const projectRoutes = require("./routes/project");
const notificationRoutes = require("./routes/notification");
const adminRoutes = require("./routes/admin");
const skillRoutes = require("./routes/skill");
const { startIngestionScheduler } = require("./services/IngestionScheduler");
const { startTorAnalysisWorker } = require("./services/TorAnalysisWorker");

app.use("/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/skills", skillRoutes);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    startIngestionScheduler();
    startTorAnalysisWorker();
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
  });

app.get("/", (req, res) => {
  res.json({
    message: "Backend is running",
  });
});

app.get("/api/hello", (req, res) => {
  res.json({
    message: "Hello from Express!",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
