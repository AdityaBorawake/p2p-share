const socket = io()

let peer
let channel
let connected = false
let currentRoom = ""

let fileBuffer = []
let fileSize = 0
let received = 0

/* ===== AUTO JOIN ===== */

window.onload = () => {
  if (location.hash) {
    const room = location.hash.substring(1)
    document.getElementById("roomInput").value = room
    joinRoom()
    scrollToApp()
  }
  setupDragDrop()
}

function scrollToApp() {
  document.getElementById("appSection").scrollIntoView({ behavior: "smooth" })
}

/* ===== ROOM ===== */

function createRoom() {
  const room = Math.random().toString(36).substr(2, 6)
  currentRoom = room
  socket.emit("join-room", room)
  document.getElementById("roomDisplay").innerText = room
  document.getElementById("roomInput").value = room

  // Show QR area
  const qrArea = document.getElementById("qr-area")
  qrArea.style.display = "block"
  generateQR(room)
  startPeer(true)
}

function joinRoom() {
  const room = document.getElementById("roomInput").value.trim()
  if (!room) return
  currentRoom = room
  socket.emit("join-room", room)
  startPeer(false)
}

/* ===== SIGNALING ===== */

socket.on("peer-joined", () => createOffer())

socket.on("signal", async data => {
  if (data.offer) {
    await peer.setRemoteDescription(data.offer)
    const ans = await peer.createAnswer()
    await peer.setLocalDescription(ans)
    socket.emit("signal", { answer: ans })
  }
  if (data.answer) await peer.setRemoteDescription(data.answer)
  if (data.candidate) {
    try { await peer.addIceCandidate(data.candidate) } catch {}
  }
})

/* ===== WEBRTC ===== */

function startPeer(isCreator) {
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" }
    ],
    iceCandidatePoolSize: 10
  })

  peer.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { candidate: e.candidate })
  }

  peer.onconnectionstatechange = connectionUI

  if (isCreator) {
    // Use ordered:false + larger buffer for max speed
    channel = peer.createDataChannel("file", {
      ordered: true,
      maxRetransmits: 30
    })
    setupChannel()
  } else {
    peer.ondatachannel = e => {
      channel = e.channel
      setupChannel()
    }
  }
}

function connectionUI() {
  const s = peer.connectionState
  const status = document.getElementById("connectionStatus")
  const retry = document.getElementById("retryBtn")

  status.className = "conn-status"

  if (s === "connected") {
    connected = true
    status.innerText = "🟢 Connected"
    status.classList.add("connected")
    retry.style.display = "none"
    showRoomUI()
  }

  if (s === "connecting") {
    status.innerText = "🔄 Connecting..."
  }

  if (s === "failed" || s === "disconnected") {
    status.innerText = "🔴 Connection Failed"
    status.classList.add("failed")
    retry.style.display = "block"
    connected = false
  }
}

function retryConnection() {
  if (peer) peer.restartIce()
}

function showRoomUI() {
  document.getElementById("roomSetup").style.display = "none"
  document.getElementById("roomCard").style.display = "block"
}

/* ===== DATA CHANNEL ===== */

function setupChannel() {
  channel.binaryType = "arraybuffer"
  // Increase buffer threshold for faster sending
  channel.bufferedAmountLowThreshold = 256 * 1024

  channel.onmessage = e => {
    if (typeof e.data === "string") {
      const msg = JSON.parse(e.data)

      if (msg.type === "meta") {
        fileBuffer = []
        received = 0
        fileSize = msg.size
        // Show receive section
        const recvSection = document.getElementById("receiveSection")
        recvSection.style.display = "block"
        document.getElementById("incomingName").innerText = "Receiving: " + msg.name
        document.getElementById("recvProgressBar").style.width = "0%"
        document.getElementById("download").style.display = "none"
      }

      if (msg.type === "done") {
        const blob = new Blob(fileBuffer)
        const url = URL.createObjectURL(blob)
        const a = document.getElementById("download")
        a.href = url
        a.download = msg.name
        a.innerText = "⬇ Download " + msg.name
        a.style.display = "inline-flex"
        document.getElementById("incomingName").innerText = "✅ Transfer complete — " + msg.name
        document.getElementById("recvProgressBar").style.width = "100%"
      }

      if (msg.type === "chat") {
        addChat(msg.text, "peer")
      }

    } else {
      fileBuffer.push(e.data)
      received += e.data.byteLength
      const percent = Math.min((received / fileSize) * 100, 100)
      document.getElementById("recvProgressBar").style.width = percent + "%"
    }
  }
}

/* ===== DRAG & DROP ===== */

function setupDragDrop() {
  const zone = document.getElementById("dropZone")
  if (!zone) return

  zone.addEventListener("dragover", e => {
    e.preventDefault()
    zone.classList.add("dragover")
  })
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"))
  zone.addEventListener("drop", e => {
    e.preventDefault()
    zone.classList.remove("dragover")
    const file = e.dataTransfer.files[0]
    if (file) {
      const dt = new DataTransfer()
      dt.items.add(file)
      document.getElementById("fileInput").files = dt.files
      onFileSelected()
    }
  })
}

function onFileSelected() {
  const file = document.getElementById("fileInput").files[0]
  if (!file) return
  document.getElementById("selectedFileName").innerText = file.name + " (" + formatSize(file.size) + ")"
  document.getElementById("sendBtn").style.display = "flex"
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB"
}

/* ===== SEND FILE ===== */

async function selectFiles() {
  if (!connected) return

  const file = document.getElementById("fileInput").files[0]
  if (!file) return

  const CHUNK = 256 * 1024  // 256KB chunks
  let offset = 0
  let sent = 0

  // Show send progress
  const wrap = document.getElementById("sendProgressWrap")
  const bar = document.getElementById("sendProgressBar")
  const pct = document.getElementById("sendPercent")
  wrap.style.display = "block"
  bar.style.width = "0%"
  document.getElementById("sendBtn").style.display = "none"

  channel.send(JSON.stringify({
    type: "meta",
    name: file.name,
    size: file.size
  }))

  const reader = new FileReader()

  reader.onload = async e => {
    // Wait if buffer is filling up (backpressure)
    while (channel.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise(r => setTimeout(r, 20))
    }

    channel.send(e.target.result)
    sent += e.target.result.byteLength
    offset += e.target.result.byteLength

    const percent = Math.min((sent / file.size) * 100, 100)
    bar.style.width = percent + "%"
    pct.innerText = Math.round(percent) + "%"

    if (offset < file.size) {
      readSlice(offset)
    } else {
      channel.send(JSON.stringify({ type: "done", name: file.name }))
      pct.innerText = "Done ✓"
    }
  }

  function readSlice(o) {
    reader.readAsArrayBuffer(file.slice(o, o + CHUNK))
  }

  readSlice(0)
}

/* ===== CHAT ===== */

function sendChat() {
  const input = document.getElementById("chatInput")
  const text = input.value.trim()
  if (!text || !connected) return
  channel.send(JSON.stringify({ type: "chat", text }))
  addChat(text, "me")
  input.value = ""
}

function addChat(text, who) {
  const div = document.createElement("div")
  div.className = "chatMsg " + who
  div.innerText = text
  const box = document.getElementById("chatMessages")
  box.appendChild(div)
  box.scrollTop = box.scrollHeight
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("chatInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  })
})

/* ===== QR ===== */

function generateQR(room) {
  QRCode.toCanvas(
    document.getElementById("qrCanvas"),
    location.origin + "/#" + room,
    { width: 160, margin: 1 }
  )
}

/* ===== OFFER ===== */

async function createOffer() {
  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  socket.emit("signal", { offer })
}

/* ===== LEAVE ROOM ===== */

function leaveRoom() {
  try { if (channel) channel.close() } catch {}
  try { if (peer) peer.close() } catch {}

  connected = false
  currentRoom = ""

  document.getElementById("roomCard").style.display = "none"
  document.getElementById("roomSetup").style.display = "block"
  document.getElementById("qr-area").style.display = "none"
  document.getElementById("roomInput").value = ""
  document.getElementById("roomDisplay").innerText = ""
  document.getElementById("recvProgressBar").style.width = "0%"
  document.getElementById("sendProgressBar").style.width = "0%"
  document.getElementById("sendProgressWrap").style.display = "none"
  document.getElementById("sendBtn").style.display = "none"
  document.getElementById("selectedFileName").innerText = ""
  document.getElementById("chatMessages").innerHTML = ""
  document.getElementById("incomingName").innerText = ""
  document.getElementById("receiveSection").style.display = "none"
  document.getElementById("download").style.display = "none"
  document.getElementById("fileInput").value = ""
}
