import mongoose from "mongoose";

export const UserSchema = new mongoose.Schema({
    user_name: {
        type: String,
        unique:[true, "This username has already existed"],
        required: [true, "Username name is required"],
    },
    
}, { collection: "users" });