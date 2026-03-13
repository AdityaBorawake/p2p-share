const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const path = require("path")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(path.join(__dirname,"../client")))

io.on("connection", socket => {

  socket.on("join-room", room => {
    socket.join(room)
    const clientIP = (socket.handshake.headers["x-forwarded-for"] || socket.handshake.address || "").split(",")[0].trim()
    socket.to(room).emit("peer-joined")
    socket.to(room).emit("peer-ip", clientIP)

    socket.on("signal", data => {
      socket.to(room).emit("signal", data)
    })

    socket.on("leave-room", () => {
      socket.to(room).emit("peer-left")
      socket.leave(room)
    })

    socket.on("disconnect", () => {
      socket.to(room).emit("peer-left")
    })
  })

})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log("Server running"))
