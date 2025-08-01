

const form = document.getElementById("contactForm");
 form.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("DEBUG: Enviando datos del formulario...", form);
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);

      data.privacyConsent = document.getElementById("privacyConsent").checked;

      const recaptchaResponse = grecaptcha.getResponse();

      if (!recaptchaResponse) {
        showCustomMessage("Por favor, completa el CAPTCHA.", 'error');
        return; 
      }

      data.recaptchaToken = recaptchaResponse; 

      console.log(data);

      try {
        const res = await fetch("http://137.184.58.132:3160/api/contact", { // URL de Render
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        console.log("DEBUG: Respuesta del servidor:", res);
        if (res.ok) {
          showCustomMessage("Mensaje enviado con éxito.", 'success');
          form.reset();
          grecaptcha.reset(); 
        } else {
          const errorData = await res.json();
          showCustomMessage(`Error al enviar el mensaje: ${errorData.message || 'Error desconocido'}`, 'error');
          grecaptcha.reset(); 
        }
      } catch (error) {
        console.error("Error de red o del servidor:", error);
        showCustomMessage("Hubo un problema de conexión. Inténtalo de nuevo más tarde.", 'error');
        grecaptcha.reset(); 
      }
    });