// server.js (Tu archivo principal del backend)

// Carga las variables de entorno desde el archivo .env
require('dotenv').config();

const jwt = require('jsonwebtoken'); // Importa la librería JWT
const bcrypt = require('bcrypt');     // Importa la librería bcrypt
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const axios = require('axios');
const path = require('path');
const validator = require('validator');

// --- CONFIGURACIÓN DE FIREBASE ADMIN SDK ---
// ¡CORRECCIÓN AQUÍ! Lee la clave de servicio desde la variable de entorno de Render
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY); 
console.log('DEBUG: SERVICE ACCOUNT CARGADA. Project ID:', serviceAccount.project_id);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: La variable de entorno DATABASE_URL no está definida en .env');
  process.exit(1);
}
console.log('DEBUG: Usando DATABASE_URL:', DATABASE_URL);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL,
});
console.log('DEBUG: Firebase Admin SDK inicializado para Realtime Database.');
// ------------------------------------------

// --- CONFIGURACIÓN DE reCAPTCHA ---
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
if (!RECAPTCHA_SECRET_KEY) {
  console.error('ERROR: La variable de entorno RECAPTCHA_SECRET_KEY no está definida en .env');
  process.exit(1);
}
console.log('DEBUG: Usando RECAPTCHA_SECRET_KEY (los últimos 5 caracteres):', RECAPTCHA_SECRET_KEY.slice(-5));
// ---------------------------------

// --- CONFIGURACIÓN DE JWT ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: La variable de entorno JWT_SECRET no está definida en .env. ¡Es crucial para la seguridad!');
  process.exit(1);
}
console.log('DEBUG: JWT_SECRET cargada.');
const HASH_SALT_ROUNDS = 10; // Número de rondas de sal para bcrypt (un valor común es 10-12)
// ----------------------------

// --- CONFIGURACIÓN DE DISCORD WEBHOOK ---
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!DISCORD_WEBHOOK_URL) {
  console.warn('WARNING: La variable de entorno DISCORD_WEBHOOK_URL no está definida. La notificación por Discord no funcionará.');
} else {
  console.log('DEBUG: URL de Discord Webhook cargada.');
}
// ----------------------------------------

const app = express();
const port = 3000;

// --- MIDDLEWARES (Orden importante: JSON y CORS primero) ---
app.use(express.json()); // Necesario para parsear el body de las solicitudes POST/PUT
const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL) {
  console.error('ERROR: La variable de entorno FRONTEND_URL no está definida en .env');
  process.exit(1);
}
app.use(cors({
  origin: FRONTEND_URL
}));
console.log('DEBUG: CORS configurado para permitir origen:', FRONTEND_URL);
// -----------------------------------------------------------

// ======================================================================
// --- RUTAS API (DEFINIDAS ANTES DE SERVIR ARCHIVOS ESTÁTICOS) ---
// ======================================================================

// --- RUTA PARA EL FORMULARIO DE CONTACTO ---
app.post('/contact', async (req, res) => {
  try {
    let { name, email, phone, message, privacyConsent, recaptchaToken } = req.body;

    // --- Sanitización de Datos ---
    name = validator.escape(validator.trim(name || ''));
    email = validator.normalizeEmail(validator.trim(email || ''));
    phone = validator.trim(phone || '');
    message = validator.escape(validator.trim(message || ''));

    console.log('\n--- DEBUG: Datos recibidos y sanitizados en el Backend para /contact ---');
    console.log('name (sanitized):', name);
    console.log('email (sanitized):', email);
    console.log('phone (sanitized):', phone);
    console.log('message (sanitized):', message);
    console.log('privacyConsent:', privacyConsent);
    console.log('recaptchaToken recibido (primeros 10 chars):', recaptchaToken ? recaptchaToken.substring(0, 10) + '...' : 'vacío/undefined');

    if (!recaptchaToken) {
      console.error('DEBUG ERROR: recaptchaToken está vacío o no se recibió. Respondiendo 400.');
      return res.status(400).json({ message: 'El CAPTCHA es requerido.' });
    }

    console.log('DEBUG: recaptchaToken presente, intentando verificar con Google...');

    try {
      const googleVerifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`;
      console.log('DEBUG: URL de verificación de Google construida.');

      const recaptchaVerificationResponse = await axios.post(googleVerifyUrl);
      const { success, score, 'error-codes': errorCodes } = recaptchaVerificationResponse.data;

      console.log('DEBUG: Respuesta de la API de reCAPTCHA - success:', success);
      console.log('DEBUG: Respuesta de la API de reCAPTCHA - score:', score);
      if (errorCodes) {
        console.log('DEBUG: Respuesta de la API de reCAPTCHA - error-codes:', errorCodes);
      }

      if (!success) {
        console.error('DEBUG ERROR: Fallo en la verificación de reCAPTCHA (desde Google API). Códigos de error:', errorCodes);
        return res.status(400).json({ message: 'Falló la verificación del CAPTCHA. Por favor, inténtalo de nuevo.' });
      }

      console.log('DEBUG: reCAPTCHA verificado con éxito por Google.');

    } catch (recaptchaError) {
      console.error('DEBUG ERROR: Error al comunicarse con la API de reCAPTCHA:', recaptchaError.message);
      return res.status(500).json({ message: 'Error interno al verificar el CAPTCHA.' });
    }

    if (!privacyConsent) {
      console.warn('DEBUG WARNING: Intento de envío de formulario sin consentimiento de privacidad. Respondiendo 400.');
      return res.status(400).json({ message: 'Debe aceptar el Aviso de Privacidad y los Términos y Condiciones para enviar el formulario.' });
    }
    console.log('DEBUG: Consentimiento de privacidad aceptado.');

    if (!name || !email || !phone || !message) {
      console.error('DEBUG ERROR: Faltan campos obligatorios después de sanitización. Respondiendo 400.');
      return res.status(400).json({ message: 'Todos los campos obligatorios deben ser completados.' });
    }

    if (!validator.isEmail(email)) {
      console.error('DEBUG ERROR: Formato de correo electrónico inválido. Respondiendo 400.');
      return res.status(400).json({ message: 'El formato del correo electrónico no es válido.' });
    }
    console.log('DEBUG: Todos los campos obligatorios y con formato válido están presentes.');

    const db = admin.database();
    const newContactRef = db.ref('contacts').push();

    console.log('DEBUG: Preparando para guardar en Realtime Database...');
    await newContactRef.set({
      name,
      email,
      phone,
      message,
      privacyConsent,
      timestamp: admin.database.ServerValue.TIMESTAMP,
      status: 'Nuevo' // Añade un estado inicial para el lead
    });
    console.log('DEBUG: Datos guardados en Realtime Database con éxito.');

    // --- SECCIÓN DE NOTIFICACIÓN POR DISCORD WEBHOOK ---
    if (DISCORD_WEBHOOK_URL) {
      try {
        const discordMessage = {
          username: "Mini CRM Leads",
          avatar_url: "https://placehold.co/128x128/007bff/ffffff?text=CRM",
          embeds: [
            {
              title: "¡Nuevo Lead Recibido!",
              description: `Un nuevo contacto ha llenado el formulario.`,
              color: 3447003,
              fields: [
                { name: "Nombre", value: name, inline: true },
                { name: "Email", value: email, inline: true },
                { name: "Teléfono", value: phone, inline: true },
                { name: "Mensaje", value: message, inline: false },
                { name: "Estado Inicial", value: "Nuevo", inline: true }
              ],
              timestamp: new Date().toISOString(),
              footer: {
                text: "Notificación de Mini CRM"
              }
            }
          ]
        };

        const discordResponse = await axios.post(DISCORD_WEBHOOK_URL, discordMessage, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (discordResponse.status === 204) {
          console.log('DEBUG: Notificación por Discord Webhook enviada con éxito.');
        } else {
          console.warn('DEBUG WARNING: Error al enviar notificación por Discord Webhook. Estado:', discordResponse.status, 'Datos:', discordResponse.data);
        }
      } catch (discordError) {
        console.error('DEBUG ERROR: Fallo al comunicarse con la API de Discord Webhook:', discordError.message);
      }
    } else {
      console.warn('DEBUG WARNING: No se enviará notificación por Discord Webhook. URL no definida.');
    }
    // -----------------------------------------------------

    console.log('Datos de contacto recibidos y guardados con éxito en Realtime Database.');
    res.status(200).json({ message: 'Mensaje enviado con éxito.' });

  } catch (error) {
    console.error('DEBUG CRITICAL ERROR: Error general al procesar el formulario de contacto (catch principal):', error);
    res.status(500).json({ message: 'Error interno del servidor al procesar su solicitud. Por favor, intente de nuevo.' });
  }
});

// --- MIDDLEWARE DE AUTENTICACIÓN JWT ---
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        console.warn('DEBUG WARNING: Token JWT inválido o expirado:', err.message);
        return res.status(403).json({ message: 'Acceso denegado: Token inválido o expirado.' });
      }
      req.user = user;
      console.log('DEBUG: Token JWT verificado. Usuario:', req.user.username);
      next();
    });
  } else {
    console.warn('DEBUG WARNING: Acceso denegado: No se proporcionó token JWT.');
    res.status(401).json({ message: 'Acceso denegado: No se proporcionó token de autenticación.' });
  }
};
// ---------------------------------------

// --- RUTAS DE AUTENTICACIÓN (LOGIN/REGISTER) ---
app.post('/admin/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Nombre de usuario y contraseña son requeridos.' });
    }
    if (!validator.isAlphanumeric(username)) {
        return res.status(400).json({ message: 'El nombre de usuario solo puede contener letras y números.' });
    }
    const db = admin.database();
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('username').equalTo(username).once('value');
    if (snapshot.exists()) {
      console.warn('DEBUG WARNING: Intento de registro de usuario existente:', username);
      return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
    }
    const hashedPassword = await bcrypt.hash(password, HASH_SALT_ROUNDS);
    await usersRef.push({
      username: username,
      password: hashedPassword,
      role: 'admin',
      createdAt: admin.database.ServerValue.TIMESTAMP
    });
    console.log('DEBUG: Usuario registrado con éxito:', username);
    res.status(201).json({ message: 'Usuario administrador registrado con éxito.' });
  } catch (error) {
    console.error('DEBUG CRITICAL ERROR: Error al registrar usuario:', error);
    res.status(500).json({ message: 'Error interno del servidor al registrar usuario.' });
  }
});

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Nombre de usuario y contraseña son requeridos.' });
    }
    const db = admin.database();
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('username').equalTo(username).once('value');
    if (!snapshot.exists()) {
      console.warn('DEBUG WARNING: Intento de login fallido: Usuario no encontrado:', username);
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }
    const userData = snapshot.val();
    const userId = Object.keys(userData)[0];
    const user = userData[userId];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.warn('DEBUG WARNING: Intento de login fallido: Contraseña incorrecta para usuario:', username);
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }
    const token = jwt.sign(
      { userId: userId, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('DEBUG: Usuario logueado con éxito. JWT generado para:', username);
    res.status(200).json({ message: 'Login exitoso.', token: token });
  } catch (error) {
    console.error('DEBUG CRITICAL ERROR: Error al intentar login:', error);
    res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
  }
});

app.get('/api/protected-test', authenticateJWT, (req, res) => {
  console.log('DEBUG: Acceso a ruta protegida exitoso para usuario:', req.user.username);
  res.status(200).json({
    message: '¡Acceso a recurso protegido exitoso!',
    user: req.user
  });
});
// -----------------------------------------------------------------

// --- RUTAS PARA LA API DE LEADS DEL CRM (PROTEGIDAS) ---

// Ruta para OBTENER TODOS LOS LEADS con paginación
app.get('/api/leads', authenticateJWT, async (req, res) => {
  try {
    const db = admin.database();
    const leadsRef = db.ref('contacts'); // Tu colección de leads

    // Parámetros de paginación desde la query string (ej. /api/leads?page=1&limit=10)
    const page = parseInt(req.query.page) || 1; // Página actual, por defecto 1
    const limit = parseInt(req.query.limit) || 5; // Leads por página, por defecto 5
    const offset = (page - 1) * limit; // Calcular el offset

    console.log(`DEBUG BACKEND: Solicitud de leads - Página: ${page}, Límite: ${limit}, Offset: ${offset}`);

    let query = leadsRef.orderByKey(); // Ordena por la clave (ID del lead)

    // Si hay un startAfterKey (para paginación basada en cursor), úsalo
    if (req.query.startAfterKey) {
      query = query.startAt(req.query.startAfterKey); // Inicia *en* la clave proporcionada
      console.log('DEBUG BACKEND: Paginación usando startAt con clave:', req.query.startAfterKey);
    } else {
      // Para la primera página o si no hay startAfterKey, simplemente limita
      console.log('DEBUG BACKEND: Paginación sin startAfterKey (primera página o reinicio).');
    }

    // Obtener un elemento más para saber si hay una siguiente página
    const snapshot = await query.limitToFirst(limit + 1).once('value');
    const leadsData = snapshot.val();

    let leadsArray = [];
    let lastKey = null;
    let hasNextPage = false;

    if (leadsData) {
      // Convierte el objeto de leads en un array de objetos con sus IDs
      const allKeys = Object.keys(leadsData);
      console.log('DEBUG BACKEND: Todas las claves obtenidas de Firebase (orden ascendente):', allKeys);
      
      // Si startAfterKey fue usado, el primer elemento de allKeys es el startAfterKey mismo.
      // Lo removemos para que no se duplique en la página actual.
      let leadsToProcess = allKeys;
      if (req.query.startAfterKey && allKeys.length > 0 && allKeys[0] === req.query.startAfterKey) {
          leadsToProcess = allKeys.slice(1);
          console.log('DEBUG BACKEND: Se eliminó el startAfterKey del inicio. Claves a procesar:', leadsToProcess);
      } else {
          console.log('DEBUG BACKEND: No se eliminó startAfterKey. Claves a procesar:', leadsToProcess);
      }

      const leadsToDisplayKeys = leadsToProcess.slice(0, limit); // Toma solo los leads de la página actual

      leadsToDisplayKeys.forEach(key => {
        leadsArray.push({ id: key, ...leadsData[key] });
      });

      // Invertir el array para que los más recientes aparezcan primero en el frontend
      leadsArray.reverse();

      // Determina si hay una siguiente página
      if (leadsToProcess.length > limit) {
        hasNextPage = true;
        // La clave del último lead en esta página (antes de invertir)
        lastKey = leadsToProcess[limit - 1]; 
        console.log('DEBUG BACKEND: Hay siguiente página. lastKey calculado:', lastKey);
      }
    }

    console.log(`DEBUG BACKEND: Se encontraron ${leadsArray.length} leads para la página ${page}. Hay siguiente página: ${hasNextPage}`);

    res.status(200).json({
      leads: leadsArray,
      pagination: {
        page: page,
        limit: limit,
        hasNextPage: hasNextPage,
        nextPageKey: hasNextPage ? lastKey : null // Clave para la siguiente página
      }
    });

  } catch (error) {
    console.error('DEBUG CRITICAL ERROR: Error al obtener leads:', error);
    res.status(500).json({ message: 'Error interno del servidor al obtener leads.' });
  }
});

// Ruta para ACTUALIZAR EL ESTADO DE UN LEAD
app.put('/api/leads/:id', authenticateJWT, async (req, res) => {
  try {
    const leadId = req.params.id;
    const { status } = req.body;

    // Permitir el guion en la validación del ID
    const firebaseIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (!leadId || !firebaseIdRegex.test(leadId)) {
      console.warn('DEBUG WARNING: ID de lead inválido o no cumple el formato esperado:', leadId);
      return res.status(400).json({ message: 'ID de lead inválido o formato incorrecto.' });
    }

    const validStatuses = ['Nuevo', 'Contactado', 'Descartado'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Estado inválido. Los estados permitidos son: ${validStatuses.join(', ')}.` });
    }

    const db = admin.database();
    const leadRef = db.ref(`contacts/${leadId}`);

    const snapshot = await leadRef.once('value');
    if (!snapshot.exists()) {
      console.warn('DEBUG WARNING: Intento de actualizar lead no existente:', leadId);
      return res.status(404).json({ message: 'Lead no encontrado.' });
    }

    await leadRef.update({ status: status });
    console.log(`DEBUG: Estado del lead ${leadId} actualizado a: ${status}`);

    res.status(200).json({ message: 'Estado del lead actualizado con éxito.' });

  } catch (error) {
    console.error('DEBUG CRITICAL ERROR: Error al actualizar el estado del lead:', error);
    res.status(500).json({ message: 'Error interno del servidor al actualizar el lead.' });
  }
});

// --- SERVIR ARCHIVOS ESTÁTICOS DEL FRONTEND (¡DESPUÉS DE RUTAS ESPECÍFICAS!) ---
// Asegúrate de que 'public' sea el nombre de la carpeta donde moviste tu frontend.
const publicPath = path.join(__dirname, 'public');
console.log('DEBUG: Configurando el servidor de archivos estáticos desde:', publicPath); // Nuevo log
app.use(express.static(publicPath));

// Rutas explícitas para servir los archivos HTML principales
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicPath, 'dashboard.html'));
});
app.get('/crm', (req, res) => {
  res.sendFile(path.join(publicPath, 'crm.html'));
});
// -----------------------------------------------------------------------------

app.listen(port, () => {
  console.log(`Servidor backend escuchando en http://localhost:${port}`);
  console.log(`Frontend disponible en: http://localhost:${port}/index.html`);
});
