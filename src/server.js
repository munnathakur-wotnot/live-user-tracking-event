const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const users = {};

io.on("connection", (socket) => {
  console.log("CONNECTED:", socket.id);

  socket.on("join-room", ({ roomId, name }) => {
    socket.join(roomId);

    users[socket.id] = {
      id: socket.id,
      name,
      roomId,
      x: 0,
      y: 0,
    };

    // existing users send to new user
    const roomUsers = Object.values(users).filter(
      (u) => u.roomId === roomId && u.id !== socket.id
    );

    socket.emit("existing-users", roomUsers);

    // notify others
    socket.to(roomId).emit("user-joined", users[socket.id]);

    console.log(name, "joined", roomId);
  });

  socket.on("cursor-move", ({ x, y }) => {
    const user = users[socket.id];

    if (!user) return;

    user.x = x;
    user.y = y;

    socket.to(user.roomId).emit("cursor-move", user);
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];

    if (user) {
      socket.to(user.roomId).emit("user-left", socket.id);
    }

    delete users[socket.id];

    console.log("DISCONNECTED:", socket.id);
  });
});

server.listen(5000, () => {
  console.log("SERVER STARTED");
});