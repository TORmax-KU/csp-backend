const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    type: {
        type: String,
        enum: ["NewMatch", "StatusChange"],
        required: true,
    },
    read: {
        type: Boolean,
        default: false,
    },
}, {
    collection: "notifications",
    timestamps: true,
});

module.exports = { NotificationSchema };
