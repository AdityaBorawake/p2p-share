const socket = io()
let peer
let channel
let connected = false
let currentRoom = ""
let fileBuffer = []
let fileSize = 0
let received = 0
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
function createRoom() {
  const room = Math.random().toString(36).substr(2, 6)
  currentRoom = room
  socket.emit("join-room", room)
  document.getElementById("roomDisplay").innerText = room
  document.getElementById("roomInput").value = room
  
  document.getElementById("joinBtn").style.display = "none"
  document.getElementById("createBtn").style.display = "none"
  document.getElementById("roomInput").disabled = true
  
  const qrArea = document.getElementById("qr-area")
  qrArea.style.display = "block"
  generateQR(room)
  startPeer(true)
}
function joinRoom() {
  const room = document.getElementById("roomInput").value.trim()
  if (!room) return
  
  if (room === currentRoom) {
    alert("You created this room — share the link with someone else to connect!")
    return
  }
  currentRoom = room
  socket.emit("join-room", room)
  startPeer(false)
}
socket.on("peer-joined", () => createOffer())
socket.on("peer-left", () => {
  alert("The other person has left. The room has ended.")
  leaveRoom()
})
let retryCount = 0
const MAX_RETRIES = 3
let iceTimeout = null
let ipv4OnlyMode = false
let fallbackTimer = null
let localIP = null

async function getLocalIP() {
  return new Promise(resolve => {
    const pc = new RTCPeerConnection({ iceServers: [] })
    pc.createDataChannel("")
    pc.createOffer().then(o => pc.setLocalDescription(o))
    pc.onicecandidate = e => {
      if (!e.candidate) { pc.close(); resolve(null); return }
      const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/)
      if (m && !m[1].startsWith("127.")) { pc.close(); resolve(m[1]) }
    }
    setTimeout(() => { pc.close(); resolve(null) }, 1500)
  })
}

function sameSubnet(a, b) {
  if (!a || !b) return false
  return a.split(".").slice(0, 3).join(".") === b.split(".").slice(0, 3).join(".")
}

socket.on("peer-ip", async (theirIP) => {
  if (!localIP) localIP = await getLocalIP()
  if (sameSubnet(localIP, theirIP)) {
    ipv4OnlyMode = true
    document.getElementById("connectionStatus").innerText = "🔄 Local network detected, optimising..."
    fallbackTimer = setTimeout(() => {
      if (!connected) {
        ipv4OnlyMode = false
        document.getElementById("connectionStatus").innerText = "🔄 Trying standard connection..."
        if (peer) peer.restartIce()
      }
    }, 5000)
  }
})

function startPeer(isCreator) {
  socket.off("signal")
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
  })
  peer.onicegatheringstatechange = () => {
    if (peer.iceGatheringState === "gathering") {
      if (iceTimeout) clearTimeout(iceTimeout)
      iceTimeout = setTimeout(() => {
        const status = document.getElementById("connectionStatus")
        if (!connected) status.innerText = "⏳ Still trying to connect..."
      }, 15000)
    }
    if (peer.iceGatheringState === "complete") {
      if (iceTimeout) clearTimeout(iceTimeout)
    }
  }
  peer.onicecandidate = e => {
    if (!e.candidate) return
    if (ipv4OnlyMode && e.candidate.candidate.includes(":")) return
    socket.emit("signal", { candidate: e.candidate })
  }
  peer.onconnectionstatechange = connectionUI
  if (isCreator) {
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
  socket.on("signal", async data => {
    if (!peer) return
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
}
function connectionUI() {
  const s = peer.connectionState
  const status = document.getElementById("connectionStatus")
  const retry = document.getElementById("retryBtn")
  status.className = "conn-status"
  if (s === "connected") {
    connected = true
    retryCount = 0
    if (iceTimeout) clearTimeout(iceTimeout)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    status.innerText = "🟢 Connected"
    status.classList.add("connected")
    retry.style.display = "none"
    clearInterval(retryInterval)
    showRoomUI()
  }
  if (s === "connecting") {
    status.innerText = "🔄 Connecting..."
  }
  if (s === "failed" || s === "disconnected") {
    connected = false
    status.classList.add("failed")
    if (retryCount < MAX_RETRIES) {
      
      retryCount++
      let countdown = 5
      status.innerText = `⚠️ Connection lost — retrying in ${countdown}s (${retryCount}/${MAX_RETRIES})`
      retry.style.display = "none"
      retryInterval = setInterval(() => {
        countdown--
        if (countdown <= 0) {
          clearInterval(retryInterval)
          status.innerText = "🔄 Retrying..."
          if (peer) peer.restartIce()
        } else {
          status.innerText = `⚠️ Connection lost — retrying in ${countdown}s (${retryCount}/${MAX_RETRIES})`
        }
      }, 1000)
    } else {
      
      clearInterval(retryInterval)
      status.innerText = "🔴 Connection Failed"
      status.classList.add("failed")
      retry.style.display = "block"
      document.getElementById("connectionTip").innerHTML =
        `<p class="conn-tip">Tips: make sure both devices are online, try disabling VPN, or ask the other person to rejoin on a different network.</p>`
    }
  }
}
let retryInterval = null
function retryConnection() {
  retryCount = 0
  clearInterval(retryInterval)
  document.getElementById("connectionTip").innerHTML = ""
  document.getElementById("retryBtn").style.display = "none"
  if (peer) peer.restartIce()
}
function showRoomUI() {
  document.getElementById("roomSetup").style.display = "none"
  document.getElementById("roomCard").style.display = "block"
}
let recvStartTime = 0
let recvLastTime = 0
let recvLastBytes = 0
let recvStatsInterval = null
function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + " B/s"
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + " KB/s"
  return (bytesPerSec / (1024 * 1024)).toFixed(2) + " MB/s"
}
function formatETA(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "calculating..."
  if (seconds < 60) return Math.ceil(seconds) + "s"
  if (seconds < 3600) return Math.floor(seconds / 60) + "m " + (Math.ceil(seconds) % 60) + "s"
  return Math.floor(seconds / 3600) + "h " + Math.floor((seconds % 3600) / 60) + "m"
}
function setupChannel() {
  channel.binaryType = "arraybuffer"
  channel.bufferedAmountLowThreshold = 512 * 1024
  channel.onmessage = e => {
    if (typeof e.data === "string") {
      const msg = JSON.parse(e.data)
      if (msg.type === "meta") {
        fileBuffer = []
        received = 0
        fileSize = msg.size
        recvStartTime = Date.now()
        recvLastTime = recvStartTime
        recvLastBytes = 0
        const recvSection = document.getElementById("receiveSection")
        recvSection.style.display = "block"
        document.getElementById("incomingName").innerText = "📥 " + msg.name
        document.getElementById("recvProgressBar").style.width = "0%"
        document.getElementById("recvPercent").innerText = "0%"
        document.getElementById("recvStatsRow").style.display = "flex"
        
        clearInterval(recvStatsInterval)
        recvStatsInterval = setInterval(() => {
          if (received === 0 || fileSize === 0) return
          const now = Date.now()
          const elapsed = (now - recvStartTime) / 1000
          const windowElapsed = (now - recvLastTime) / 1000
          const windowBytes = received - recvLastBytes
          
          const speed = windowElapsed > 0 ? windowBytes / windowElapsed : 0
          const remaining = fileSize - received
          const eta = speed > 0 ? remaining / speed : Infinity
          document.getElementById("recvSpeed").innerText = formatSpeed(speed)
          document.getElementById("recvETA").innerText = "ETA: " + formatETA(eta)
          recvLastTime = now
          recvLastBytes = received
        }, 800)
      }
      if (msg.type === "done") {
        clearInterval(recvStatsInterval)
        const blob = new Blob(fileBuffer)
        const url = URL.createObjectURL(blob)
        
        const elapsed = (Date.now() - recvStartTime) / 1000
        const avgSpeed = elapsed > 0 ? fileSize / elapsed : 0
        const downloads = document.getElementById("downloadList")
        const a = document.createElement("a")
        a.href = url
        a.download = msg.name
        a.innerText = "⬇ " + msg.name
        a.className = "btn-download"
        a.style.display = "inline-flex"
        downloads.appendChild(a)
        document.getElementById("incomingName").innerText = "✅ " + msg.name
        document.getElementById("recvProgressBar").style.width = "100%"
        document.getElementById("recvPercent").innerText = "100%"
        document.getElementById("recvSpeed").innerText = formatSpeed(avgSpeed)
        document.getElementById("recvETA").innerText = "Done ✓"
      }
      if (msg.type === "cancel") {
        clearInterval(recvStatsInterval)
        document.getElementById("incomingName").innerText = "⚠️ Sender cancelled the transfer"
        document.getElementById("recvProgressBar").style.width = "0%"
        document.getElementById("recvPercent").innerText = ""
        document.getElementById("recvStats").innerText = ""
        document.getElementById("recvStatsRow").style.display = "none"
        fileBuffer = []
        received = 0
      }
      if (msg.type === "chat") {
        addChat(msg.text, "peer")
      }
    } else {
      fileBuffer.push(e.data)
      received += e.data.byteLength
      const percent = Math.min((received / fileSize) * 100, 100)
      document.getElementById("recvProgressBar").style.width = percent + "%"
      document.getElementById("recvPercent").innerText = Math.round(percent) + "%"
    }
  }
}
let fileQueue = []       
let isSending = false    
let cancelRequested = false  
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB"
}
function renderQueue() {
  const list = document.getElementById("queueList")
  const empty = document.getElementById("queueEmpty")
  const stats = document.getElementById("queueStats")
  if (!list) return
  list.innerHTML = ""
  if (fileQueue.length === 0) {
    empty.style.display = "block"
    stats.style.display = "none"
  } else {
    empty.style.display = "none"
    const totalSize = fileQueue.reduce((s, f) => s + f.size, 0)
    stats.style.display = "block"
    stats.innerText = `${fileQueue.length} file${fileQueue.length > 1 ? "s" : ""} · ${formatSize(totalSize)} total`
    fileQueue.forEach((file, i) => {
      const isActive = i === 0 && isSending
      const item = document.createElement("div")
      item.className = "queue-item" + (isActive ? " sending" : "")
      item.innerHTML = `
        <span class="queue-icon">${isActive ? "📤" : "⏳"}</span>
        <div class="queue-info">
          <span class="queue-name" title="${file.name}">${file.name}</span>
          <span class="queue-size">${formatSize(file.size)}</span>
        </div>
        ${!isActive ? `<button class="queue-remove" title="Remove" onclick="removeFromQueue(${i})">✕</button>` : ""}
      `
      list.appendChild(item)
    })
  }
  
  document.getElementById("sendBtn").style.display =
    fileQueue.length > 0 && connected && !isSending ? "flex" : "none"
  
  document.getElementById("cancelBtn").style.display =
    isSending ? "flex" : "none"
}
function removeFromQueue(index) {
  fileQueue.splice(index, 1)
  renderQueue()
}
function cancelTransfer() {
  cancelRequested = true
  isSending = false
  fileQueue = []
  renderQueue()
  
  document.getElementById("sendProgressWrap").style.display = "none"
  document.getElementById("sendProgressBar").style.width = "0%"
  document.getElementById("sendPercent").innerText = "0%"
  document.getElementById("sendProgressLabel").innerText = "Sending..."
  
  try { channel.send(JSON.stringify({ type: "cancel" })) } catch {}
}
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
    const files = Array.from(e.dataTransfer.files)
    files.forEach(f => fileQueue.push(f))
    renderQueue()
  })
}
function onFileSelected() {
  const files = Array.from(document.getElementById("fileInput").files)
  files.forEach(f => fileQueue.push(f))
  document.getElementById("fileInput").value = "" 
  renderQueue()
}
function selectFiles() {
  if (!connected || isSending || fileQueue.length === 0) return
  cancelRequested = false
  processQueue()
}
async function processQueue() {
  if (cancelRequested || fileQueue.length === 0) {
    isSending = false
    cancelRequested = false
    renderQueue()
    if (fileQueue.length === 0) {
      document.getElementById("sendProgressWrap").style.display = "none"
    }
    return
  }
  isSending = true
  renderQueue()
  const file = fileQueue[0]
  const CHUNK = 256 * 1024
  let offset = 0
  let sent = 0
  let sendStartTime = Date.now()
  let lastStatTime = sendStartTime
  let lastStatBytes = 0
  const wrap = document.getElementById("sendProgressWrap")
  const bar = document.getElementById("sendProgressBar")
  const pct = document.getElementById("sendPercent")
  const label = document.getElementById("sendProgressLabel")
  const speedEl = document.getElementById("sendSpeed")
  const etaEl = document.getElementById("sendETA")
  wrap.style.display = "block"
  bar.style.width = "0%"
  pct.innerText = "0%"
  if (label) label.innerText = file.name
  if (speedEl) speedEl.innerText = "—"
  if (etaEl) etaEl.innerText = "calculating..."
  channel.send(JSON.stringify({ type: "meta", name: file.name, size: file.size }))
  while (offset < file.size) {
    if (cancelRequested) break
    while (channel.bufferedAmount > 1024 * 1024) {
      if (cancelRequested) break
      await new Promise(r => setTimeout(r, 10))
    }
    if (cancelRequested) break
    const slice = file.slice(offset, offset + CHUNK)
    const buf = await slice.arrayBuffer()
    channel.send(buf)
    sent += buf.byteLength
    offset += buf.byteLength
    const now = Date.now()
    if (now - lastStatTime >= 600) {
      const windowSec = (now - lastStatTime) / 1000
      const windowBytes = sent - lastStatBytes
      const speed = windowSec > 0 ? windowBytes / windowSec : 0
      const eta = speed > 0 ? (file.size - sent) / speed : Infinity
      if (speedEl) speedEl.innerText = formatSpeed(speed)
      if (etaEl) etaEl.innerText = "ETA: " + formatETA(eta)
      lastStatTime = now
      lastStatBytes = sent
    }
    const percent = Math.min((sent / file.size) * 100, 100)
    bar.style.width = percent + "%"
    pct.innerText = Math.round(percent) + "%"
  }
  if (!cancelRequested) {
    channel.send(JSON.stringify({ type: "done", name: file.name }))
    const elapsed = (Date.now() - sendStartTime) / 1000
    const avgSpeed = elapsed > 0 ? file.size / elapsed : 0
    if (speedEl) speedEl.innerText = formatSpeed(avgSpeed)
    if (etaEl) etaEl.innerText = "Done ✓"
    const remaining = fileQueue.length - 1
    pct.innerText = remaining > 0 ? `Done ✓ (${remaining} left)` : "All done ✓"
    bar.style.width = "100%"
    fileQueue.shift()
  } else {
    cancelRequested = false
    isSending = false
    renderQueue()
    return
  }
  await new Promise(r => setTimeout(r, 300))
  processQueue()
}
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
function generateQR(room) {
  QRCode.toCanvas(
    document.getElementById("qrCanvas"),
    location.origin + "/#" + room,
    { width: 160, margin: 1 }
  )
}
async function createOffer() {
  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  socket.emit("signal", { offer })
}
function leaveRoom() {
  try { if (channel) channel.close() } catch {}
  try { if (peer) peer.close() } catch {}
  peer = null
  channel = null
  if (currentRoom) socket.emit("leave-room", currentRoom)
  connected = false
  currentRoom = ""
  fileQueue = []
  isSending = false
  cancelRequested = false
  retryCount = 0
  ipv4OnlyMode = false
  localIP = null
  if (fallbackTimer) clearTimeout(fallbackTimer)
  clearInterval(retryInterval)
  clearInterval(recvStatsInterval)
  if (iceTimeout) clearTimeout(iceTimeout)
  document.getElementById("roomCard").style.display = "none"
  document.getElementById("roomSetup").style.display = "block"
  document.getElementById("qr-area").style.display = "none"
  document.getElementById("roomInput").value = ""
  document.getElementById("roomInput").disabled = false
  document.getElementById("roomDisplay").innerText = ""
  document.getElementById("joinBtn").style.display = "flex"
  document.getElementById("createBtn").style.display = "flex"
  document.getElementById("recvProgressBar").style.width = "0%"
  document.getElementById("recvPercent").innerText = ""
  document.getElementById("recvStatsRow").style.display = "none"
  document.getElementById("sendProgressBar").style.width = "0%"
  document.getElementById("sendProgressWrap").style.display = "none"
  document.getElementById("sendBtn").style.display = "none"
  document.getElementById("retryBtn").style.display = "none"
  document.getElementById("connectionTip").innerHTML = ""
  document.getElementById("chatMessages").innerHTML = ""
  document.getElementById("incomingName").innerText = ""
  document.getElementById("receiveSection").style.display = "none"
  document.getElementById("downloadList").innerHTML = ""
  document.getElementById("queueSection").style.display = "none"
  document.getElementById("queueList").innerHTML = ""
  document.getElementById("fileInput").value = ""
}
