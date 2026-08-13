import mongoose from "mongoose";

const ProficiencySchema = new mongoose.Schema({
    skill: {
        type: String,
        required: [true, "Skill name is required"],
    },
    level: {
        type: String,
        enum: ["Beginner", "Intermediate", "Advanced", "Expert"],
        required: [true, "Proficiency level is required"],
    },
}, { _id: false });

export const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: [true, "This username already exists"],
        required: [true, "Username is required"],
        trim: true,
    },
    realName: {
        type: String,
        required: [true, "Real name is required"],
        trim: true,
    },
    email: {
        type: String,
        unique: [true, "This email is already in use"],
        required: [true, "Email is required"],
        lowercase: true,
        trim: true,
    },
    passwordHash: {
        type: String,
        required: [true, "Password is required"],
    },
    aboutMe: {
        type: String,
        default: "",
    },
    proficiency: {
        type: [ProficiencySchema],
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
