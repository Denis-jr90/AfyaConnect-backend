const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const cron = require("node-cron");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());

// =========================
// CONFIG
// =========================
const SECRET = "afyaconnect_secret_key";
const PORT = process.env.PORT || 5000;

// =========================
// DATABASE SETUP (RENDER SAFE)
// =========================
const dbPath = path.join(__dirname, "health.db");

if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, "");
}

const db = new Database(dbPath);

console.log("✅ Database Connected");

// =========================
// INIT TABLES
// =========================
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    message TEXT,
    reminder_date TEXT,
    status TEXT DEFAULT 'pending'
);
`);

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
    res.send("🚀 AfyaConnect API Running Successfully");
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
                message: "All fields required"
            });
        }

        const hash = await bcrypt.hash(password, 10);

        const stmt = db.prepare(
            `INSERT INTO users (name, phone, password) VALUES (?, ?, ?)`
        );

        stmt.run(name, phone, hash);

        res.json({
            success: true,
            message: "User registered successfully"
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: "Phone already exists"
        });
    }
});

// =========================
// LOGIN
// =========================
app.post("/login", async (req, res) => {

    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({
            success: false,
            message: "Missing credentials"
        });
    }

    const user = db.prepare(
        `SELECT * FROM users WHERE phone = ?`
    ).get(phone);

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
});

// =========================
// AUTH MIDDLEWARE
// =========================
function verifyToken(req, res, next) {

    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(403).json({
            success: false,
            message: "No token provided"
        });
    }

    try {
        const token = authHeader.split(" ")[1];
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

    if (!type || !message) {
        return res.status(400).json({
            success: false,
            message: "Type & message required"
        });
    }

    const stmt = db.prepare(
        `INSERT INTO reminders (user_id, type, message, reminder_date)
         VALUES (?, ?, ?, ?)`
    );

    stmt.run(req.user.id, type, message, reminder_date);

    res.json({
        success: true,
        message: "Reminder created"
    });
});

// =========================
// GET REMINDERS
// =========================
app.get("/reminders", verifyToken, (req, res) => {

    const reminders = db.prepare(
        `SELECT * FROM reminders WHERE user_id = ? ORDER BY id DESC`
    ).all(req.user.id);

    res.json({
        success: true,
        data: reminders
    });
});

// =========================
// SMS SIMULATION
// =========================
function sendSMS(phone, message) {
    console.log("\n==================================");
    console.log("📩 SMS SENT");
    console.log("TO:", phone);
    console.log("MESSAGE:", message);
    console.log("==================================\n");
}

// =========================
// CRON JOB (AUTO REMINDERS)
// =========================
cron.schedule("* * * * *", () => {

    console.log("🔄 Checking reminders...");

    const today = new Date().toISOString().split("T")[0];

    const rows = db.prepare(
        `SELECT reminders.*, users.phone, users.name
         FROM reminders
         JOIN users ON users.id = reminders.user_id
         WHERE reminder_date = ? AND status = 'pending'`
    ).all(today);

    rows.forEach(r => {

        const msg = `Hello ${r.name}, Reminder: ${r.message}`;

        sendSMS(r.phone, msg);

        db.prepare(
            `UPDATE reminders SET status = 'sent' WHERE id = ?`
        ).run(r.id);
    });
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});