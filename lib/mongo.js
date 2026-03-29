const mongoose = require("mongoose");

let connected = false;

async function connectMongo() {
  if (connected) return mongoose.connection;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI não configurada.");

  await mongoose.connect(uri, {
    autoIndex: true,
  });

  connected = true;
  console.log("MongoDB conectado com sucesso");
  return mongoose.connection;
}

module.exports = { connectMongo };