const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// =======================
// MIDDLEWARE
// =======================
app.use(express.json());
app.use(express.static(__dirname));

// =======================
// MONGODB CONNECT
// =======================
const MONGO_URL =
  process.env.MONGO_URL ||
  "mongodb://amansharma200678_db_user:omego123@ac-qdgg3sl-shard-00-00.khf2qzc.mongodb.net:27017,ac-qdgg3sl-shard-00-01.khf2qzc.mongodb.net:27017,ac-qdgg3sl-shard-00-02.khf2qzc.mongodb.net:27017/omego?ssl=true&replicaSet=atlas-qbip86-shard-0&authSource=admin&appName=omego";

mongoose
  .connect(MONGO_URL)
  .then(() => console.log("DB connected 🔥"))
  .catch((err) => console.error("MongoDB error:", err));

// =======================
// USER SCHEMA
// =======================
const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    age: { type: Number, required: true },
    email: { type: String, default: "" },
    photo: { type: String, default: "" },
    friends: [{ type: String, default: [] }],
    friendRequests: [{ type: String, default: [] }],
    sentRequests: [{ type: String, default: [] }]
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

// =======================
// HELPERS
// =======================
function cleanUsername(value) {
  return String(value || "").trim();
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(value);
}

async function getUserByUsername(username) {
  return User.findOne({ username: cleanUsername(username) });
}

// =======================
// ROUTES
// =======================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// Check if username is available
app.get("/check-username", async (req, res) => {
  try {
    const u = cleanUsername(req.query.u);

    if (!u) {
      return res.json({ available: false });
    }

    const user = await User.findOne({ username: u });
    res.json({ available: !user });
  } catch (err) {
    console.error("check-username error:", err);
    res.status(500).json({ available: false });
  }
});

// Search user by username
app.get("/search-user", async (req, res) => {
  try {
    const u = cleanUsername(req.query.u);

    if (!u) {
      return res.status(400).json({ success: false, message: "Username required" });
    }

    const user = await User.findOne({ username: u }).select("username age email photo friends");
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error("search-user error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Create user
app.post("/create-user", async (req, res) => {
  try {
    const { username, age, email, photo } = req.body;

    const clean = cleanUsername(username);
    const userAge = Number(age);

    if (!clean || !userAge) {
      return res.json({ success: false, message: "Missing fields" });
    }

    if (!isValidUsername(clean)) {
      return res.json({
        success: false,
        message: "Username 3-20 chars ka hona chahiye aur sirf letters, numbers, _ allowed hai"
      });
    }

    if (!Number.isFinite(userAge) || userAge < 1) {
      return res.json({ success: false, message: "Invalid age" });
    }

    const existing = await User.findOne({ username: clean });
    if (existing) {
      return res.json({ success: false, message: "Username already exists" });
    }

    const user = await User.create({
      username: clean,
      age: userAge,
      email: email || "",
      photo: photo || ""
    });

    res.json({ success: true, user });
  } catch (err) {
    console.error("create-user error:", err);

    if (err.code === 11000) {
      return res.json({ success: false, message: "Username already exists" });
    }

    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get user profile
app.get("/user/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error("get user error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get friend requests
app.get("/friend-requests/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);
    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, requests: user.friendRequests || [] });
  } catch (err) {
    console.error("friend-requests error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get friends list
app.get("/friends/:username", async (req, res) => {
  try {
    const username = cleanUsername(req.params.username);
    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, friends: user.friends || [] });
  } catch (err) {
    console.error("friends error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Backward-compatible add friend (old feature)
app.post("/add-friend", async (req, res) => {
  try {
    const { username, friendUsername } = req.body;

    const userA = cleanUsername(username);
    const userB = cleanUsername(friendUsername);

    if (!userA || !userB) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    if (userA === userB) {
      return res.json({ success: false, message: "Cannot add yourself" });
    }

    const user = await User.findOne({ username: userA });
    const friend = await User.findOne({ username: userB });

    if (!user || !friend) {
      return res.json({ success: false, message: "User not found" });
    }

    await User.updateOne(
      { username: userA },
      {
        $addToSet: {
          friends: userB
        },
        $pull: {
          friendRequests: userB,
          sentRequests: userB
        }
      }
    );

    await User.updateOne(
      { username: userB },
      {
        $addToSet: {
          friends: userA
        },
        $pull: {
          friendRequests: userA,
          sentRequests: userA
        }
      }
    );

    res.json({ success: true, message: "Friend added" });
  } catch (err) {
    console.error("add-friend error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Send friend request
app.post("/send-request", async (req, res) => {
  try {
    const { from, to } = req.body;

    const senderName = cleanUsername(from);
    const receiverName = cleanUsername(to);

    if (!senderName || !receiverName) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    if (senderName === receiverName) {
      return res.json({ success: false, message: "Cannot send request to yourself" });
    }

    const sender = await User.findOne({ username: senderName });
    const receiver = await User.findOne({ username: receiverName });

    if (!sender || !receiver) {
      return res.json({ success: false, message: "User not found" });
    }

    if ((receiver.friends || []).includes(senderName)) {
      return res.json({ success: false, message: "Already friends" });
    }

    if ((receiver.friendRequests || []).includes(senderName)) {
      return res.json({ success: false, message: "Request already sent" });
    }

    await User.updateOne(
      { username: receiverName },
      { $addToSet: { friendRequests: senderName } }
    );

    await User.updateOne(
      { username: senderName },
      { $addToSet: { sentRequests: receiverName } }
    );

    res.json({ success: true, message: "Request sent" });
  } catch (err) {
    console.error("send-request error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Accept friend request
app.post("/accept-request", async (req, res) => {
  try {
    const { from, to } = req.body;

    const senderName = cleanUsername(from);
    const receiverName = cleanUsername(to);

    if (!senderName || !receiverName) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const sender = await User.findOne({ username: senderName });
    const receiver = await User.findOne({ username: receiverName });

    if (!sender || !receiver) {
      return res.json({ success: false, message: "User not found" });
    }

    await User.updateOne(
      { username: receiverName },
      {
        $pull: { friendRequests: senderName },
        $addToSet: { friends: senderName }
      }
    );

    await User.updateOne(
      { username: senderName },
      {
        $pull: { sentRequests: receiverName },
        $addToSet: { friends: receiverName }
      }
    );

    res.json({ success: true, message: "Request accepted" });
  } catch (err) {
    console.error("accept-request error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Reject friend request
app.post("/reject-request", async (req, res) => {
  try {
    const { from, to } = req.body;

    const senderName = cleanUsername(from);
    const receiverName = cleanUsername(to);

    if (!senderName || !receiverName) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    await User.updateOne(
      { username: receiverName },
      { $pull: { friendRequests: senderName } }
    );

    await User.updateOne(
      { username: senderName },
      { $pull: { sentRequests: receiverName } }
    );

    res.json({ success: true, message: "Request rejected" });
  } catch (err) {
    console.error("reject-request error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// =======================
// SOCKET LOGIC
// =======================
let queue = [];
let onlineUsers = 0;
const userSocketMap = new Map(); // username -> socket.id

function removeFromQueue(socket) {
  queue = queue.filter((s) => s.id !== socket.id);
}

function safeEmitPartnerLeft(socket) {
  if (socket.partner) {
    socket.partner.emit("partner-left");
    socket.partner.partner = null;
    socket.partner = null;
  }
}

function matchUser(socket) {
  removeFromQueue(socket);

  if (socket.partner) {
    socket.partner = null;
  }

  while (queue.length > 0) {
    const partner = queue.shift();

    if (!partner || partner.disconnected) continue;
    if (partner.id === socket.id) continue;

    socket.partner = partner;
    partner.partner = socket;

    socket.emit("matched", { role: "caller" });
    partner.emit("matched", { role: "receiver" });
    return;
  }

  queue.push(socket);
}

io.on("connection", (socket) => {
  onlineUsers++;
  io.emit("online-users", onlineUsers);

  socket.on("register-user", (username) => {
    const clean = cleanUsername(username);
    if (!clean) return;
    userSocketMap.set(clean, socket.id);
    socket.username = clean;
  });

  socket.on("start", () => {
    matchUser(socket);
  });

  socket.on("next", () => {
    safeEmitPartnerLeft(socket);
    removeFromQueue(socket);
    matchUser(socket);
  });

  // CHAT
  socket.on("message", (msg) => {
    if (socket.partner) {
      socket.partner.emit("message", msg);
    }
  });

  socket.on("typing", () => {
    if (socket.partner) {
      socket.partner.emit("typing");
    }
  });

  socket.on("stop-typing", () => {
    if (socket.partner) {
      socket.partner.emit("stop-typing");
    }
  });

  // VIDEO SIGNALING
  socket.on("offer", (offer) => {
    if (socket.partner) {
      socket.partner.emit("offer", offer);
    }
  });

  socket.on("answer", (answer) => {
    if (socket.partner) {
      socket.partner.emit("answer", answer);
    }
  });

  socket.on("ice-candidate", (candidate) => {
    if (socket.partner) {
      socket.partner.emit("ice-candidate", candidate);
    }
  });

  // DIRECT CHAT (friend-to-friend)
  socket.on("private-message", ({ to, msg }) => {
    const targetUser = cleanUsername(to);
    const message = String(msg || "").trim();

    if (!targetUser || !message) return;

    const targetSocketId = userSocketMap.get(targetUser);
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("private-message", {
      from: socket.username || "Unknown",
      msg: message
    });
  });

  socket.on("disconnect", () => {
    onlineUsers--;
    if (onlineUsers < 0) onlineUsers = 0;
    io.emit("online-users", onlineUsers);

    removeFromQueue(socket);
    safeEmitPartnerLeft(socket);

    if (socket.username) {
      const currentSocketId = userSocketMap.get(socket.username);
      if (currentSocketId === socket.id) {
        userSocketMap.delete(socket.username);
      }
    }
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});