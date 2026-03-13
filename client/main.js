const socket = io()

let peer
let channel
let connected=false

let fileBuffer=[]
let fileSize=0
let received=0

/* AUTO JOIN */

window.onload=()=>{
if(location.hash){
document.getElementById("roomInput").value=
location.hash.substring(1)
joinRoom()
}
}

/* ROOM */

function createRoom(){
const room=Math.random().toString(36).substr(2,6)
socket.emit("join-room",room)
document.getElementById("roomDisplay").innerText="Room: "+room
generateQR(room)
startPeer(true)
}

function joinRoom(){
const room=document.getElementById("roomInput").value
socket.emit("join-room",room)
document.getElementById("roomDisplay").innerText="Joining "+room
startPeer(false)
}

/* SIGNALING */

socket.on("peer-joined",()=>createOffer())

socket.on("signal",async data=>{

if(data.offer){
await peer.setRemoteDescription(data.offer)
const ans=await peer.createAnswer()
await peer.setLocalDescription(ans)
socket.emit("signal",{answer:ans})
}

if(data.answer) await peer.setRemoteDescription(data.answer)

if(data.candidate){
try{await peer.addIceCandidate(data.candidate)}catch{}
}

})

/* WEBRTC */

function startPeer(isCreator){

peer=new RTCPeerConnection({
iceServers:[
{urls:"stun:stun.l.google.com:19302"},
{urls:"stun:stun1.l.google.com:19302"},
{urls:"stun:stun2.l.google.com:19302"}
],
iceCandidatePoolSize:10
})

peer.onicecandidate=e=>{
if(e.candidate) socket.emit("signal",{candidate:e.candidate})
}

peer.onconnectionstatechange=connectionUI

if(isCreator){
channel=peer.createDataChannel("file")
setupChannel()
}else{
peer.ondatachannel=e=>{
channel=e.channel
setupChannel()
}
}

}

function connectionUI(){

const s=peer.connectionState
const status=document.getElementById("connectionStatus")
const retry=document.getElementById("retryBtn")

if(s==="connected"){
connected=true
status.innerText="🟢 Connected"
retry.style.display="none"
showRoomUI()
}

if(s==="connecting"){
status.innerText="🔄 Connecting..."
}

if(s==="failed"||s==="disconnected"){
status.innerText="🔴 Connection Failed"
retry.style.display="block"
}

}

function retryConnection(){
if(peer) peer.restartIce()
}

function showRoomUI(){
document.getElementById("roomSetup").style.display="none"
document.getElementById("roomCard").style.display="block"
}

/* DATA CHANNEL */

function setupChannel(){

channel.binaryType="arraybuffer"

channel.onmessage=e=>{

if(typeof e.data==="string"){

const msg=JSON.parse(e.data)

if(msg.type==="meta"){
fileBuffer=[]
received=0
fileSize=msg.size
document.getElementById("incomingName")
.innerText="Receiving "+msg.name
}

if(msg.type==="done"){
const blob=new Blob(fileBuffer)
const url=URL.createObjectURL(blob)

const a=document.getElementById("download")
a.href=url
a.download=msg.name
a.innerText="Download File"

document.getElementById("incomingName")
.innerText="Transfer Complete ✔"
}

if(msg.type==="chat"){
addChat(msg.text,"peer")
}

}else{

fileBuffer.push(e.data)
received+=e.data.byteLength

const percent=(received/fileSize)*100
document.getElementById("recvProgressBar")
.style.width=percent+"%"

}

}

}

/* SEND FILE */

function selectFiles(){

if(!connected) return

const file=document.getElementById("fileInput").files[0]
if(!file) return

const chunk=256*1024
let offset=0

channel.send(JSON.stringify({
type:"meta",
name:file.name,
size:file.size
}))

const reader=new FileReader()

reader.onload=async e=>{

while(channel.bufferedAmount>1e6)
await new Promise(r=>setTimeout(r,10))

channel.send(e.target.result)
offset+=e.target.result.byteLength

if(offset<file.size) readSlice(offset)
else channel.send(JSON.stringify({type:"done",name:file.name}))
}

function readSlice(o){
reader.readAsArrayBuffer(file.slice(o,o+chunk))
}

readSlice(0)

}

/* CHAT */

function sendChat(){
const input=document.getElementById("chatInput")
const text=input.value.trim()
if(!text) return
channel.send(JSON.stringify({type:"chat",text}))
addChat(text,"me")
input.value=""
}

function addChat(text,who){
const div=document.createElement("div")
div.className="chatMsg "+who
div.innerText=text
const box=document.getElementById("chatMessages")
box.appendChild(div)
box.scrollTop=box.scrollHeight
}

document.addEventListener("DOMContentLoaded",()=>{
document.getElementById("chatInput")
.addEventListener("keydown",e=>{
if(e.key==="Enter"&&!e.shiftKey){
e.preventDefault()
sendChat()
}
})
})

function generateQR(room){
QRCode.toCanvas(
document.getElementById("qrCanvas"),
location.origin+"/#"+room
)
}

async function createOffer(){
const offer=await peer.createOffer()
await peer.setLocalDescription(offer)
socket.emit("signal",{offer})
}

function leaveRoom(){

  try{ if(channel) channel.close() }catch{}
  try{ if(peer) peer.close() }catch{}

  connected=false

  document.getElementById("roomCard").style.display="none"
  document.getElementById("roomSetup").style.display="block"

  document.getElementById("recvProgressBar").style.width="0%"
  document.getElementById("chatMessages").innerHTML=""
  document.getElementById("incomingName").innerText=""
}
