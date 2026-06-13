const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const cron = require("node-cron");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());

// =========================
// SAFE DATABASE PATH (FIX RENDER CRASH)
// =========================
const dbPath = path.join(__dirname, "health.db");

// ensure file exists (important for Render)
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, "");
}

// =========================
// DATABASE CONNECTION
// =========================
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.log("❌ DB ERROR:", err.message);
    } else {
        console.log("✅ Database Connected");
    }
});

// =========================
// TABLE INIT (SAFE)
// =========================
db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            message TEXT,
            reminder_date TEXT,
            status TEXT DEFAULT 'pending'
        )
    `);

});

// =========================
// CONFIG
// =========================
const SECRET = "afyaconnect_secret_key";
const PORT = process.env.PORT || 5000;

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

        db.run(
            `INSERT INTO users(name, phone, password) VALUES(?,?,?)`,
            [name, phone, hash],
            function (err) {
                if (err) {
                    return res.status(400).json({
                        success: false,
                        message: "Phone already exists"
                    });
                }

                res.json({
                    success: true,
                    message: "User registered successfully",
                    userId: this.lastID
                });
            }
        );

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// =========================
// LOGIN
// =========================
app.post("/login", (req, res) => {

    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({
            success: false,
            message: "Missing credentials"
        });
    }

    db.get(
        `SELECT * FROM users WHERE phone = ?`,
        [phone],
        async (err, user) => {

            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

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
        }
    );
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

    db.run(
        `INSERT INTO reminders(user_id, type, message, reminder_date)
         VALUES(?,?,?,?)`,
        [req.user.id, type, message, reminder_date],
        function (err) {

            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Failed to create reminder"
                });
            }

            res.json({
                success: true,
                message: "Reminder created",
                id: this.lastID
            });

        }
    );
});

// =========================
// GET REMINDERS
// =========================
app.get("/reminders", verifyToken, (req, res) => {

    db.all(
        `SELECT * FROM reminders WHERE user_id = ? ORDER BY id DESC`,
        [req.user.id],
        (err, rows) => {

            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });
            }

            res.json({
                success: true,
                data: rows
            });

        }
    );
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
// CRON JOB (SAFE PRODUCTION)
// =========================
cron.schedule("* * * * *", () => {

    console.log("🔄 Checking reminders...");

    const today = new Date().toISOString().split("T")[0];

    db.all(
        `SELECT reminders.*, users.phone, users.name
         FROM reminders
         JOIN users ON users.id = reminders.user_id
         WHERE reminder_date = ? AND status = 'pending'`,
        [today],
        (err, rows) => {

            if (err) {
                console.log("Cron DB Error:", err.message);
                return;
            }

            if (!rows || rows.length === 0) return;

            rows.forEach(r => {

                const msg = `Hello ${r.name}, Reminder: ${r.message}`;

                sendSMS(r.phone, msg);

                db.run(
                    `UPDATE reminders SET status = 'sent' WHERE id = ?`,
                    [r.id]
                );
            });
        }
    );
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});