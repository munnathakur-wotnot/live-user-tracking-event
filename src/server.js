// SERVER.js

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

const randomColor = () => {
  const colors = [
    "#52c41a",
    "#fa8c16",
    "#722ed1",
    "#eb2f96",
    "#13c2c2",
    "#2f54eb",
    "#a0d911",
  ];

  return colors[Math.floor(Math.random() * colors.length)];
};

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
      color: randomColor(),
      selectedNodeId: null,
    };

    const roomUsers = Object.values(users).filter(
      (u) => u.roomId === roomId && u.id !== socket.id
    );

    // send all users
    socket.emit("existing-users", roomUsers);

    // send me event
    socket.emit("me", users[socket.id]);

    // notify others
    socket.to(roomId).emit("user-joined", users[socket.id]);
  });

  socket.on("cursor-move", ({ x, y }) => {
    const user = users[socket.id];

    if (!user) return;

    user.x = x;
    user.y = y;

    socket.to(user.roomId).emit("cursor-move", user);
  });

  socket.on("node-selected", ({ nodeId }) => {
    const user = users[socket.id];

    if (!user) return;

    user.selectedNodeId = nodeId;

    socket.to(user.roomId).emit("node-selected", {
      userId: user.id,
      name: user.name,
      color: user.color,
      nodeId,
    });
  });

  socket.on("node-unselected", () => {
    const user = users[socket.id];

    if (!user) return;

    user.selectedNodeId = null;

    socket.to(user.roomId).emit("node-unselected", {
      userId: user.id,
    });
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];

    if (user) {
      socket.to(user.roomId).emit("user-left", socket.id);
    }

    delete users[socket.id];
  });
});

server.listen(5000, () => {
  console.log("SERVER STARTED");
});