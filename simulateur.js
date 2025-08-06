// simulateur.js

const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log("Connecté !");
  socket.emit("voteAction", "ok");
});