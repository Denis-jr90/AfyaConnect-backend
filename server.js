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
const SECRET = process.env.JWT_SECRET || "afyaconnect_secret_key";
const PORT = process.env.PORT || 5000;

// =========================
// DATABASE SETUP (RENDER SAFE)
// =========================
const dbDir = path.join(__dirname, "database");
const dbPath = path.join(dbDir, "db.json");

// auto create DB
function initDB() {
    try {
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, JSON.stringify({
                users: [],
                reminders: []
            }, null, 2));
        }
    } catch (err) {
        console.log("DB INIT ERROR:", err.message);
    }
}
initDB();

// =========================
// SAFE DB READ
// =========================
function readDB() {
    try {
        const raw = fs.readFileSync(dbPath, "utf-8");
        return JSON.parse(raw || '{"users":[],"reminders":[]}');
    } catch (err) {
        console.log("READ DB ERROR:", err.message);
        return { users: [], reminders: [] };
    }
}

// =========================
// SAFE DB WRITE
// =========================
function writeDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.log("WRITE DB ERROR:", err.message);
    }
}

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "🚀 AfyaConnect API running fine"
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
                message: "All fields required"
            });
        }

        const db = readDB();

        const exists = db.users.find(u => u.phone === phone);
        if (exists) {
            return res.status(400).json({
                success: false,
                message: "Phone already exists"
            });
        }

        const hash = await bcrypt.hash(password, 10);

        db.users.push({
            id: Date.now(),
            name,
            phone,
            password: hash
        });

        writeDB(db);

        res.json({
            success: true,
            message: "User registered successfully"
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// =========================
// LOGIN (FIXED STABLE)
// =========================
app.post("/login", async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Missing credentials"
            });
        }

        const db = readDB();

        const user = db.users.find(u => u.phone === phone);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const valid = await bcrypt.compare(password, user.password || "");

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
            message: "Login server error"
        });
    }
});

// =========================
// AUTH MIDDLEWARE
// =========================
function verifyToken(req, res, next) {
    try {
        const auth = req.headers.authorization;

        if (!auth) {
            return res.status(403).json({ success: false, message: "No token" });
        }

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

    const db = readDB();

    db.reminders.push({
        id: Date.now(),
        user_id: req.user.id,
        type,
        message,
        reminder_date,
        status: "pending"
    });

    writeDB(db);

    res.json({ success: true, message: "Reminder created" });
});

// =========================
// GET REMINDERS
// =========================
app.get("/reminders", verifyToken, (req, res) => {
    const db = readDB();

    const data = db.reminders.filter(r => r.user_id === req.user.id);

    res.json({ success: true, data });
});

// =========================
// SMS SIMULATION
// =========================
function sendSMS(phone, message) {
    console.log("📩 SMS TO:", phone);
    console.log(message);
}

// =========================
// CRON JOB SAFE
// =========================
cron.schedule("* * * * *", () => {
    const db = readDB();

    const today = new Date().toISOString().split("T")[0];

    db.reminders.forEach(r => {
        if (r.reminder_date === today && r.status === "pending") {
            const user = db.users.find(u => u.id === r.user_id);

            if (user) {
                sendSMS(user.phone, `Hello ${user.name}: ${r.message}`);
                r.status = "sent";
            }
        }
    });

    writeDB(db);
});

// =========================
// START
// =========================
app.listen(PORT, () => {
    console.log(`🚀 Server running on ${PORT}`);
});