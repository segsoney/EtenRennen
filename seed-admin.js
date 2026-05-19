require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("./models/user");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/foodDB";
const email = process.env.ADMIN_EMAIL || "admin@etenrennen.local";
const password = process.env.ADMIN_PASSWORD || "ChangeMeAdmin!";
const name = process.env.ADMIN_NAME || "Admin";

async function seedAdmin() {
    try {
        await mongoose.connect(MONGO_URI);
        const hashedPassword = await bcrypt.hash(password, 10);
        let user = await User.findOne({ email });
        if (user) {
            user.name = name;
            user.password = hashedPassword;
            user.role = "admin";
            await user.save();
            console.log(`Updated existing user to admin: ${email}`);
        } else {
            user = await User.create({
                name,
                email,
                password: hashedPassword,
                role: "admin"
            });
            console.log(`Created admin user: ${email}`);
        }
        console.log("Log in on the site with this email and password, then open admin.html.");
    } catch (error) {
        console.error("Admin seed failed:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

seedAdmin();
