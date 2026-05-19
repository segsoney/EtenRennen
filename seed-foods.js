require("dotenv").config();
const mongoose = require("mongoose");
const Food = require("./models/food");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/foodDB";

const foods = [
    { slug: "crash-burger", name: "Bandicoot Burger", price: 299, image: "images/food-burger.jpg", description: "Smoky patty burger with signature sauce." },
    { slug: "wumpa-wrap", name: "Wumpa Wrap", price: 189, image: "images/food-wrap.jpg", description: "Fresh wrap with crunchy veggies." },
    { slug: "spin-pizza", name: "Spin-Away Pizza", price: 399, image: "images/food-pizza.jpg", description: "Cheesy pizza with loaded toppings." },
    { slug: "jungle-bowl", name: "Jungle Power Bowl", price: 249, image: "images/food-bowl.jpg", description: "Healthy bowl packed with flavor." },
    { slug: "tropic-tacos", name: "Tropic Tacos", price: 229, image: "images/food-tacos.jpg", description: "Crispy tacos with tangy filling." },
    { slug: "lava-noodles", name: "Lava Noodles", price: 349, image: "images/food-noodles.jpg", description: "Spicy noodles for heat lovers." },
    { slug: "checkpoint-fries", name: "Checkpoint Fries", price: 159, image: "images/food-fries.jpg", description: "Golden fries with seasoning." },
    { slug: "aku-juice", name: "Aku Aku Juice", price: 149, image: "images/food-juice.jpg", description: "Refreshing chilled fruit drink." }
];

async function seedFoods() {
    try {
        await mongoose.connect(MONGO_URI);
        for (const item of foods) {
            await Food.updateOne({ slug: item.slug }, { $set: item }, { upsert: true });
        }
        console.log(`Seeded ${foods.length} food items successfully.`);
    } catch (error) {
        console.error("Food seeding failed:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

seedFoods();
