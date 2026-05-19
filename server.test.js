process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.RAZORPAY_KEY_SECRET = "jest-razorpay-secret";

jest.setTimeout(120000);

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app } = require("./server");
const User = require("./models/user");
const Food = require("./models/food");
const Cart = require("./models/cart");
const Order = require("./models/order");

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
});

afterEach(async () => {
    await Promise.all([
        User.deleteMany({}),
        Food.deleteMany({}),
        Cart.deleteMany({}),
        Order.deleteMany({})
    ]);
});

afterAll(async () => {
    await mongoose.connection.close();
    await mongoServer.stop();
});

async function adminToken() {
    const hashedPassword = await bcrypt.hash("adminpass", 10);
    await User.create({
        name: "Admin",
        email: "admin@test.local",
        password: hashedPassword,
        role: "admin"
    });
    const loginRes = await request(app).post("/login").send({
        email: "admin@test.local",
        password: "adminpass"
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body.role).toBe("admin");
    return loginRes.body.token;
}

describe("Backend API", () => {
    it("registers user, logs in, adds cart item, and places order", async () => {
        const signupRes = await request(app).post("/signup").send({
            name: "Divya",
            email: "divya@example.com",
            password: "secret123"
        });
        expect(signupRes.statusCode).toBe(201);

        const loginRes = await request(app).post("/login").send({
            email: "divya@example.com",
            password: "secret123"
        });
        expect(loginRes.statusCode).toBe(200);
        expect(loginRes.body.token).toBeDefined();
        expect(loginRes.body.userId).toBeDefined();
        expect(loginRes.body.name).toBe("Divya");
        expect(loginRes.body.role).toBe("customer");

        const user = await User.findOne({ email: "divya@example.com" });

        const food = await Food.create({
            slug: "paneer-roll",
            name: "Paneer Roll",
            price: 120
        });

        const addCartRes = await request(app).post("/cart/add").send({
            userId: user._id.toString(),
            foodId: food._id.toString(),
            quantity: 2
        });
        expect(addCartRes.statusCode).toBe(200);
        expect(addCartRes.body.cart.items).toHaveLength(1);

        const placeOrderRes = await request(app).post("/orders/place").send({
            userId: user._id.toString(),
            deliveryAddress: {
                fullName: "Divya",
                phone: "9999999999",
                line1: "123 Street",
                city: "Pune",
                state: "Maharashtra",
                pincode: "411001"
            },
            paymentMethod: "COD"
        });
        expect(placeOrderRes.statusCode).toBe(201);
        expect(placeOrderRes.body.order.totalAmount).toBeCloseTo(239.49, 2);
        expect(placeOrderRes.body.order.deliveryAddress.city).toBe("Pune");
        expect(placeOrderRes.body.order.paymentMethod).toBe("COD");
        expect(placeOrderRes.body.order.paymentStatus).toBe("PAID");
        expect(placeOrderRes.body.order.fulfillmentStatus).toBe("RECEIVED");

        const ordersRes = await request(app).get(`/orders/${user._id.toString()}`);
        expect(ordersRes.statusCode).toBe(200);
        expect(ordersRes.body).toHaveLength(1);
    });

    it("places checkout order directly using slug items and address", async () => {
        const signupRes = await request(app).post("/signup").send({
            name: "Asha",
            email: "asha@example.com",
            password: "secret123"
        });
        expect(signupRes.statusCode).toBe(201);

        const user = await User.findOne({ email: "asha@example.com" });

        await Food.create({
            slug: "veg-sandwich",
            name: "Veg Sandwich",
            price: 150
        });

        const checkoutRes = await request(app).post("/orders/checkout").send({
            userId: user._id.toString(),
            items: [{ slug: "veg-sandwich", quantity: 2 }],
            deliveryAddress: {
                fullName: "Asha",
                phone: "8888888888",
                line1: "45 MG Road",
                city: "Mumbai",
                state: "Maharashtra",
                pincode: "400001"
            },
            paymentMethod: "COD"
        });

        expect(checkoutRes.statusCode).toBe(201);
        expect(checkoutRes.body.order.totalAmount).toBeCloseTo(299.49, 2);
        expect(checkoutRes.body.order.deliveryAddress.city).toBe("Mumbai");
        expect(checkoutRes.body.order.paymentMethod).toBe("COD");
        expect(checkoutRes.body.order.paymentStatus).toBe("PAID");

        const profileRes = await request(app).get(`/users/${user._id.toString()}/profile`);
        expect(profileRes.statusCode).toBe(200);
        expect(profileRes.body.user.name).toBe("Asha");
        expect(profileRes.body.deliveryAddress.city).toBe("Mumbai");
    });

    it("rejects Razorpay on the generic checkout endpoint", async () => {
        await request(app).post("/signup").send({
            name: "Raz",
            email: "raz@example.com",
            password: "secret123"
        });
        const user = await User.findOne({ email: "raz@example.com" });
        await Food.create({
            slug: "raz-item",
            name: "Raz Item",
            price: 100
        });

        const checkoutRes = await request(app).post("/orders/checkout").send({
            userId: user._id.toString(),
            items: [{ slug: "raz-item", quantity: 1 }],
            deliveryAddress: {
                fullName: "Raz",
                phone: "7777777777",
                line1: "1 Test Rd",
                city: "Delhi",
                state: "Delhi",
                pincode: "110001"
            },
            paymentMethod: "RAZORPAY"
        });
        expect(checkoutRes.statusCode).toBe(400);
    });

    it("returns 503 from Razorpay create-order when keys are not configured", async () => {
        const backupId = process.env.RAZORPAY_KEY_ID;
        const backupSecret = process.env.RAZORPAY_KEY_SECRET;
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        try {
            await request(app).post("/signup").send({
                name: "NoKey",
                email: "nokey@example.com",
                password: "secret123"
            });
            const user = await User.findOne({ email: "nokey@example.com" });
            await Food.create({ slug: "nk", name: "Nk", price: 50 });
            const res = await request(app).post("/payments/razorpay/create-order").send({
                userId: user._id.toString(),
                items: [{ slug: "nk", quantity: 2 }],
                deliveryAddress: {
                    fullName: "NoKey",
                    phone: "5555555555",
                    line1: "A",
                    city: "B",
                    state: "C",
                    pincode: "400002"
                }
            });
            expect(res.statusCode).toBe(503);
        } finally {
            if (backupId !== undefined) process.env.RAZORPAY_KEY_ID = backupId;
            else delete process.env.RAZORPAY_KEY_ID;
            if (backupSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = backupSecret;
            else delete process.env.RAZORPAY_KEY_SECRET;
        }
    });

    it("rejects invalid Razorpay verify signature", async () => {
        const verifyRes = await request(app).post("/payments/razorpay/verify").send({
            razorpay_order_id: "order_x",
            razorpay_payment_id: "pay_y",
            razorpay_signature: "deadbeef"
        });
        expect(verifyRes.statusCode).toBe(400);
    });

    it("accepts valid Razorpay verify signature for a pending order", async () => {
        await request(app).post("/signup").send({
            name: "Pay",
            email: "pay@example.com",
            password: "secret123"
        });
        const user = await User.findOne({ email: "pay@example.com" });
        const food = await Food.create({
            slug: "pay-item",
            name: "Pay Item",
            price: 200
        });
        const foodId = food._id;

        const razorpayOrderId = "order_verify_jest_1";
        const razorpayPaymentId = "pay_verify_jest_1";
        const signature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpayOrderId}|${razorpayPaymentId}`)
            .digest("hex");

        await Order.create({
            user: user._id,
            items: [{ food: foodId, quantity: 1 }],
            totalAmount: 199.49,
            deliveryAddress: {
                fullName: "Pay",
                phone: "6666666666",
                line1: "2 Lane",
                city: "Chennai",
                state: "TN",
                pincode: "600001"
            },
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            razorpayOrderId
        });

        const verifyRes = await request(app).post("/payments/razorpay/verify").send({
            razorpay_order_id: razorpayOrderId,
            razorpay_payment_id: razorpayPaymentId,
            razorpay_signature: signature
        });
        expect(verifyRes.statusCode).toBe(200);
        expect(verifyRes.body.order.paymentStatus).toBe("PAID");
        expect(verifyRes.body.order.razorpayPaymentId).toBe(razorpayPaymentId);
    });

    it("GET /orders/me and /orders/track require auth and scope to the logged-in user", async () => {
        await request(app).post("/signup").send({
            name: "Tracker",
            email: "track@example.com",
            password: "secret123"
        });
        const loginRes = await request(app).post("/login").send({
            email: "track@example.com",
            password: "secret123"
        });
        const token = loginRes.body.token;
        const user = await User.findOne({ email: "track@example.com" });

        const meNoAuth = await request(app).get("/orders/me");
        expect(meNoAuth.statusCode).toBe(401);

        const meEmpty = await request(app).get("/orders/me").set("Authorization", `Bearer ${token}`);
        expect(meEmpty.statusCode).toBe(200);
        expect(meEmpty.body).toEqual([]);

        const food = await Food.create({ slug: "t1", name: "T1", price: 50 });
        const order = await Order.create({
            user: user._id,
            items: [{ food: food._id, quantity: 1 }],
            totalAmount: 51.49,
            deliveryAddress: {
                fullName: "Tracker",
                phone: "1111111111",
                line1: "A St",
                city: "B",
                state: "C",
                pincode: "111111"
            },
            paymentMethod: "COD",
            paymentStatus: "PAID",
            fulfillmentStatus: "PREPARING"
        });

        const me = await request(app).get("/orders/me").set("Authorization", `Bearer ${token}`);
        expect(me.statusCode).toBe(200);
        expect(me.body).toHaveLength(1);
        expect(me.body[0].fulfillmentStatus).toBe("PREPARING");

        const track = await request(app)
            .get(`/orders/track/${order._id}`)
            .set("Authorization", `Bearer ${token}`);
        expect(track.statusCode).toBe(200);
        expect(String(track.body._id)).toBe(String(order._id));

        await request(app).post("/signup").send({
            name: "Other",
            email: "other@example.com",
            password: "secret123"
        });
        const otherLogin = await request(app).post("/login").send({
            email: "other@example.com",
            password: "secret123"
        });
        const steal = await request(app)
            .get(`/orders/track/${order._id}`)
            .set("Authorization", `Bearer ${otherLogin.body.token}`);
        expect(steal.statusCode).toBe(404);
    });
});

describe("Admin API", () => {
    it("rejects food create without token", async () => {
        const res = await request(app).post("/admin/foods").send({
            slug: "x",
            name: "X",
            price: 1
        });
        expect(res.statusCode).toBe(401);
    });

    it("rejects food create for non-admin", async () => {
        await request(app).post("/signup").send({
            name: "Cust",
            email: "cust@example.com",
            password: "secret123"
        });
        const loginRes = await request(app).post("/login").send({
            email: "cust@example.com",
            password: "secret123"
        });
        const res = await request(app)
            .post("/admin/foods")
            .set("Authorization", `Bearer ${loginRes.body.token}`)
            .send({ slug: "x", name: "X", price: 1 });
        expect(res.statusCode).toBe(403);
    });

    it("allows admin to create, update, delete food and patch order status", async () => {
        const token = await adminToken();

        const createRes = await request(app)
            .post("/admin/foods")
            .set("Authorization", `Bearer ${token}`)
            .send({
                slug: "admin-burger",
                name: "Admin Burger",
                price: 199,
                description: "Test"
            });
        expect(createRes.statusCode).toBe(201);
        const foodId = createRes.body.food._id;

        const putRes = await request(app)
            .put(`/admin/foods/${foodId}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ price: 209 });
        expect(putRes.statusCode).toBe(200);
        expect(putRes.body.food.price).toBe(209);

        await request(app).post("/signup").send({
            name: "Buyer",
            email: "buyer@example.com",
            password: "secret123"
        });
        const buyer = await User.findOne({ email: "buyer@example.com" });
        const order = await Order.create({
            user: buyer._id,
            items: [{ food: foodId, quantity: 1 }],
            totalAmount: 209,
            deliveryAddress: {
                fullName: "Buyer",
                phone: "1111111111",
                line1: "Lane",
                city: "City",
                state: "ST",
                pincode: "111111"
            },
            paymentMethod: "COD",
            paymentStatus: "PAID"
        });

        const ordersRes = await request(app).get("/admin/orders").set("Authorization", `Bearer ${token}`);
        expect(ordersRes.statusCode).toBe(200);
        expect(ordersRes.body.length).toBe(1);

        const patchRes = await request(app)
            .patch(`/admin/orders/${order._id}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ fulfillmentStatus: "PREPARING" });
        expect(patchRes.statusCode).toBe(200);
        expect(patchRes.body.order.fulfillmentStatus).toBe("PREPARING");

        const delRes = await request(app)
            .delete(`/admin/foods/${foodId}`)
            .set("Authorization", `Bearer ${token}`);
        expect(delRes.statusCode).toBe(200);
    });
});
