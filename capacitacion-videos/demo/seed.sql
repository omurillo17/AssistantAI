-- ============================================================================
-- DATOS FICTICIOS para grabar los videos de Capacitación.
-- Solo se carga en la base demo (capacitacion-videos/demo/docker-compose.yml).
-- Personas, teléfonos, CURP, RFC y correos son inventados.
--
-- Usuarios de la demo (contraseña de todos: demo-capacitacion):
--   reclutadora.demo  → Laura Méndez (RECLUTADOR, grupo Reclutamiento Occidente)
--   diego.demo        → Diego Torres (RECLUTADOR)
--   admin.demo        → Carlos Ruiz  (ADMIN)
-- ============================================================================

-- El esquema siembra un ROOT real; en la demo no se usa.
DELETE FROM usuarios WHERE usuario = 'omurillo17';

INSERT INTO empresas (id, nombre) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Grupo Industrial Demo');

-- formatNaveName solo pinta naves con MATRIZ / CEDIS / SUCURSAL / ... en el nombre.
INSERT INTO naves (id, empresa_id, nombre) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'MATRIZ GUADALAJARA'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'CEDIS ZAPOPAN'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'SUCURSAL TLAQUEPAQUE');

INSERT INTO grupos_reclutamiento (id, empresa_id, nombre, naves_asignadas) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Reclutamiento Occidente',
   '["b0000000-0000-4000-8000-000000000001","b0000000-0000-4000-8000-000000000002","b0000000-0000-4000-8000-000000000003"]');

INSERT INTO reclutadores (id, nombre, empresa_id, color, calendar_id, naves) VALUES
  ('rec-laura', 'Laura Méndez', 'a0000000-0000-4000-8000-000000000001', '#6366f1', 'laura.mendez@demo.example',
   '["b0000000-0000-4000-8000-000000000001","b0000000-0000-4000-8000-000000000002","b0000000-0000-4000-8000-000000000003"]'),
  ('rec-diego', 'Diego Torres', 'a0000000-0000-4000-8000-000000000001', '#0ea5e9', 'diego.torres@demo.example',
   '["b0000000-0000-4000-8000-000000000002"]');

INSERT INTO usuarios (usuario, nombre, password_hash, rol, reclutador_id, grupo_id, empresa_id) VALUES
  ('reclutadora.demo', 'Laura Méndez', '$2b$10$cLh8mr0RiuF5M7yjKos4QObjgUT99LYufsly8BHz0K7sweSq9k7tC', 'RECLUTADOR', 'rec-laura',
   'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('diego.demo', 'Diego Torres', '$2b$10$cLh8mr0RiuF5M7yjKos4QObjgUT99LYufsly8BHz0K7sweSq9k7tC', 'RECLUTADOR', 'rec-diego',
   'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('admin.demo', 'Carlos Ruiz', '$2b$10$cLh8mr0RiuF5M7yjKos4QObjgUT99LYufsly8BHz0K7sweSq9k7tC', 'ADMIN', NULL,
   NULL, 'a0000000-0000-4000-8000-000000000001');

-- vacantes_def.naves es TEXT pero el código lo castea a jsonb: debe ser un arreglo JSON válido.
INSERT INTO vacantes_def (id, reclutador_id, nombre, naves, detalles, funciones, palabras_clave, filtros, empresa_id, nave_id, orden) VALUES
  ('vac-montacarguista', 'rec-laura', 'MONTACARGUISTA', '["b0000000-0000-4000-8000-000000000002"]',
   'Sueldo $2,450 semanales. Turno mixto de lunes a sábado.', 'Carga y descarga de tarimas; acomodo en racks.', 'montacargas, operador de montacargas',
   '[{"id": "f-edad", "clave": "edad", "etiqueta": "Rango de edad", "tipo": "rango_edad", "pregunta": "¿Qué edad tienes?", "edad_min": 18, "edad_max": 45, "activo": true}, {"id": "f-exp", "clave": "experiencia", "etiqueta": "Experiencia con montacargas", "tipo": "si_no", "pregunta": "¿Tienes experiencia manejando montacargas?", "requiere_si": true, "activo": true}, {"id": "f-turno", "clave": "turno", "etiqueta": "Disponibilidad de turno", "tipo": "opcion", "pregunta": "¿Puedes trabajar en turno mixto de lunes a sábado?", "opciones": ["Sí", "No"], "valor_requerido": "Sí", "activo": true}]',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 1),
  ('vac-ayudante', 'rec-laura', 'AYUDANTE GENERAL', '["b0000000-0000-4000-8000-000000000001"]',
   'Sueldo $2,100 semanales. Turno matutino.', 'Surtido de pedidos y limpieza del área.', 'ayudante, auxiliar',
   '[]', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 2),
  ('vac-chofer', 'rec-laura', 'OPERADOR DE VEHÍCULO', '["b0000000-0000-4000-8000-000000000003"]',
   'Sueldo $2,800 semanales. Licencia tipo C vigente.', 'Reparto local de mercancía.', 'chofer, repartidor',
   '[]', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 3);

-- ---------------------------------------------------------------------------
-- Candidatos (ficticios). Teléfonos de 13 dígitos 52133100000NN.
-- ---------------------------------------------------------------------------
INSERT INTO candidatos (id, telefono, nombre, nombre_chat, nombre_ine, edad, correo, lugar_residencia, estado,
  vacante_interes, nave_interes, nave_id, empresa_id, asignado_a_id, tiene_cv, escalado, escalation_reason, escalated_at,
  veredicto, resumen_ia, fecha_entrevista, curp_ine, curp_rfc, datos_ine, datos_rfc, privacidad_aceptada,
  created_at, ultima_interaccion)
VALUES
  ('d0000000-0000-4000-8000-000000000001', '5213310000001', 'Ana Ramírez Soto', 'Ana Ramírez', 'ANA RAMIREZ SOTO', '29', 'ana.ramirez@correo.example', 'Zapopan',
   'CITA_AGENDADA', 'MONTACARGUISTA', 'CEDIS ZAPOPAN', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   TRUE, FALSE, NULL, NULL, 'VIABLE',
   'Edad: 29. Experiencia: 3 años en almacén. Licencia de montacargas: Sí. Disponibilidad: Turno mixto.',
   to_char((NOW() AT TIME ZONE 'UTC')::date + TIME '17:00', 'YYYY-MM-DD"T"HH24:MI:SS'),
   'RASA960215MJCMTN04', 'RASA960215MJCMTN04',
   '{"archivos":[{"url":"/uploads/demo/ine-frente-ana.jpg","tipo":"INE_FRENTE"},{"url":"/uploads/demo/ine-reverso-ana.jpg","tipo":"INE_REVERSO"}],"nombre_completo":"ANA RAMIREZ SOTO","curp":"RASA960215MJCMTN04","clave_elector":"RMSTAN96021514M800"}',
   '{"archivos":[{"url":"/uploads/demo/constancia-ana.pdf","tipo":"CONSTANCIA_FISCAL"}],"rfc":"RASA960215AB1","curp":"RASA960215MJCMTN04","nombre_completo":"ANA RAMIREZ SOTO"}',
   TRUE, NOW() - INTERVAL '2 days', NOW() - INTERVAL '35 minutes'),

  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'Jorge Castillo Peña', 'Jorge Castillo', NULL, '34', NULL, 'Guadalajara',
   'ESCALADO', 'OPERADOR DE VEHÍCULO', 'SUCURSAL TLAQUEPAQUE', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', NULL,
   FALSE, TRUE, 'El candidato pidió hablar con una persona sobre el horario.', NOW() - INTERVAL '12 minutes', NULL,
   'Edad: 34. Licencia: Tipo C vigente. Duda: horario de salida los sábados.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '1 day', NOW() - INTERVAL '12 minutes'),

  ('d0000000-0000-4000-8000-000000000003', '5213310000003', 'María Fernanda López', 'Mafer López', NULL, '22', NULL, 'Tlaquepaque',
   'INTERESADO', 'AYUDANTE GENERAL', 'MATRIZ GUADALAJARA', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', NULL,
   FALSE, FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '5 minutes'),

  ('d0000000-0000-4000-8000-000000000004', '5213310000004', 'Roberto Navarro Gil', 'Roberto Navarro', 'ROBERTO NAVARRO GIL', '41', NULL, 'Tonalá',
   'CV_RECIBIDO', 'MONTACARGUISTA', 'CEDIS ZAPOPAN', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   TRUE, FALSE, NULL, NULL, NULL, 'Edad: 41. Experiencia: 10 años como montacarguista.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '6 hours', NOW() - INTERVAL '1 hour'),

  ('d0000000-0000-4000-8000-000000000005', '5213310000005', 'Daniela Ortega Ruiz', 'Daniela Ortega', 'DANIELA ORTEGA RUIZ', '26', NULL, 'Zapopan',
   'FILTROS_COMPLETADOS', 'AYUDANTE GENERAL', 'MATRIZ GUADALAJARA', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   TRUE, FALSE, NULL, NULL, 'VIABLE', 'Edad: 26. Escolaridad: Preparatoria. Disponibilidad: Turno matutino.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours'),

  ('d0000000-0000-4000-8000-000000000006', '5213310000006', 'Luis Alberto Vega', 'Luis Vega', 'LUIS ALBERTO VEGA MORA', '30', NULL, 'Guadalajara',
   'INE_VALIDADA', 'OPERADOR DE VEHÍCULO', 'SUCURSAL TLAQUEPAQUE', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   TRUE, FALSE, NULL, NULL, 'VIABLE', 'Edad: 30. Licencia: Tipo C vigente. Experiencia: 5 años en reparto.', NULL,
   'VEML950603HJCGRS02', 'VEML950603HJCGRS02', NULL, NULL,
   TRUE, NOW() - INTERVAL '2 days', NOW() - INTERVAL '4 hours'),

  -- Alerta de identidad (diferencia menor de CURP). Asignada a Diego para que NO tape las
  -- pantallas de Laura; capture.mjs la reasigna a Laura solo para la toma de la alerta.
  ('d0000000-0000-4000-8000-000000000007', '5213310000007', 'Sofía Herrera Campos', 'Sofi Herrera', 'SOFIA HERRERA CAMPOS', '27', NULL, 'Zapopan',
   'CV_RECIBIDO', 'MONTACARGUISTA', 'CEDIS ZAPOPAN', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'rec-diego',
   TRUE, FALSE, NULL, NULL, NULL, 'Edad: 27. Experiencia: 2 años en almacén. Revisión de identidad pendiente.', NULL,
   'HECS980411MJCRMF07', 'HECS980411MJCRMF01',
   '{"archivos":[{"url":"/uploads/demo/ine-frente-sofia.jpg","tipo":"INE_FRENTE"},{"url":"/uploads/demo/ine-reverso-sofia.jpg","tipo":"INE_REVERSO"}],"nombre_completo":"SOFIA HERRERA CAMPOS","curp":"HECS980411MJCRMF07","clave_elector":"HRCMSF98041114M300"}',
   '{"archivos":[{"url":"/uploads/demo/constancia-sofia.pdf","tipo":"CONSTANCIA_FISCAL"}],"rfc":"HECS980411QX2","curp":"HECS980411MJCRMF01","nombre_completo":"SOFIA HERRERA CAMPOS"}',
   TRUE, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '50 minutes'),

  ('d0000000-0000-4000-8000-000000000008', '5213310000008', 'Pedro Salinas Ríos', 'Pedro Salinas', 'PEDRO SALINAS RIOS', '38', NULL, 'Guadalajara',
   'ENTREVISTADO', 'AYUDANTE GENERAL', 'MATRIZ GUADALAJARA', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   TRUE, FALSE, NULL, NULL, 'VIABLE', 'Edad: 38. Entrevista realizada: buena actitud.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '6 days', NOW() - INTERVAL '1 day'),

  ('d0000000-0000-4000-8000-000000000009', '5213310000009', 'Karla Jiménez Ávila', 'Karla Jiménez', 'KARLA JIMENEZ AVILA', '31', NULL, 'Zapopan',
   'CONTRATADO', 'MONTACARGUISTA', 'CEDIS ZAPOPAN', 'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   TRUE, FALSE, NULL, NULL, 'VIABLE', 'Edad: 31. Contratada para turno mixto.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '9 days', NOW() - INTERVAL '3 days'),

  ('d0000000-0000-4000-8000-000000000010', '5213310000010', 'Miguel Ángel Cruz', 'Miguel Cruz', NULL, '19', NULL, 'Guadalajara',
   'NUEVO', NULL, NULL, NULL, 'a0000000-0000-4000-8000-000000000001', NULL,
   FALSE, FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   FALSE, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '2 minutes'),

  ('d0000000-0000-4000-8000-000000000011', '5213310000011', 'Verónica Mora Lara', 'Vero Mora', NULL, '45', NULL, 'Guadalajara',
   'CARTERA_GENERAL', 'OPERADOR DE VEHÍCULO', 'SUCURSAL TLAQUEPAQUE', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   FALSE, FALSE, NULL, NULL, 'CARTERA_GENERAL', 'Edad: 45. Sin licencia tipo C: se guarda para otra vacante.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '4 days', NOW() - INTERVAL '2 days'),

  ('d0000000-0000-4000-8000-000000000012', '5213310000012', 'Héctor Domínguez', 'Héctor D.', NULL, '52', NULL, 'Chapala',
   'RECHAZADO', 'AYUDANTE GENERAL', 'MATRIZ GUADALAJARA', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'rec-laura',
   FALSE, FALSE, NULL, NULL, 'NO VIABLE', 'Edad: 52. Fuera del rango de edad de la vacante.', NULL, NULL, NULL, NULL, NULL,
   TRUE, NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days');

-- La alerta de identidad de Sofía la activa la captura de Expedientes (paso `run`).

-- Más entrevistas para el Calendario (mañana y pasado mañana).
INSERT INTO candidatos (id, telefono, nombre, nombre_chat, nombre_ine, edad, lugar_residencia, estado, vacante_interes, nave_interes, nave_id,
  empresa_id, asignado_a_id, tiene_cv, veredicto, resumen_ia, fecha_entrevista, privacidad_aceptada, created_at, ultima_interaccion)
VALUES
  ('d0000000-0000-4000-8000-000000000013', '5213310000013', 'Andrea Solís Vega', 'Andrea Solís', 'ANDREA SOLIS VEGA', '28', 'Zapopan', 'CITA_AGENDADA',
   'AYUDANTE GENERAL', 'MATRIZ GUADALAJARA', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'rec-laura', TRUE, 'VIABLE',
   'Edad: 28. Escolaridad: Preparatoria. Disponibilidad: Turno matutino.',
   to_char((NOW() AT TIME ZONE 'UTC')::date + 1 + TIME '16:00', 'YYYY-MM-DD"T"HH24:MI:SS'), TRUE, NOW() - INTERVAL '2 days', NOW() - INTERVAL '3 hours'),
  ('d0000000-0000-4000-8000-000000000014', '5213310000014', 'Ricardo Fuentes Mora', 'Ricardo Fuentes', 'RICARDO FUENTES MORA', '35', 'Tlaquepaque', 'RECORDATORIO_ENVIADO',
   'OPERADOR DE VEHÍCULO', 'SUCURSAL TLAQUEPAQUE', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'rec-laura', TRUE, 'VIABLE',
   'Edad: 35. Licencia: Tipo C vigente. Experiencia: 8 años en reparto.',
   to_char((NOW() AT TIME ZONE 'UTC')::date + 2 + TIME '18:30', 'YYYY-MM-DD"T"HH24:MI:SS'), TRUE, NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day');

-- ---------------------------------------------------------------------------
-- Conversaciones (ficticias)
-- ---------------------------------------------------------------------------
INSERT INTO conversation_history (candidato_id, telefono, role, message_type, content, timestamp) VALUES
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'user', 'text', 'Hola, vi la vacante de chofer', NOW() - INTERVAL '1 day'),
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'assistant', 'text', '¡Hola Jorge! Soy Sofía, asistente de reclutamiento de Grupo Industrial Demo. Tenemos la vacante de OPERADOR DE VEHÍCULO en Sucursal Tlaquepaque. ¿Cuentas con licencia tipo C vigente?', NOW() - INTERVAL '1 day' + INTERVAL '1 minute'),
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'user', 'text', 'Sí, la tengo vigente hasta 2028', NOW() - INTERVAL '1 day' + INTERVAL '3 minutes'),
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'assistant', 'text', 'Perfecto. El sueldo es de $2,800 semanales y el reparto es local. ¿Te gustaría agendar una entrevista?', NOW() - INTERVAL '1 day' + INTERVAL '4 minutes'),
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'user', 'text', 'Antes quiero saber a qué hora se sale los sábados, ¿puedo hablar con alguien?', NOW() - INTERVAL '13 minutes'),
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'assistant', 'text', 'Claro, Jorge. Le paso tu pregunta a una persona del equipo de reclutamiento y en breve te responde por aquí.', NOW() - INTERVAL '12 minutes'),

  ('d0000000-0000-4000-8000-000000000003', '5213310000003', 'user', 'text', 'Buenas tardes, ¿todavía hay trabajo de ayudante?', NOW() - INTERVAL '3 hours'),
  ('d0000000-0000-4000-8000-000000000003', '5213310000003', 'assistant', 'text', '¡Hola! Sí, tenemos la vacante de AYUDANTE GENERAL en Matriz Guadalajara, turno matutino, $2,100 semanales. ¿Qué edad tienes?', NOW() - INTERVAL '3 hours' + INTERVAL '1 minute'),
  ('d0000000-0000-4000-8000-000000000003', '5213310000003', 'user', 'text', 'Tengo 22 años', NOW() - INTERVAL '5 minutes'),

  ('d0000000-0000-4000-8000-000000000001', '5213310000001', 'user', 'text', 'Me interesa la de montacarguista', NOW() - INTERVAL '2 days'),
  ('d0000000-0000-4000-8000-000000000001', '5213310000001', 'assistant', 'text', '¡Excelente, Ana! Ya revisé tu CV y tus documentos. Tengo estos horarios para tu entrevista hoy: 11:00, 13:00 o 17:00. ¿Cuál prefieres?', NOW() - INTERVAL '40 minutes'),
  ('d0000000-0000-4000-8000-000000000001', '5213310000001', 'user', 'text', 'A las 17:00 por favor', NOW() - INTERVAL '36 minutes'),
  ('d0000000-0000-4000-8000-000000000001', '5213310000001', 'assistant', 'text', 'Listo, tu entrevista quedó agendada hoy a las 17:00 en CEDIS Zapopan. Te mando un recordatorio antes de la cita.', NOW() - INTERVAL '35 minutes'),

  ('d0000000-0000-4000-8000-000000000004', '5213310000004', 'user', 'text', 'Ya les mandé mi CV', NOW() - INTERVAL '1 hour'),
  ('d0000000-0000-4000-8000-000000000004', '5213310000004', 'assistant', 'text', 'Gracias, Roberto. Lo recibí. Ahora necesito una foto de tu INE por ambos lados.', NOW() - INTERVAL '59 minutes'),

  ('d0000000-0000-4000-8000-000000000010', '5213310000010', 'user', 'text', 'Hola', NOW() - INTERVAL '2 minutes'),

  ('d0000000-0000-4000-8000-000000000005', '5213310000005', 'assistant', 'text', 'Gracias, Daniela. Cumples con los requisitos. Ahora envíame tu INE para continuar.', NOW() - INTERVAL '2 hours'),
  ('d0000000-0000-4000-8000-000000000006', '5213310000006', 'assistant', 'text', 'Tu identidad quedó validada, Luis. ¿Qué día te acomoda para la entrevista?', NOW() - INTERVAL '4 hours'),
  ('d0000000-0000-4000-8000-000000000007', '5213310000007', 'user', 'text', 'Ya envié mi INE y la constancia', NOW() - INTERVAL '50 minutes');

INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, ultimo_mensaje_at, asignado_a_id, mensajes_no_leidos) VALUES
  ('d0000000-0000-4000-8000-000000000002', '5213310000002', 'Claro, Jorge. Le paso tu pregunta a una persona del equipo…', 'assistant', NOW() - INTERVAL '12 minutes', NULL, 2),
  ('d0000000-0000-4000-8000-000000000003', '5213310000003', 'Tengo 22 años', 'user', NOW() - INTERVAL '5 minutes', NULL, 1),
  ('d0000000-0000-4000-8000-000000000001', '5213310000001', 'Listo, tu entrevista quedó agendada hoy a las 17:00…', 'assistant', NOW() - INTERVAL '35 minutes', 'rec-laura', 0),
  ('d0000000-0000-4000-8000-000000000004', '5213310000004', 'Gracias, Roberto. Lo recibí. Ahora necesito una foto de tu INE…', 'assistant', NOW() - INTERVAL '59 minutes', 'rec-laura', 0),
  ('d0000000-0000-4000-8000-000000000010', '5213310000010', 'Hola', 'user', NOW() - INTERVAL '2 minutes', NULL, 1),
  ('d0000000-0000-4000-8000-000000000005', '5213310000005', 'Gracias, Daniela. Cumples con los requisitos…', 'assistant', NOW() - INTERVAL '2 hours', 'rec-laura', 0),
  ('d0000000-0000-4000-8000-000000000006', '5213310000006', 'Tu identidad quedó validada, Luis…', 'assistant', NOW() - INTERVAL '4 hours', 'rec-laura', 0),
  ('d0000000-0000-4000-8000-000000000007', '5213310000007', 'Ya envié mi INE y la constancia', 'user', NOW() - INTERVAL '50 minutes', 'rec-diego', 0);

-- ---------------------------------------------------------------------------
-- Notificaciones de Laura, con el mismo formato que generan el backend y el webhook
-- ---------------------------------------------------------------------------
INSERT INTO notificaciones (reclutador_id, mensaje, leida, created_at) VALUES
  ('rec-laura', '🚨 Atención humana requerida: Jorge Castillo Peña (OPERADOR DE VEHÍCULO)', FALSE, NOW() - INTERVAL '12 minutes'),
  ('rec-laura', '📅 Cita agendada: Ana Ramírez Soto para MONTACARGUISTA', FALSE, NOW() - INTERVAL '35 minutes'),
  ('rec-laura', E'⚠️ *Verificación de identidad requerida*

Candidato: Sofía Herrera Campos
Tel: wa.me/5213310000007
Vacante: MONTACARGUISTA

Diferencia menor en la CURP.

Revisa el candidato en la plataforma para validar o rechazar.', TRUE, NOW() - INTERVAL '50 minutes');
