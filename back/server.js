// index.js
const express = require("express");
const cors = require("cors");
const app = express();
const PORT = 3000;

// Cargar credenciales del servicio (exportadas desde Firebase)
var admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://landingpage-f924f-default-rtdb.firebaseio.com"
});



console.log("Hora local:", new Date().toISOString());
console.log("Timestamp actual:", Math.floor(Date.now() / 1000));

const db = admin.database();

app.use(cors());
app.use(express.json());

app.post("/contact", (req, res) => {
  const { name, email, phone, message } = req.body;

  const newRef = db.ref("contacts").push();
  newRef.set({ name, email, phone, message })
    .then(() => res.status(200).json({ message: "Guardado correctamente" }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
