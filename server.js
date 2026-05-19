const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const Razorpay = require("razorpay");
const User = require("./models/user");
const Food = require("./models/food");
const Cart = require("./models/cart");
const Order = require("./models/order");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/foodDB";
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-env";

/** Matches food-ordering-frontend cart totals (delivery + promo discount). */
function pricingFromItemSubtotal(subtotal) {
    const delivery = subtotal > 0 ? 1.49 : 0;
    const discount = subtotal >= 20 ? 2.0 : 0;
    const totalAmount = Math.max(0, subtotal + delivery - discount);
    return { subtotal, delivery, discount, totalAmount };
}

function normalizeCheckoutItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => ({
            slug: item && item.slug ? String(item.slug) : "",
            quantity: Number(item && item.quantity ? item.quantity : 0)
        }))
        .filter((item) => item.slug && item.quantity > 0);
}

async function buildCheckoutFromSlugs(normalizedItems) {
    if (normalizedItems.length === 0) {
        return { error: { status: 400, message: "No valid items found in checkout request" } };
    }

    const foodSlugs = normalizedItems.map((item) => item.slug);
    const foods = await Food.find({ slug: { $in: foodSlugs } });
    const foodBySlug = new Map(foods.map((food) => [food.slug, food]));

    const orderItems = [];
    let itemSubtotal = 0;

    for (const item of normalizedItems) {
        const food = foodBySlug.get(item.slug);
        if (!food) {
            return { error: { status: 404, message: `Food not found for slug: ${item.slug}` } };
        }
        itemSubtotal += Number(food.price) * item.quantity;
        orderItems.push({ food: food._id, quantity: item.quantity });
    }

    const { totalAmount } = pricingFromItemSubtotal(itemSubtotal);
    return { orderItems, totalAmount };
}

function getRazorpayClient() {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) return null;
    return new Razorpay({ key_id, key_secret });
}

function verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature, secret) {
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(signature), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

app.use(cors());
app.use(express.json());

function parseBearerPayload(req) {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    try {
        return jwt.verify(match[1], JWT_SECRET);
    } catch {
        return null;
    }
}

function requireAuth(req, res, next) {
    const payload = parseBearerPayload(req);
    if (!payload || !payload.userId) {
        return res.status(401).json({ message: "Authentication required" });
    }
    req.authUserId = payload.userId;
    next();
}

function requireAdmin(req, res, next) {
    const payload = parseBearerPayload(req);
    if (!payload || !payload.userId) {
        return res.status(401).json({ message: "Authentication required" });
    }
    User.findById(payload.userId)
        .select("role")
        .then((user) => {
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (user.role !== "admin") {
                return res.status(403).json({ message: "Admin access only" });
            }
            req.authUserId = payload.userId;
            next();
        })
        .catch((err) => {
            res.status(500).json({ error: err.message });
        });
}

app.get("/", (req, res) => {
    res.send("EtenRennen Backend Running 🚀");
});

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("MongoDB Connected ✅");
    } catch (err) {
        console.error("MongoDB connection error:", err.message);
        throw err;
    }
}

app.get("/foods", async (req, res) => {
    try {
        const foods = await Food.find().sort({ createdAt: -1 });
        res.json(foods);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/admin/me", requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.authUserId).select("name email role");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/admin/foods", requireAdmin, async (req, res) => {
    try {
        const { slug, name, price, image, description } = req.body;
        if (!slug || !name || typeof price !== "number") {
            return res.status(400).json({ message: "slug, name, and numeric price are required" });
        }

        const food = new Food({ slug, name, price, image, description });
        await food.save();
        res.status(201).json({ message: "Food item added ✅", food });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/admin/foods/:id", requireAdmin, async (req, res) => {
    try {
        const { slug, name, price, image, description } = req.body;
        const food = await Food.findById(req.params.id);
        if (!food) {
            return res.status(404).json({ message: "Food not found" });
        }
        if (slug !== undefined) food.slug = String(slug);
        if (name !== undefined) food.name = String(name);
        if (price !== undefined) {
            if (typeof price !== "number") {
                return res.status(400).json({ message: "price must be a number" });
            }
            food.price = price;
        }
        if (image !== undefined) food.image = image;
        if (description !== undefined) food.description = description;
        await food.save();
        res.json({ message: "Food updated", food });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete("/admin/foods/:id", requireAdmin, async (req, res) => {
    try {
        const food = await Food.findByIdAndDelete(req.params.id);
        if (!food) {
            return res.status(404).json({ message: "Food not found" });
        }
        res.json({ message: "Food deleted", id: food._id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/admin/orders", requireAdmin, async (req, res) => {
    try {
        const orders = await Order.find()
            .populate("user", "name email")
            .populate("items.food")
            .sort({ createdAt: -1 })
            .lean();

        const normalized = orders.map((o) => ({
            ...o,
            fulfillmentStatus: o.fulfillmentStatus || "RECEIVED"
        }));
        res.json(normalized);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const FULFILLMENT_STATUSES = ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

app.patch("/admin/orders/:id", requireAdmin, async (req, res) => {
    try {
        const { fulfillmentStatus } = req.body;
        if (!fulfillmentStatus || !FULFILLMENT_STATUSES.includes(fulfillmentStatus)) {
            return res.status(400).json({ message: "Valid fulfillmentStatus is required" });
        }
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }
        order.fulfillmentStatus = fulfillmentStatus;
        await order.save();
        const populated = await Order.findById(order._id).populate("user", "name email").populate("items.food");
        res.json({ message: "Order updated", order: populated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: "name, email, and password are required" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists ❌" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ name, email, password: hashedPassword });
        await user.save();

        res.status(201).json({ message: "User registered successfully ✅" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "email and password are required" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User not found ❌" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials ❌" });
        }

        const token = jwt.sign(
            { userId: user._id, role: user.role || "customer" },
            JWT_SECRET,
            { expiresIn: "1h" }
        );
        res.json({
            message: "Login successful ✅",
            token,
            userId: user._id,
            name: user.name,
            role: user.role || "customer"
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/users/:userId/profile", async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId).select("name email");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const latestOrder = await Order.findOne({ user: userId }).sort({ createdAt: -1 });
        const deliveryAddress = latestOrder ? latestOrder.deliveryAddress : null;

        res.status(200).json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            },
            deliveryAddress
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/cart/add", async (req, res) => {
    try {
        const { userId, foodId, quantity = 1 } = req.body;
        if (!userId || !foodId || quantity <= 0) {
            return res.status(400).json({ message: "userId, foodId, and positive quantity are required" });
        }

        const food = await Food.findById(foodId);
        if (!food) {
            return res.status(404).json({ message: "Food item not found" });
        }

        let cart = await Cart.findOne({ user: userId });
        if (!cart) {
            cart = new Cart({ user: userId, items: [] });
        }

        const existingItem = cart.items.find((item) => item.food.toString() === foodId);
        if (existingItem) {
            existingItem.quantity += Number(quantity);
        } else {
            cart.items.push({ food: foodId, quantity: Number(quantity) });
        }

        await cart.save();
        const populatedCart = await Cart.findById(cart._id).populate("items.food");
        res.status(200).json({ message: "Cart updated", cart: populatedCart });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/cart/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const cart = await Cart.findOne({ user: userId }).populate("items.food");
        if (!cart) {
            return res.status(200).json({ user: userId, items: [] });
        }
        res.status(200).json(cart);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/orders/place", async (req, res) => {
    try {
        const { userId, deliveryAddress, paymentMethod } = req.body;
        const allowedPaymentMethods = ["COD", "RAZORPAY"];
        if (!userId || !deliveryAddress || !allowedPaymentMethods.includes(paymentMethod)) {
            return res.status(400).json({ message: "userId, deliveryAddress, and valid paymentMethod are required" });
        }

        const cart = await Cart.findOne({ user: userId }).populate("items.food");
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: "Cart is empty" });
        }

        if (paymentMethod === "RAZORPAY") {
            return res.status(400).json({
                message: "Razorpay checkout is only supported from the cart page payment flow."
            });
        }

        const itemSubtotal = cart.items.reduce((sum, item) => {
            const price = item.food && item.food.price ? item.food.price : 0;
            return sum + price * item.quantity;
        }, 0);
        const { totalAmount } = pricingFromItemSubtotal(itemSubtotal);

        const order = new Order({
            user: userId,
            items: cart.items.map((item) => ({ food: item.food._id, quantity: item.quantity })),
            totalAmount,
            deliveryAddress,
            paymentMethod,
            paymentStatus: "PAID"
        });

        await order.save();
        cart.items = [];
        await cart.save();

        const populatedOrder = await Order.findById(order._id).populate("items.food");
        res.status(201).json({ message: "Order placed successfully", order: populatedOrder });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/orders/checkout", async (req, res) => {
    try {
        const { userId, items, deliveryAddress, paymentMethod } = req.body;
        const allowedPaymentMethods = ["COD", "RAZORPAY"];
        if (!userId || !Array.isArray(items) || items.length === 0 || !deliveryAddress || !allowedPaymentMethods.includes(paymentMethod)) {
            return res.status(400).json({ message: "userId, items, deliveryAddress, and valid paymentMethod are required" });
        }

        if (paymentMethod === "RAZORPAY") {
            return res.status(400).json({
                message: "Use Pay with Razorpay on the cart after choosing the Razorpay option."
            });
        }

        const normalized = normalizeCheckoutItems(items);
        const built = await buildCheckoutFromSlugs(normalized);
        if (built.error) {
            return res.status(built.error.status).json({ message: built.error.message });
        }

        const order = new Order({
            user: userId,
            items: built.orderItems,
            totalAmount: built.totalAmount,
            deliveryAddress,
            paymentMethod,
            paymentStatus: "PAID"
        });
        await order.save();

        const populatedOrder = await Order.findById(order._id).populate("items.food");
        res.status(201).json({ message: "Order placed successfully", order: populatedOrder });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/payments/razorpay/create-order", async (req, res) => {
    try {
        const rzp = getRazorpayClient();
        if (!rzp) {
            return res.status(503).json({
                message: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server .env file."
            });
        }

        const { userId, items, deliveryAddress } = req.body;
        if (!userId || !Array.isArray(items) || items.length === 0 || !deliveryAddress) {
            return res.status(400).json({ message: "userId, items, and deliveryAddress are required" });
        }

        const { fullName, phone, line1, city, state, pincode } = deliveryAddress;
        if (!fullName || !phone || !line1 || !city || !state || !pincode) {
            return res.status(400).json({
                message: "deliveryAddress must include fullName, phone, line1, city, state, and pincode"
            });
        }

        const normalized = normalizeCheckoutItems(items);
        const built = await buildCheckoutFromSlugs(normalized);
        if (built.error) {
            return res.status(built.error.status).json({ message: built.error.message });
        }

        const amountPaise = Math.round(built.totalAmount * 100);
        if (amountPaise < 100) {
            return res.status(400).json({ message: "Order total must be at least ₹1.00 for online payment." });
        }

        const order = new Order({
            user: userId,
            items: built.orderItems,
            totalAmount: built.totalAmount,
            deliveryAddress,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING"
        });
        await order.save();

        let rpOrder;
        try {
            rpOrder = await rzp.orders.create({
                amount: amountPaise,
                currency: "INR",
                receipt: order._id.toString().slice(0, 40),
                notes: {
                    dbOrderId: order._id.toString()
                }
            });
        } catch (rzErr) {
            await Order.deleteOne({ _id: order._id });
            console.error("Razorpay order create error:", rzErr);
            return res.status(502).json({
                message: "Could not start payment with Razorpay. Check keys (Test mode) and try again, or use Cash on Delivery."
            });
        }

        order.razorpayOrderId = rpOrder.id;
        await order.save();

        const populatedOrder = await Order.findById(order._id).populate("items.food");
        res.status(201).json({
            message: "Razorpay order created",
            keyId: process.env.RAZORPAY_KEY_ID,
            amount: amountPaise,
            currency: "INR",
            razorpayOrderId: rpOrder.id,
            order: populatedOrder
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/payments/razorpay/verify", async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!secret) {
            return res.status(503).json({ message: "Razorpay is not configured on the server." });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                message: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required"
            });
        }

        const ok = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, secret);
        if (!ok) {
            return res.status(400).json({ message: "Invalid payment signature" });
        }

        const order = await Order.findOne({
            razorpayOrderId: razorpay_order_id,
            paymentStatus: "PENDING"
        });
        if (!order) {
            return res.status(404).json({ message: "Order not found or already completed" });
        }

        order.paymentStatus = "PAID";
        order.razorpayPaymentId = razorpay_payment_id;
        await order.save();

        const populatedOrder = await Order.findById(order._id).populate("items.food");
        res.status(200).json({ message: "Payment verified", order: populatedOrder });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/orders/me", requireAuth, async (req, res) => {
    try {
        const orders = await Order.find({ user: req.authUserId })
            .populate("items.food")
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/orders/track/:orderId", requireAuth, async (req, res) => {
    try {
        const order = await Order.findOne({
            _id: req.params.orderId,
            user: req.authUserId
        })
            .populate("items.food")
            .lean();
        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }
        res.status(200).json(order);
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(400).json({ message: "Invalid order id" });
        }
        res.status(500).json({ error: error.message });
    }
});

app.get("/orders/:userId", async (req, res) => {
    try {
        const orders = await Order.find({ user: req.params.userId }).populate("items.food").sort({ createdAt: -1 });
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

if (process.env.NODE_ENV !== "test") {
    connectDB()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Server running on port ${PORT} 🚀`);
            });
        })
        .catch(() => {
            process.exit(1);
        });
}

module.exports = { app, connectDB };