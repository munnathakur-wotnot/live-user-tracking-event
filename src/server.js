// SERVER.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

const INITIAL_NODE_ID = "node_1";

const INITIAL_NODES = [
  {
    id: INITIAL_NODE_ID,
    type: "action",
    position: { x: 120, y: 120 },
    deletable: false,
    selectable: false,
    data: {
      id: INITIAL_NODE_ID,
      ports: [
        { in: false, name: "bottom", links: [] },
      ],
      connected: false,
      title: "Start",
      description: "description",
      type: "start",
      icon: "🚀",
    },
  },
];

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
console.log("Hello");
const users = {};

// nodeId -> { socketId, name, color }
const dragLocks = {};

// nodeId -> { socketId, name, color }
const menuLocks = {};

// `${nodeId}::${field}` -> { socketId, name, color, nodeId, field }
const typingLocks = {};

const flows = {};

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
  // typing locks
  for (const [key, lock] of Object.entries(typingLocks)) {
    if (lock.socketId === socket.id) {
      delete typingLocks[key];
      socket
        .to(roomId)
        .emit("node-typing-end", { nodeId: lock.nodeId, field: lock.field });
    }
  }
}

io.on("connection", (socket) => {
  console.log("CONNECTED:", socket.id);

  // ── Join room ────────────────────────────────────────────────
  socket.on("join-room", ({ roomId, name }, ack) => {
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
      (u) => u.roomId === roomId && u.id !== socket.id,
    );

    socket.emit("existing-users", roomUsers);
    socket.emit("me", users[socket.id]);
    // Also ack immediately so the client can use user data before any events
    if (typeof ack === "function") ack(users[socket.id]);
    socket.to(roomId).emit("user-joined", users[socket.id]);

    // Send existing drag / menu locks to the joining user so their UI is correct
    const activeDrags = Object.entries(dragLocks)
      .filter(([, l]) => users[l.socketId]?.roomId === roomId)
      .map(([nodeId, l]) => ({ nodeId, name: l.name, color: l.color }));

    const activeMenus = Object.entries(menuLocks)
      .filter(([, l]) => users[l.socketId]?.roomId === roomId)
      .map(([nodeId, l]) => ({ nodeId, name: l.name, color: l.color }));

    const activeTypings = Object.values(typingLocks)
      .filter((l) => users[l.socketId]?.roomId === roomId)
      .map((l) => ({
        nodeId: l.nodeId,
        field: l.field,
        name: l.name,
        color: l.color,
      }));

    if (activeDrags.length) socket.emit("active-drag-locks", activeDrags);
    if (activeMenus.length) socket.emit("active-menu-locks", activeMenus);
    if (activeTypings.length) socket.emit("active-typing-locks", activeTypings);
  });

  // ── Cursor ───────────────────────────────────────────────────
  socket.on("cursor-move", ({ x, y, isFlow }) => {
    const user = users[socket.id];
    if (!user) return;
    user.x = x;
    user.y = y;
    user.isFlow = isFlow ?? false;
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

    // Release any stale drag lock this user holds on a different node
    for (const [lockedNodeId, lock] of Object.entries(dragLocks)) {
      if (lock.socketId === socket.id && lockedNodeId !== nodeId) {
        delete dragLocks[lockedNodeId];
        socket.to(user.roomId).emit("node-drag-end", { nodeId: lockedNodeId });
      }
    }

    // Already locked by someone else — reject silently (client checks too)
    if (dragLocks[nodeId] && dragLocks[nodeId].socketId !== socket.id) return;

    dragLocks[nodeId] = {
      socketId: socket.id,
      name: user.name,
      color: user.color,
    };

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

    // Release any stale menu lock this user holds on a different node
    for (const [lockedNodeId, lock] of Object.entries(menuLocks)) {
      if (lock.socketId === socket.id && lockedNodeId !== nodeId) {
        delete menuLocks[lockedNodeId];
        socket
          .to(user.roomId)
          .emit("node-menu-close", { nodeId: lockedNodeId });
      }
    }

    menuLocks[nodeId] = {
      socketId: socket.id,
      name: user.name,
      color: user.color,
    };

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

  // ── Typing lock (title / description fields) ─────────────────
  socket.on("node-typing-start", ({ nodeId, field }) => {
    const user = users[socket.id];
    if (!user) return;

    const key = `${nodeId}::${field}`;
    typingLocks[key] = {
      socketId: socket.id,
      name: user.name,
      color: user.color,
      nodeId,
      field,
    };

    socket.to(user.roomId).emit("node-typing-start", {
      nodeId,
      field,
      name: user.name,
      color: user.color,
    });
  });

  socket.on("node-typing-end", ({ nodeId, field }) => {
    const user = users[socket.id];
    if (!user) return;

    const key = `${nodeId}::${field}`;
    if (typingLocks[key]?.socketId !== socket.id) return;
    delete typingLocks[key];

    socket.to(user.roomId).emit("node-typing-end", { nodeId, field });
  });

  socket.on("save-flow", ({ roomId, nodes, edges, currentId }, ack) => {
    let startNode = nodes.find((n) => n.id === INITIAL_NODE_ID);

    // restore if deleted
    if (!startNode) {
      startNode = structuredClone(INITIAL_NODES[0]);

      nodes.unshift(startNode);
    }

    // force protected properties
    startNode.deletable = false;
    startNode.selectable = false;

    startNode.data = {
      ...startNode.data,
      id: INITIAL_NODE_ID,
      type: "start",
      title: "Start",
      // ensure legacy fields are stripped
      inPorts: undefined,
      outPorts: undefined,
    };
    // ensure ports array is always present on start node
    if (!Array.isArray(startNode.data.ports) || startNode.data.ports.length === 0) {
      startNode.data.ports = [{ in: false, name: "bottom", links: [] }];
    }

    flows[roomId] = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      currentId,
      updatedAt: Date.now(),
    };

    // Acknowledge the save so the client knows it landed.
    if (typeof ack === "function") ack({ ok: true });

    socket.to(roomId).emit("flow-updated", {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      currentId,
    });
  });

  // ── Get existing flow ──────────────────────────
  socket.on("get-flow", ({ roomId }, callback) => {
    if (!flows[roomId]) {
      flows[roomId] = {
        nodes: INITIAL_NODES,
        edges: [],
        currentId: 2,
        updatedAt: Date.now(),
      };
    }

    callback(flows[roomId]);
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
      // Notify peers that this user's selected node is no longer selected
      if (user.selectedNodeId) {
        socket.to(user.roomId).emit("node-unselected", { userId: user.id });
      }
      releaseLocksForSocket(socket, user.roomId);

      // send full user details
      socket.to(user.roomId).emit("user-left", user);
    }

    delete users[socket.id];

    console.log("DISCONNECTED:", socket.id);
  });
});

server.listen(5000, () => {
  console.log("SERVER STARTED on :5000");
});
