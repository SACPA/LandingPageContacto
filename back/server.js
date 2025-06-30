
require('dotenv').config();

const express = require('express');
const cors = require('cors'); 
const admin = require('firebase-admin'); 
const axios = require('axios'); 
const path = require('path');
const validator = require('validator'); 

const serviceAccount = require('./serviceAccountKey.json');
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



const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
if (!RECAPTCHA_SECRET_KEY) {
  console.error('ERROR: La variable de entorno RECAPTCHA_SECRET_KEY no está definida en .env');
  process.exit(1);
}
console.log('DEBUG: Usando RECAPTCHA_SECRET_KEY (los últimos 5 caracteres):', RECAPTCHA_SECRET_KEY.slice(-5));


const app = express();
const port = 3000; 


const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL) {
  console.error('ERROR: La variable de entorno FRONTEND_URL no está definida en .env');
  process.exit(1);
}


app.use(cors({
  origin: FRONTEND_URL 
}));
console.log('DEBUG: CORS configurado para permitir origen:', FRONTEND_URL);


app.use(express.json());


app.use(express.static(path.join(__dirname, 'public')));

console.log('DEBUG: Sirviendo archivos estáticos desde:', path.join(__dirname, 'public'));


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
      timestamp: admin.database.ServerValue.TIMESTAMP 
    });
    console.log('DEBUG: Datos guardados en Realtime Database con éxito.');

    console.log('Datos de contacto recibidos y guardados con éxito en Realtime Database.');
    res.status(200).json({ message: 'Mensaje enviado con éxito.' });

  } catch (error) {
    console.error('DEBUG CRITICAL ERROR: Error general al procesar el formulario de contacto (catch principal):', error);

    res.status(500).json({ message: 'Error interno del servidor al procesar su solicitud. Por favor, intente de nuevo.' });
  }
});


app.listen(port, () => {
  console.log(`Servidor backend escuchando en http://localhost:${port}`);
  console.log(`Frontend disponible en: http://localhost:${port}/index.html`);
});
