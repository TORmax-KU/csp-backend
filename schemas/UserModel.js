const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
    googleId: {
        type: String,
        unique: true,
        sparse: true,
    },
    username: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
    },
    realName: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        unique: [true, "This email is already in use"],
        required: [true, "Email is required"],
        lowercase: true,
        trim: true,
    },
    aboutMe: {
        type: String,
        default: "",
    },
    proficiency: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: "Skill",
        default: [],
    },
    associations: {
        type: [String],
        default: [],
    },
}, {
    collection: "users",
    timestamps: true,
});

module.exports = { UserSchema };
