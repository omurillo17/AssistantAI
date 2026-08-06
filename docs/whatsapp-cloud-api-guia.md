# Guía: pasar de WAHA a la API oficial de WhatsApp (Meta Cloud API)

Esta guía es para el trámite **manual** que tiene que hacer el dueño del negocio en
Meta — no es algo que se pueda automatizar desde el código. El objetivo final: por
cada `grupo_reclutamiento` (que hoy tiene su propio `telefono_whatsapp` en la BD),
obtener un `phone_number_id` real de Meta y guardarlo en
`grupos_reclutamiento.whatsapp_phone_number_id`.

Los nombres exactos de menús en Meta cambian de vez en cuando, pero el flujo de fondo
lleva años siendo el mismo.

## 1. Qué necesitas tener listo antes de empezar

- Una cuenta personal de Facebook (para administrar todo desde ahí, no hace falta que
  sea "de la empresa").
- Datos legales del negocio: razón social, RFC, dirección fiscal, y opcionalmente un
  comprobante de domicilio — se piden en el paso de verificación de negocio.
- Un correo con el dominio de la empresa (ej. `contacto@tuempresa.com`) ayuda a que la
  verificación sea más rápida, aunque no es estrictamente obligatorio.
- El/los números de teléfono reales que vas a usar (uno por grupo/nave o el que
  decidan) — **no pueden estar ya registrados en la app normal de WhatsApp o WhatsApp
  Business** al momento de darlos de alta en la Cloud API (Meta los "migra").

## 2. Pasos

1. **Crear/entrar a Meta Business Manager** — [business.facebook.com](https://business.facebook.com).
   Aquí vive todo: tu negocio, tus apps, tus números.

2. **Crear una app de tipo "Business"** en
   [developers.facebook.com](https://developers.facebook.com/apps) → *Mis apps* →
   *Crear app* → tipo **Negocio**.

3. **Agregar el producto "WhatsApp"** a esa app. Meta te da automáticamente:
   - Un **número de prueba** gratuito (para probar el envío/recepción sin usar un
     número real todavía).
   - Un **token de acceso temporal** (dura 24h, solo para pruebas rápidas con curl/Postman).
   - El **Phone Number ID** y el **WhatsApp Business Account ID (WABA ID)** del número
     de prueba.

4. **Probar el envío** con el número de prueba: en el panel de WhatsApp > *Introducción*
   puedes mandarte un mensaje a ti mismo (tu número debe estar agregado como "destinatario
   de prueba"). Esto confirma que la cuenta y el token funcionan antes de meter números
   reales.

5. **Agregar tu(s) número(s) real(es)**: WhatsApp > *Configuración de la API* > *Agregar
   número de teléfono* → se verifica por SMS o llamada. Repite esto por cada número que
   vayas a usar (uno por grupo). Todos quedan bajo el mismo WABA, cada uno con su propio
   `phone_number_id`.

6. **Verificación de negocio** (obligatoria para producción real, no solo pruebas):
   *Configuración del negocio* > *Centro de seguridad* > *Verificación del negocio*.
   Aquí subes los documentos legales (acta constitutiva/RFC, comprobante de domicilio).
   Sin esto, los números quedan en un límite bajo de conversaciones por día (Tier 1) y
   solo le puedes escribir a números que hayas agregado manualmente como "testers".
   Puede tardar de un par de días a dos semanas.

7. **Generar un token permanente** (el temporal de 24h no sirve para producción):
   *Configuración del negocio* > *Usuarios* > *Usuarios del sistema* > crear uno nuevo,
   asignarle el WABA con control total, y generar un token con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`, sin fecha de
   expiración. Este es el token que va en tu backend (variable de entorno, nunca en el
   repo).

8. **Configurar el Webhook**: WhatsApp > *Configuración* > *Webhook*. Necesitas una URL
   pública HTTPS (ej. un endpoint nuevo tipo `/api/webhook/meta-whatsapp` en el
   frontend Next.js) y un "Verify Token" que tú mismo inventas (una cadena random).
   Suscríbete al campo `messages`. Meta hace una llamada `GET` de verificación a esa
   URL cuando la das de alta — el endpoint debe responder con el `challenge` que Meta
   le mande si el verify token coincide.

9. **Límites de mensajería (tiers)**: los números nuevos empiezan pudiendo iniciar
   conversación con ~250 usuarios únicos por 24h (Tier 1) y suben automáticamente según
   calidad/volumen, o se puede pedir un tier mayor una vez verificado el negocio.

10. **Precios**: Meta cobra por mensaje/plantilla fuera de la ventana de 24h de
    conversación gratuita que se abre cuando el usuario te escribe primero (que es
    justo el caso de este bot). Los montos y categorías (marketing/utility/service)
    cambian con cierta frecuencia — conviene revisar la página de precios oficial antes
    de presupuestar, no fiarse de un número fijo de hace tiempo.

## 3. Si van a ofrecer esto como SaaS a terceros (Embedded Signup)

Si más adelante cada cliente va a conectar **su propio** número/WABA desde tu panel
(en vez de que tú administres el de todos), se necesita el flujo de **Embedded
Signup**, que requiere que tu app pase la revisión de Meta como "Tech Provider" /
Solution Partner. Es un paso adicional de aprobación, aparte de la verificación de
negocio normal — solo vale la pena tramitarlo cuando ya estén vendiendo esto a más de
un cliente externo.

## 4. Enlaces oficiales de referencia

- Documentación general Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
- Configurar webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
- Precios: https://developers.facebook.com/docs/whatsapp/cloud-api/support/pricing
- Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup
- Meta Business Manager: https://business.facebook.com

(Meta reorganiza su documentación de vez en cuando — si algún link cambió de lugar,
buscar "WhatsApp Cloud API" desde developers.facebook.com/docs lleva al mismo sitio.)

## 5. Qué hacer del lado del código cuando ya tengan credenciales

1. Guardar el `whatsapp_phone_number_id` de cada número en
   `grupos_reclutamiento.whatsapp_phone_number_id` (columna ya agregada en el schema).
2. Guardar el token permanente y el Verify Token como variables de entorno nuevas
   (ej. `META_WHATSAPP_TOKEN`, `META_VERIFY_TOKEN`) — nunca en el repo.
3. Crear el endpoint `/api/webhook/meta-whatsapp` que reciba el payload de Meta,
   extraiga `entry[0].changes[0].value.metadata.phone_number_id` como
   `telefono_destino`, y llame a `resolveEmpresaYGrupo` (ya implementado en
   `frontend/src/lib/empresaResolution.ts`) igual que hoy lo hacen los webhooks de WAHA.
4. Reemplazar las llamadas de envío (`fetch(WAHA_BASE + '/api/sendText')`) por
   llamadas a `https://graph.facebook.com/v20.0/{phone_number_id}/messages` con el
   token de Meta — este cambio sí toca código y se puede planear como un paso aparte
   una vez que el trámite esté resuelto.
