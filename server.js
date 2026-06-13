const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");

const app = express();

app.use(cors());
app.use(express.json());

// =========================
// CONFIG
// =========================
const SECRET = "afyaconnect_secret_key";
const PORT = process.env.PORT || 5000;

// =========================
// SAFE DB PATH (IMPORTANT FIX)
// =========================
const dbPath = path.join(__dirname, "db.json");

// =========================
// INIT DB FILE (VERY IMPORTANT FOR RENDER)
// =========================
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({
        users: [],
        reminders: []
    }, null, 2));
}

// =========================
// READ DB (SAFE)
// =========================
function readDB() {
    try {
        const data = fs.readFileSync(dbPath, "utf-8");

        if (!data) {
            return { users: [], reminders: [] };
        }

        return JSON.parse(data);

    } catch (err) {
        return { users: [], reminders: [] };
    }
}

// =========================
// WRITE DB
// =========================
function writeDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "🚀 AfyaConnect Backend Running Successfully"
    });
});

// =========================
// REGISTER
// =========================
app.post("/register", async (req, res) => {

    try {
        const { name, phone, password } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const db = readDB();

        const exists = db.users.find(u => u.phone === phone);

        if (exists) {
            return res.status(400).json({
                success: false,
                message: "Phone already registered"
            });
        }

        const hash = await bcrypt.hash(password, 10);

        const newUser = {
            id: Date.now(),
            name,
            phone,
            password: hash
        };

        db.users.push(newUser);
        writeDB(db);

        res.json({
            success: true,
            message: "User registered successfully"
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// =========================
// LOGIN
// =========================
app.post("/login", async (req, res) => {

    try {
        const { phone, password } = req.body;

        const db = readDB();

        const user = db.users.find(u => u.phone === phone);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const valid = await bcrypt.compare(password, user.password);

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Wrong password"
            });
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, phone: user.phone },
            SECRET,
            { expiresIn: "1d" }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                phone: user.phone
            }
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// =========================
// AUTH MIDDLEWARE
// =========================
function verifyToken(req, res, next) {

    const auth = req.headers["authorization"];

    if (!auth) {
        return res.status(403).json({
            success: false,
            message: "No token provided"
        });
    }

    try {
        const token = auth.split(" ")[1];
        const decoded = jwt.verify(token, SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: "Invalid token"
        });
    }
}

// =========================
// CREATE REMINDER
// =========================
app.post("/reminder", verifyToken, (req, res) => {

    const { type, message, reminder_date } = req.body;

    if (!message) {
        return res.status(400).json({
            success: false,
            message: "Message required"
        });
    }

    const db = readDB();

    const newReminder = {
        id: Date.now(),
        user_id: req.user.id,
        type: type || "general",
        message,
        reminder_date: reminder_date || new Date().toISOString().split("T")[0],
        status: "pending"
    };

    db.reminders.push(newReminder);
    writeDB(db);

    res.json({
        success: true,
        message: "Reminder created successfully"
    });
});

// =========================
// GET REMINDERS
// =========================
app.get("/reminders", verifyToken, (req, res) => {

    const db = readDB();

    const reminders = db.reminders.filter(
        r => String(r.user_id) === String(req.user.id)
    );

    res.json({
        success: true,
        data: reminders
    });
});

// =========================
// SMS SIMULATION
// =========================
function sendSMS(phone, message) {
    console.log("\n======================");
    console.log("📩 SMS SENT");
    console.log("TO:", phone);
    console.log("MESSAGE:", message);
    console.log("======================\n");
}

// =========================
// AUTO REMINDER ENGINE (CRON)
// =========================
cron.schedule("* * * * *", () => {

    const db = readDB();

    const today = new Date().toISOString().split("T")[0];

    db.reminders.forEach(r => {

        if (r.reminder_date === today && r.status === "pending") {

            const user = db.users.find(u => u.id === r.user_id);

            if (user) {
                const msg = `Hello ${user.name}, Reminder: ${r.message}`;
                sendSMS(user.phone, msg);
                r.status = "sent";
            }
        }
    });

    writeDB(db);
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
    console.log(`🚀 AfyaConnect running on port ${PORT}`);
});