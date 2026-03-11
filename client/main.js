const socket = io()

let peer = null
let channel = null
let connected = false

let queue = []
let sending = false
let abort = false

let incomingBuffers = []
let fileSize = 0
let receivedSize = 0
let startTime = 0

const successSound = new Audio("success.mp3")

/* AUTO JOIN FROM QR */
window.onload = () => {
  if (location.hash) {
    const room = location.hash.substring(1)
    document.getElementById("roomInput").value = room
    joinRoom()
  }
}

/* ROOM */

function createRoom() {
  const room = Math.random().toString(36).substring(2, 7)
  document.getElementById("roomDisplay").innerText = "Room Key: " + room
  socket.emit("join-room", room)
  generateQR(room)
  startPeer(true)
}

function joinRoom() {
  const room = document.getElementById("roomInput").value
  document.getElementById("roomDisplay").innerText = "Joining " + room
  socket.emit("join-room", room)
  startPeer(false)
}

/* SIGNALING */

socket.on("user-joined", () => createOffer())

socket.on("signal", async d => {
  if (d.offer) {
    await peer.setRemoteDescription(d.offer)
    const ans = await peer.createAnswer()
    await peer.setLocalDescription(ans)
    socket.emit("signal", { answer: ans })
  }
  if (d.answer) await peer.setRemoteDescription(d.answer)
  if (d.candidate) {
    try { await peer.addIceCandidate(d.candidate) } catch { }
  }
})

/* WEBRTC */

function startPeer(isCreator) {

  peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  })

  peer.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { candidate: e.candidate })
  }

  peer.onconnectionstatechange = () => {

    if (peer.connectionState === "connected") {
      connected = true

      document.getElementById("roomSetup").style.display = "none"
      document.getElementById("roomCard").style.display = "block"

      document.getElementById("peerStatus").innerText = "(online)"

      addSystemMessage("Peer connected")
    }

    if (peer.connectionState === "disconnected" ||
      peer.connectionState === "failed") {

      document.getElementById("peerStatus").innerText = "(offline)"

      addSystemMessage("Peer disconnected")
    }
  }

  if (isCreator) {
    channel = peer.createDataChannel("file")
    setupChannel()
  } else {
    peer.ondatachannel = e => {
      channel = e.channel
      setupChannel()
    }
  }
}

function setupChannel() {

  channel.binaryType = "arraybuffer"

  channel.onmessage = e => {

    if (typeof e.data === "string") {

      const msg = JSON.parse(e.data)

      /* FILE META */

      if (msg.type === "meta") {
        fileSize = msg.size
        incomingBuffers = []
        receivedSize = 0
        startTime = Date.now()

        document.getElementById("incomingName").innerText =
          "Receiving " + msg.name
      }

      /* FILE DONE */

      if (msg.type === "done") {

        const blob = new Blob(incomingBuffers)
        const url = URL.createObjectURL(blob)

        showPreview(url, msg.name)

        const a = document.getElementById("download")
        a.href = url
        a.download = msg.name
        a.innerText = "Download File"

        addHistory("✔ Received: " + msg.name)

        successSound.play()

        document.getElementById("successAnim").style.display = "block"
        setTimeout(() => {
          document.getElementById("successAnim").style.display = "none"
        }, 3000)
      }

      /* CHAT */

      if (msg.type === "chat") {
        addChatMessage(msg.text, "peer")
      }

      if (msg.type === "typing") {
        showTyping()
      }

      if (msg.type === "chatImage") {
        addChatImage(msg.data, "peer")
      }

    } else {

      incomingBuffers.push(e.data)
      receivedSize += e.data.byteLength

      const percent = (receivedSize / fileSize) * 100

      document.getElementById("recvProgressBar").style.width =
        percent.toFixed(2) + "%"

      updateMetrics(receivedSize, fileSize)
    }
  }
}

async function createOffer() {
  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  socket.emit("signal", { offer })
}

/* FILE SENDING */

function selectFiles() {
  const files = document.getElementById("fileInput").files
  for (const f of files) {
    queue.push(f)
    addFileToUI(f)
  }
  if (!sending) processQueue()
}

async function processQueue() {
  if (queue.length === 0) return
  sending = true
  abort = false
  const file = queue.shift()
  await sendFileInternal(file)
  sending = false
  processQueue()
}

async function sendFileInternal(file) {

  const chunkSize = 64 * 1024
  let offset = 0

  channel.send(JSON.stringify({
    type: "meta",
    name: file.name,
    size: file.size
  }))

  startTime = Date.now()

  const reader = new FileReader()

  reader.onload = async e => {

    if (abort) {
      resetTransferUI()
      return
    }

    while (channel.bufferedAmount > 1000000)
      await new Promise(r => setTimeout(r, 10))

    channel.send(e.target.result)
    offset += e.target.result.byteLength

    updateMetrics(offset, file.size)

    document.getElementById("progressBar").style.width =
      ((offset / file.size) * 100).toFixed(2) + "%"

    if (offset < file.size) {
      readSlice(offset)
    } else {
      channel.send(JSON.stringify({ type: "done", name: file.name }))
      addHistory("✔ Sent: " + file.name)
      resetTransferUI()
    }
  }

  function readSlice(o) {
    const slice = file.slice(o, o + chunkSize)
    reader.readAsArrayBuffer(slice)
  }

  readSlice(0)
}

function cancelTransfer() {
  abort = true
}

function updateMetrics(done, total) {

  const time = (Date.now() - startTime) / 1000
  const speed = done / time
  const remaining = (total - done) / speed

  document.getElementById("speed").innerText =
    "Speed: " + (speed / 1024 / 1024).toFixed(2) + " MB/s"

  document.getElementById("eta").innerText =
    "ETA: " + remaining.toFixed(1) + " sec"
}

/* UI HELPERS */

function addFileToUI(file) {
  const card = document.createElement("div")
  card.className = "fileCard"
  card.innerHTML =
    `<strong>${file.name}</strong>
     <div>${(file.size / 1024 / 1024).toFixed(2)} MB</div>`
  document.getElementById("queueList").appendChild(card)
}

function addHistory(text) {
  const item = document.createElement("div")
  item.className = "historyItem"
  item.innerText = text
  document.getElementById("historyBox").prepend(item)
}

function showPreview(url, name) {
  const box = document.getElementById("previewBox")
  box.innerHTML = ""

  if (name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    box.innerHTML = `<img src="${url}" style="max-width:100%">`
  }
  else if (name.match(/\.(mp4|webm|mov)$/i)) {
    box.innerHTML = `<video controls src="${url}" style="max-width:100%"></video>`
  }
  else if (name.match(/\.(mp3|wav)$/i)) {
    box.innerHTML = `<audio controls src="${url}"></audio>`
  }
  else {
    box.innerHTML = `<p>Preview not supported</p>`
  }
}

function resetTransferUI() {
  document.getElementById("progressBar").style.width = "0%"
}

/* CHAT */

function sendChat(){

  const input = document.getElementById("chatInput")

  const text = input.value.trim()

  if(!text) return

  channel.send(JSON.stringify({
    type:"chat",
    text:text
  }))

  addChatMessage(text,"me")

  input.value = ""

}

function sendTyping() {
  channel.send(JSON.stringify({ type: "typing" }))
}

function addChatMessage(text, who) {
  const msg = document.createElement("div")
  msg.className = "chatMsg " + who
  msg.innerText = text

  const box = document.getElementById("chatMessages")
  box.appendChild(msg)
  box.scrollTop = box.scrollHeight
}

function sendEmoji(e) {
  channel.send(JSON.stringify({ type: "chat", text: e }))
  addChatMessage(e, "me")
}

function showTyping() {
  const el = document.getElementById("typingIndicator")
  el.innerText = "Peer typing..."

  clearTimeout(window.typingTimer)

  window.typingTimer = setTimeout(() => {
    el.innerText = ""
  }, 1000)
}

function addSystemMessage(text) {
  const msg = document.createElement("div")
  msg.className = "systemMsg"
  msg.innerText = text

  document.getElementById("chatMessages").appendChild(msg)
}

function sendChatImage(file) {

  const reader = new FileReader()

  reader.onload = e => {

    channel.send(JSON.stringify({
      type: "chatImage",
      data: e.target.result
    }))

    addChatImage(e.target.result, "me")
  }

  reader.readAsDataURL(file)
}

function addChatImage(src, who) {

  const img = document.createElement("img")
  img.src = src
  img.className = "chatImage"

  const box = document.getElementById("chatMessages")
  box.appendChild(img)
  box.scrollTop = box.scrollHeight
}

/* DRAG IMAGE INTO CHAT */

document.addEventListener("DOMContentLoaded", () => {

  const chat = document.getElementById("chatMessages")

  if (chat) {

    chat.addEventListener("dragover", e => e.preventDefault())

    chat.addEventListener("drop", e => {
      e.preventDefault()

      const file = e.dataTransfer.files[0]

      if (file && file.type.startsWith("image/")) {
        sendChatImage(file)
      }
    })
  }
})

/* EXIT */

function leaveRoom() {
  cleanupConnection()
  socket.disconnect()
  location.reload()
}

function cleanupConnection() {
  if (channel) channel.close()
  if (peer) peer.close()

  connected = false
  queue = []

  document.getElementById("roomSetup").style.display = "block"
  document.getElementById("roomCard").style.display = "none"
}

/* QR */

function generateQR(room) {
  const url =
    window.location.protocol +
    "//" +
    window.location.host +
    "/#" +
    room

  QRCode.toCanvas(
    document.getElementById("qrCanvas"),
    url
  )
}

document.addEventListener("DOMContentLoaded", () => {

  const chatInput = document.getElementById("chatInput")

  chatInput.addEventListener("keydown", e => {

    if (e.key === "Enter" && !e.shiftKey) {

      e.preventDefault()
      sendChat()

    }

  })

})