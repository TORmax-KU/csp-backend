/* example

const { createConnection } = require("../utils/mongo");
const { ProductSchema } = require("../schemas/ProductModel")
const { SupplierSchema } = require("../schemas/SupplierModel");
const { CategorySchema } = require("../schemas/CategoryModel");

// Create
const create = async (req, res) => {
  try {
    const conn = createConnection();
    const Product = conn.model("Product", ProductSchema);

    const productData = new Product(req.body);
    const savedProduct = await productData.save();

    await conn.close();
    res.status(200).json(savedProduct);
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ error: "Something went wrong while creating product" });
  }
};

// Read (fetch all or search by role_name)
const fetch = async (req, res) => {
  try {
    const conn = createConnection();
    const Product = conn.model("Product", ProductSchema);
    const Supplier = conn.model("Supplier", SupplierSchema);
    const Category = conn.model("Category", CategorySchema);

    const { search, page = 1, limit = 10 } = req.query;

    // Build query
    let query = {};
    if (search) {
      query.product_name = { $regex: search, $options: "i" };
    }

    // Apply pagination
    const products = await Product.find(query)
      .populate("supplier_id") // optional: include supplier details
      .populate("category_id") // optional: include category details
      .skip((page - 1) * Number(limit))
      .limit(Number(limit));

    // Count total matching documents
    const total = await Product.countDocuments(query);

    conn.close();
    res.status(200).json({ products, total });
  } catch (error) {
    console.error("Fetch products error:", error);
    res.status(500).json({ error: "Server error while fetching products" });
  }
};

//query 2
const fetchProductByName = async (req, res) => {
  try {
    const conn = createConnection();
    const Product = conn.model("Product", ProductSchema);

    const { pName } = req.params;
    const products = await Product.find({ "product_name": { $regex: pName, $options: "i" } },
      { _id: 0, product_name: 1, quantity: 1, price: 1 });
    conn.close();

    res.status(200).json(products);

  } catch (error) {
    console.error("Fetch products error:", error);
    res.status(500).json({
      error: "Server error while fetching products",
    });
  }
}

//query 4
const fetchIsLowQuantity = async (req, res) => {
  try {
    const conn = createConnection();
    const Product = conn.model("Product", ProductSchema);

    const amount = Number(req.params.amount);
    const pName = req.params.name;

    const products = await Product.find({
      quantity: { $lte: amount },
      product_name: { $regex: new RegExp(pName, "i") },
    });

    await conn.close();
    return res.status(200).json(products);
  } catch (error) {
    console.error("Fetch products error:", error);
    return res.status(500).json({ error: "Server error while fetching products" });
  }
};


// Update Product
const update = async (req, res) => {
  const conn = createConnection();
  try {
    //hello
    const Product = conn.model("Product", ProductSchema);
    const Supplier = conn.model("Supplier", SupplierSchema);
    const Category = conn.model("Category", CategorySchema);
    const { id } = req.params;

    // Check existence
    const productExist = await Product.findById(id);
    if (!productExist) {
      return res.status(404).json({ message: "Product Not Found" });
    }

    // Update with validation
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    // get 
    const updated_product = await Product.findById(id).populate('supplier_id').populate('category_id')

    return res.status(200).json(updated_product);
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ error: "Something went wrong while updating product" });
  } finally {
    await conn.close();
  }
};

// Delete Product
const deleteProduct = async (req, res) => {
  const conn = createConnection();
  try {
    const Product = conn.model("Product", ProductSchema);
    const { id } = req.params;

    // Check existence
    const productExist = await Product.findById(id);
    if (!productExist) {
      return res.status(404).json({ message: "Product Not Found" });
    }

    // Delete
    await Product.findByIdAndDelete(id);

    // Success response
    return res.status(200).json({ message: "Product Deleted" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ error: "Something went wrong while deleting product" });
  } finally {
    await conn.close();
  }
};


const fetchById = async (req, res) => {
  try {
    const conn = createConnection();
    const Product = conn.model("Product", ProductSchema);
    const { id } = req.params;

    const product = await Product.findById(id);

    await conn.close();
    res.status(200).json(product);
  } catch (error) {
    console.error("Fetch product error:", error);
    res.status(500).json({ error: "Server error while fetching product" });
  }
};

module.exports = { create, fetch, fetchById, update, deleteProduct, fetchProductByName, fetchIsLowQuantity };*/
