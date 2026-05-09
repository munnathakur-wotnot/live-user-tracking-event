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

// nodeId -> { socketId, name, color }
const dragLocks = {};

// nodeId -> { socketId, name, color }
const menuLocks = {};

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

/** Release all drag + menu locks held by a given socket and notify room. */
function releaseLocksForSocket(socket, roomId) {
  // drag locks
  for (const [nodeId, lock] of Object.entries(dragLocks)) {
    if (lock.socketId === socket.id) {
      delete dragLocks[nodeId];
      socket.to(roomId).emit("node-drag-end", { nodeId });
    }
  }
  // menu locks
  for (const [nodeId, lock] of Object.entries(menuLocks)) {
    if (lock.socketId === socket.id) {
      delete menuLocks[nodeId];
      socket.to(roomId).emit("node-menu-close", { nodeId });
    }
  }
}

io.on("connection", (socket) => {
  console.log("CONNECTED:", socket.id);

  // ── Join room ────────────────────────────────────────────────
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

    socket.emit("existing-users", roomUsers);
    socket.emit("me", users[socket.id]);
    socket.to(roomId).emit("user-joined", users[socket.id]);

    // Send existing drag / menu locks to the joining user so their UI is correct
    const activeDrags = Object.entries(dragLocks)
      .filter(([, l]) => users[l.socketId]?.roomId === roomId)
      .map(([nodeId, l]) => ({ nodeId, name: l.name, color: l.color }));

    const activeMenus = Object.entries(menuLocks)
      .filter(([, l]) => users[l.socketId]?.roomId === roomId)
      .map(([nodeId, l]) => ({ nodeId, name: l.name, color: l.color }));

    if (activeDrags.length) socket.emit("active-drag-locks", activeDrags);
    if (activeMenus.length) socket.emit("active-menu-locks", activeMenus);
  });

  // ── Cursor ───────────────────────────────────────────────────
  socket.on("cursor-move", ({ x, y }) => {
    const user = users[socket.id];
    if (!user) return;
    user.x = x;
    user.y = y;
    socket.to(user.roomId).emit("cursor-move", user);
  });

  // ── Node selected / unselected ───────────────────────────────
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
    socket.to(user.roomId).emit("node-unselected", { userId: user.id });
  });

  // ── Node drag lock ───────────────────────────────────────────
  socket.on("node-drag-start", ({ nodeId }) => {
    const user = users[socket.id];
    if (!user) return;

    // Already locked by someone else — reject silently (client checks too)
    if (dragLocks[nodeId] && dragLocks[nodeId].socketId !== socket.id) return;

    dragLocks[nodeId] = { socketId: socket.id, name: user.name, color: user.color };

    socket.to(user.roomId).emit("node-drag-start", {
      nodeId,
      name: user.name,
      color: user.color,
    });
  });

  socket.on("node-drag-end", ({ nodeId }) => {
    const user = users[socket.id];
    if (!user) return;

    if (dragLocks[nodeId]?.socketId !== socket.id) return;
    delete dragLocks[nodeId];

    socket.to(user.roomId).emit("node-drag-end", { nodeId });
  });

  // ── Node menu open / close ───────────────────────────────────
  socket.on("node-menu-open", ({ nodeId }) => {
    const user = users[socket.id];
    if (!user) return;

    menuLocks[nodeId] = { socketId: socket.id, name: user.name, color: user.color };

    socket.to(user.roomId).emit("node-menu-open", {
      nodeId,
      name: user.name,
      color: user.color,
    });
  });

  socket.on("node-menu-close", ({ nodeId }) => {
    const user = users[socket.id];
    if (!user) return;

    if (menuLocks[nodeId]?.socketId !== socket.id) return;
    delete menuLocks[nodeId];

    socket.to(user.roomId).emit("node-menu-close", { nodeId });
  });

  // ── Node data changed ────────────────────────────────────────
  socket.on("node-changed", ({ nodeId, data }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(user.roomId).emit("node-changed", { nodeId, data });
  });

  // ── Disconnect ───────────────────────────────────────────────
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      releaseLocksForSocket(socket, user.roomId);
      socket.to(user.roomId).emit("user-left", socket.id);
    }
    delete users[socket.id];
    console.log("DISCONNECTED:", socket.id);
  });
});

server.listen(5000, () => {
  console.log("SERVER STARTED on :5000");
});
