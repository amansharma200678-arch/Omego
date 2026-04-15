const socket = io();

let isConnected = false;
let localStream = null;
let peerConnection = null;
let isMuted = false;
let typingTimeout = null;
let isSearching = false;
let iceQueue = [];

// ================================
// LOGIN / PROFILE STATE
// ================================
let currentUser = null;

function syncSocketUser() {
  if (currentUser && socket && socket.connected) {
    socket.emit("register-user", currentUser.username);
  }
}

function applyLoggedInUI() {
  const loginBtn = document.getElementById("loginBtn");
  const profileIcon = document.getElementById("profileIcon");
  const userForm = document.getElementById("userForm");

  if (loginBtn) loginBtn.style.display = "none";

  if (profileIcon && currentUser) {
    profileIcon.style.display = "block";
    profileIcon.src =
      currentUser.photo ||
      "https://ui-avatars.com/api/?name=" +
        encodeURIComponent(currentUser.username || "User") +
        "&background=0ea5e9&color=fff";
    profileIcon.title = `${currentUser.username || "User"} (${currentUser.email || "no email"})`;
  }

  if (userForm) userForm.style.display = "none";

  syncSocketUser();

  if (currentUser) {
    loadRequests().catch((err) => console.error("loadRequests error:", err));
  }
}

function loginWithGoogle() {
  const saved = localStorage.getItem("omego_user");
  if (saved) {
    currentUser = JSON.parse(saved);
    applyLoggedInUI();
    return;
  }

  const loginBtn = document.getElementById("loginBtn");
  const userForm = document.getElementById("userForm");
  const errorBox = document.getElementById("error");

  if (errorBox) errorBox.innerText = "";
  if (userForm) userForm.style.display = "block";
  if (loginBtn) loginBtn.innerText = "Login";
}

async function saveUser() {
  const usernameEl = document.getElementById("username");
  const ageEl = document.getElementById("age");
  const errorBox = document.getElementById("error");

  const username = usernameEl ? usernameEl.value.trim() : "";
  const age = ageEl ? ageEl.value.trim() : "";

  if (errorBox) errorBox.innerText = "";

  if (!username || !age) {
    if (errorBox) errorBox.innerText = "Username aur age dono fill karo ❌";
    return;
  }

  if (username.length < 3) {
    if (errorBox) errorBox.innerText = "Username minimum 3 letters ka hona chahiye ❌";
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    if (errorBox) errorBox.innerText = "Username me sirf letters, numbers aur _ allowed hai ❌";
    return;
  }

  try {
    const res = await fetch("/check-username?u=" + encodeURIComponent(username));
    const data = await res.json();

    if (!data.available) {
      if (errorBox) errorBox.innerText = "Username already exist hai ❌";
      return;
    }

    const fakeUser = {
      email: "user@gmail.com",
      photo:
        "https://ui-avatars.com/api/?name=" +
        encodeURIComponent(username) +
        "&background=0ea5e9&color=fff",
      username,
      age
    };

    const createRes = await fetch("/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fakeUser)
    });

    const createData = await createRes.json();

    if (!createData.success) {
      if (errorBox) errorBox.innerText = createData.message || "User create failed ❌";
      return;
    }

    currentUser = fakeUser;
    localStorage.setItem("omego_user", JSON.stringify(fakeUser));
    applyLoggedInUI();
  } catch (err) {
    console.error(err);
    if (errorBox) errorBox.innerText = "Server error ❌";
  }
}

function isUserLoggedIn() {
  if (currentUser) return true;

  const saved = localStorage.getItem("omego_user");
  if (saved) {
    currentUser = JSON.parse(saved);
    applyLoggedInUI();
    return true;
  }

  return false;
}

// ================================
// CHAT TOGGLE
// ================================
function toggleChat() {
  const chat = document.getElementById("chatBox");
  if (chat) chat.classList.toggle("active");
}

document.addEventListener("click", function (e) {
  const chat = document.getElementById("chatBox");
  const btn = document.querySelector(".chat-float");

  if (chat && btn && !chat.contains(e.target) && !btn.contains(e.target)) {
    chat.classList.remove("active");
  }
});

// ================================
// TYPING
// ================================
const msgInput = document.getElementById("msg");
if (msgInput) {
  msgInput.addEventListener("input", () => {
    if (!isConnected) return;

    socket.emit("typing");
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit("stop-typing");
    }, 800);
  });
}

// ================================
// WEBRTC CONFIG
// ================================
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

function clearRemoteVideo() {
  const video = document.getElementById("userVideo");
  if (video) {
    if (video.srcObject) {
      const tracks = video.srcObject.getTracks();
      tracks.forEach((t) => t.stop());
    }
    video.srcObject = null;
  }
}

function clearLocalVideo() {
  const myVideo = document.getElementById("myVideo");
  if (myVideo) myVideo.srcObject = null;
}

function cleanConnection() {
  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    } catch (err) {
      console.error("peer close error:", err);
    }
    peerConnection = null;
  }

  iceQueue = [];
  clearRemoteVideo();
}

function cleanupLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  clearLocalVideo();
}

async function startVideo() {
  if (localStream) return localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    const myVideo = document.getElementById("myVideo");
    if (myVideo) {
      myVideo.srcObject = localStream;
      myVideo.muted = true;
      myVideo.playsInline = true;
      await myVideo.play();
    }

    return localStream;
  } catch (err) {
    console.error(err);
    alert("Camera / Mic permission denied ❌");
    throw err;
  }
}

function setupPeerConnection() {
  cleanConnection();
  peerConnection = new RTCPeerConnection(config);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;

    if (peerConnection.connectionState === "failed") {
      status("Connection failed ❌");
    }

    if (peerConnection.connectionState === "disconnected") {
      status("Disconnected...");
    }
  };

  peerConnection.ontrack = async (e) => {
    const userVideo = document.getElementById("userVideo");
    if (userVideo) {
      userVideo.srcObject = e.streams[0];
      try {
        await userVideo.play();
      } catch (err) {
        console.error("Remote video play error:", err);
      }
    }
  };

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("ice-candidate", e.candidate);
    }
  };
}

async function flushIceQueue() {
  if (!peerConnection || !peerConnection.remoteDescription) return;

  while (iceQueue.length) {
    const candidate = iceQueue.shift();
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("ICE flush error:", err);
    }
  }
}

// ================================
// START
// ================================
async function start() {
  if (isSearching) return;
  isSearching = true;

  if (!isUserLoggedIn()) {
    alert("Pehle login karo ✅");
    isSearching = false;
    return;
  }

  try {
    await startVideo();
    socket.emit("start");
    status("Searching...");

    const startBtn = document.getElementById("startBtn");
    const nextBtn = document.getElementById("nextBtn");
    if (startBtn) startBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "inline-flex";
  } catch (err) {
    isSearching = false;
  }
}

// ================================
// NEXT
// ================================
function nextUser() {
  isConnected = false;
  isSearching = true;

  cleanConnection();

  const chat = document.getElementById("chat");
  const typing = document.getElementById("typing");
  if (chat) chat.innerHTML = "";
  if (typing) typing.innerText = "";

  socket.emit("next");
  status("Finding new user...");
}

// ================================
// END
// ================================
function endCall() {
  isConnected = false;
  isSearching = false;

  cleanupLocalStream();
  cleanConnection();

  const chat = document.getElementById("chat");
  const typing = document.getElementById("typing");
  if (chat) chat.innerHTML = "";
  if (typing) typing.innerText = "";

  const startBtn = document.getElementById("startBtn");
  const nextBtn = document.getElementById("nextBtn");
  if (startBtn) startBtn.style.display = "inline-flex";
  if (nextBtn) nextBtn.style.display = "none";

  status("Call ended");
}

// ================================
// MUTE
// ================================
function toggleMute() {
  if (!localStream) return;

  isMuted = !isMuted;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) audioTrack.enabled = !isMuted;
}

// ================================
// MESSAGE
// ================================
function sendMsg() {
  const input = document.getElementById("msg");
  const msg = input ? input.value.trim() : "";

  if (!msg || !isConnected) return;

  socket.emit("message", msg);
  addMsg("You", msg);

  if (input) input.value = "";
}

function addMsg(sender, text) {
  const chat = document.getElementById("chat");
  if (!chat) return;

  const div = document.createElement("div");
  div.className = sender === "You" ? "you" : "stranger";
  div.innerText = sender + ": " + text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ================================
// STATUS
// ================================
function status(txt) {
  const el = document.getElementById("status");
  if (el) el.innerText = txt;
}

// ================================
// SEARCH USER
// ================================
async function searchUser() {
  const input = document.getElementById("searchUser");
  const box = document.getElementById("searchResult");
  const username = input ? input.value.trim() : "";

  if (!box) return;

  if (!username) {
    box.innerHTML = "Enter username ❌";
    return;
  }

  try {
    const res = await fetch("/user/" + encodeURIComponent(username));
    const data = await res.json();

    if (!data.success) {
      box.innerHTML = "User not found ❌";
      return;
    }

    box.innerHTML = `
      <div>
        <div>${data.user.username}</div>
        <button onclick="sendRequest('${data.user.username}')">Add</button>
      </div>
    `;
  } catch (err) {
    console.error("searchUser error:", err);
    box.innerHTML = "Server error ❌";
  }
}

// ================================
// SEND REQUEST
// ================================
async function sendRequest(to) {
  if (!currentUser) {
    alert("Login first ✅");
    return;
  }

  try {
    const res = await fetch("/send-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: currentUser.username,
        to
      })
    });

    const data = await res.json();
    alert(data.message || "Request sent ✅");
  } catch (err) {
    console.error("sendRequest error:", err);
    alert("Server error ❌");
  }
}

// ================================
// LOAD REQUESTS
// ================================
async function loadRequests() {
  if (!currentUser) return;

  const box = document.getElementById("requestsBox");
  if (!box) return;

  try {
    const res = await fetch("/friend-requests/" + encodeURIComponent(currentUser.username));
    const data = await res.json();

    const requests = Array.isArray(data.requests) ? data.requests : [];

    if (!requests.length) {
      box.innerHTML = "";
      return;
    }

    box.innerHTML = requests
      .map(
        (r) => `
        <div class="request-item">
          <div>${r}</div>
          <button onclick="acceptRequest('${r}')">Accept</button>
        </div>
      `
      )
      .join("");
  } catch (err) {
    console.error("loadRequests error:", err);
    box.innerHTML = "";
  }
}

// ================================
// ACCEPT REQUEST
// ================================
async function acceptRequest(user) {
  if (!currentUser) return;

  try {
    const res = await fetch("/accept-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: user,
        to: currentUser.username
      })
    });

    const data = await res.json();
    alert(data.message || "Request accepted ✅");
    loadRequests();
  } catch (err) {
    console.error("acceptRequest error:", err);
    alert("Server error ❌");
  }
}

// ================================
// BUTTON EVENTS
// ================================
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const muteBtn = document.getElementById("muteBtn");
const endBtn = document.getElementById("endBtn");
const chatToggle = document.getElementById("chatToggle");
const loginBtn = document.getElementById("loginBtn");

if (startBtn) startBtn.onclick = start;
if (nextBtn) nextBtn.onclick = nextUser;
if (muteBtn) muteBtn.onclick = toggleMute;
if (endBtn) endBtn.onclick = endCall;
if (chatToggle) chatToggle.onclick = toggleChat;
if (loginBtn) loginBtn.onclick = loginWithGoogle;

if (msgInput) {
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && msgInput.value.trim() !== "") {
      sendMsg();
    }
  });
}

// ================================
// SOCKET EVENTS
// ================================
socket.on("connect", () => {
  if (currentUser) {
    syncSocketUser();
  }
});

socket.on("online-users", (count) => {
  const online = document.getElementById("online");
  if (online) online.innerText = "Online: " + count;
});

socket.on("matched", async (data) => {
  try {
    isSearching = false;
    isConnected = true;
    status("Connected ✅");

    await startVideo();
    setupPeerConnection();

    if (data && data.role === "caller") {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit("offer", offer);
    }
  } catch (err) {
    console.error("matched error:", err);
    status("Connection failed ❌");
    isConnected = false;
    isSearching = false;
  }
});

socket.on("offer", async (offer) => {
  try {
    await startVideo();
    setupPeerConnection();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await flushIceQueue();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", answer);
  } catch (err) {
    console.error("offer error:", err);
    status("Connection failed ❌");
  }
});

socket.on("answer", async (answer) => {
  if (!peerConnection) return;

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await flushIceQueue();
  } catch (err) {
    console.error("Answer error:", err);
  }
});

socket.on("ice-candidate", async (c) => {
  if (!c) return;

  try {
    if (peerConnection && peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(c));
    } else {
      iceQueue.push(c);
    }
  } catch (err) {
    console.error("ICE error:", err);
  }
});

socket.on("message", (msg) => addMsg("Stranger", msg));

socket.on("typing", () => {
  const typing = document.getElementById("typing");
  if (typing) typing.innerText = "Stranger is typing...";
});

socket.on("stop-typing", () => {
  const typing = document.getElementById("typing");
  if (typing) typing.innerText = "";
});

socket.on("partner-left", () => {
  isConnected = false;
  isSearching = false;

  cleanConnection();

  const chat = document.getElementById("chat");
  const typing = document.getElementById("typing");
  const msg = document.getElementById("msg");
  const startBtn = document.getElementById("startBtn");
  const nextBtn = document.getElementById("nextBtn");

  if (chat) chat.innerHTML = "";
  if (typing) typing.innerText = "";
  if (msg) msg.value = "";
  if (startBtn) startBtn.style.display = "inline-flex";
  if (nextBtn) nextBtn.style.display = "none";

  status("User left 😢");

  setTimeout(() => {
    socket.emit("next");
    status("🔎 Searching...");
    isSearching = true;
  }, 1000);
});

// ================================
// AUTO-RESTORE LOGIN
// ================================
window.addEventListener("load", () => {
  isUserLoggedIn();
});