const mongoose = require("mongoose");

const CategoryBenchmarkSchema = new mongoose.Schema({
    category: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    // Quartiles are computed on log10(budget) and stored back in THB.
    medianBudget: {
        type: Number,
        min: 0,
    },
    q1Budget: {
        type: Number,
        min: 0,
    },
    q3Budget: {
        type: Number,
        min: 0,
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
