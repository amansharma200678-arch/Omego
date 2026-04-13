const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

let waitingUser = null;
let onlineUsers = 0;

io.on("connection", (socket) => {

  onlineUsers++;

  io.emit("online-users", onlineUsers);

  function matchUser() {
    if (waitingUser && waitingUser !== socket) {
      socket.partner = waitingUser;
      waitingUser.partner = socket;

      socket.emit("matched", { role: "caller" });
      waitingUser.emit("matched", { role: "receiver" });

      waitingUser = null;
    } else {
      waitingUser = socket;
    }
  }

  socket.on("start", () => {
    matchUser();
  });

  socket.on("next", () => {
    if (socket.partner) {
      socket.partner.emit("partner-left");
      socket.partner.partner = null;
    }

    socket.partner = null;
    matchUser();
  });

  // 💬 CHAT
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

  // 🎥 VIDEO SIGNALING
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

  socket.on("disconnect", () => {

    onlineUsers--;

    io.emit("online-users", onlineUsers);

    if (socket.partner) {
      socket.partner.emit("partner-left");
      socket.partner.partner = null;
    }

    if (waitingUser === socket) {
      waitingUser = null;
    }
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
