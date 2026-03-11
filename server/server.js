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
    socket.to(room).emit("peer-joined")

    socket.on("signal", data => {
      socket.to(room).emit("signal", data)
    })

    socket.on("disconnect",()=>{
      socket.to(room).emit("peer-left")
    })

  })

})

const PORT = process.env.PORT || 3000

server.listen(PORT,()=>console.log("Server running"))
