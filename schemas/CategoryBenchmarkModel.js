const mongoose = require("mongoose");

const CategoryBenchmarkSchema = new mongoose.Schema({
    category: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    avgBudget: {
        type: Number,
        min: 0,
    },
    minBudget: {
        type: Number,
        min: 0,
    },
    maxBudget: {
        type: Number,
        min: 0,
    },
    sampleSize: {
        type: Number,
        default: 0,
    },
}, {
    collection: "category_benchmarks",
    timestamps: true,
});

module.exports = { CategoryBenchmarkSchema };
