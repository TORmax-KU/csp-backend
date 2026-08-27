const mongoose = require("mongoose");
const { CategoryBenchmarkSchema } = require("../../schemas/CategoryBenchmarkModel");

module.exports = mongoose.model("CategoryBenchmark", CategoryBenchmarkSchema);
