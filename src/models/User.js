const mongoose = require("mongoose");
const { UserSchema } = require("../../schemas/UserModel");

module.exports = mongoose.model("User", UserSchema);
