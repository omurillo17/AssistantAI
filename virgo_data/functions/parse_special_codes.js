// === 1. CONFIGURACIÓN ===
const SPECIAL_CODES = {
  NAME_UPDATE: {
    pattern: /NAME_UPDATE\s*\|\s*([^|]+)\s*\|/i,
    action: 'update_name',
    field: 'nombre'
  },
  VACANTE_UPDATE: {
    pattern: /VACANTE_UPDATE\s*\|\s*([^|]+)\s*\|/i,
    action: 'update_vacante',
    field: 'vacante_interes'
  },
  CITA_CONFIRMADA: {
    pattern: /CITA_CONFIRMADA\s*\|/i,
    action: 'cita_confirmada',
    field: 'fecha_cita_detectada'
  },
  CON_CV: {
    pattern: /CON_CV\s*\|\s*([^|]+)\s*\|/i,
    action: 'cv_recibido',
    field: 'tiene_cv'
  },
  CV_MANUAL: {
    pattern: /CV_MANUAL\s*\|\s*(\{[^}]+\})/i,
    action: 'cv_manual',
    field: 'cv_data',
    isJSON: true
  },
  HUMAN_ALERT: {
    pattern: /HUMAN_ALERT\s*\|\s*([^|]+)\s*\|/i,
    action: 'escalate_to_human',
    field: 'escalation_reason'
  },
  MEMORY_UPDATE: {
    pattern: /MEMORY_UPDATE\s*\|\s*([^|]+)\s*\|/i,
    action: 'update_memory',
    field: 'resumen_ia'
  },
  CITA_CANCELADA: {
    pattern: /CITA_CANCELADA\s*\|/i,
    action: 'cita_cancelada',
    field: 'estado'
  }
};

// === 2. FUNCIONES AUXILIARES ===

function extractCode(text, codeConfig) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(codeConfig.pattern);
  if (!match) return null;

  let value = match[1]?.trim();

  if (codeConfig.isJSON && value) {
    try { value = JSON.parse(value); }
    catch (e) { console.error(`⚠️ Error JSON ${codeConfig.action}:`, value); return null; }
  }

  return {
    code: Object.keys(SPECIAL_CODES).find(k => SPECIAL_CODES[k] === codeConfig),
    action: codeConfig.action,
    field: codeConfig.field,
    value: value,
    raw_match: match[0]
  };
}

function cleanMessage(text, detectedCodes) {
  let cleaned = (typeof text === 'string') ? text : "";
  for (const code of detectedCodes) {
    cleaned = cleaned.replace(code.raw_match, '');
  }
  return cleaned.replace(/^\s+/g, '').replace(/\s+$/g, '').trim();
}

function generateDatabaseUpdates(detectedCodes, context) {
  const updates = {};
  const actions = [];

  for (const code of detectedCodes) {
    switch (code.action) {
      case 'update_name':
        updates.nombre = code.value;
        updates.nombre_confirmado = true;
        actions.push({ type: 'database_update', table: 'candidatos', field: 'nombre', value: code.value });
        break;
      case 'update_vacante':
        updates.vacante_interes = code.value;
        updates.estado = 'INTERESADO';
        actions.push({ type: 'database_update', table: 'candidatos', field: 'vacante_interes', value: code.value });
        break;
      case 'cita_confirmada':
        updates.estado = 'CITA_AGENDADA';
        updates.fecha_ultima_cita = new Date().toISOString();
        actions.push({ type: 'database_update', table: 'candidatos', field: 'estado', value: 'CITA_AGENDADA' });
        actions.push({ type: 'send_confirmation', channel: 'whatsapp' });
        break;
      case 'cv_recibido':
        updates.tiene_cv = true;
        updates.estado = 'CV_RECIBIDO';
        updates.vacante_cv = code.value;
        actions.push({ type: 'database_update', table: 'candidatos', field: 'tiene_cv', value: true });
        break;
      case 'cv_manual':
        updates.cv_manual = JSON.stringify(code.value);
        updates.tiene_cv = true;
        updates.estado = 'CV_MANUAL';
        actions.push({ type: 'database_update', table: 'candidatos', field: 'cv_manual', value: JSON.stringify(code.value) });
        break;
      case 'escalate_to_human':
        updates.estado = 'ESCALADO';
        updates.escalation_reason = code.value;
        updates.escalated_at = new Date().toISOString();
        actions.push({ type: 'alert_human', priority: 'high', reason: code.value });
        break;
      case 'update_memory':
        updates.resumen_ia = code.value;
        updates.ultima_actualizacion = new Date().toISOString();
        actions.push({ type: 'database_update', table: 'candidatos', field: 'resumen_ia', value: code.value });
        break;
      case 'cita_cancelada':
        updates.estado = 'INTERESADO';
        actions.push({ type: 'database_update', table: 'candidatos', field: 'estado', value: 'INTERESADO' });
        break;
    }
  }
  return { updates, actions };
}

// === 3. FUNCIÓN PRINCIPAL EXPORTADA ===

module.exports = function (aiResponse, context) {
  if (!aiResponse) {
    return {
      message_to_user: "",
      has_special_codes: false,
      detected_codes: [],
      pending_actions: []
    };
  }

  let textToParse = "";
  let jsonObj = null;

  if (typeof aiResponse === 'object' && aiResponse !== null) {
    jsonObj = aiResponse;
    textToParse = JSON.stringify(aiResponse);
  } else if (typeof aiResponse === 'string') {
    // Limpiar bloques Markdown ```json ... ``` que regresa Gemini/OpenAI
    const cleanStr = aiResponse
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    textToParse = cleanStr;

    // Intentar parsear JSON directo o extraer bloque JSON incrustado
    const jsonMatch = cleanStr.match(/\{[\s\S]*?"mensaje_al_usuario"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        jsonObj = JSON.parse(jsonMatch[0]);
      } catch (e) {}
    } else if (cleanStr.startsWith('{') && cleanStr.endsWith('}')) {
      try {
        jsonObj = JSON.parse(cleanStr);
      } catch (e) {}
    }
  } else {
    textToParse = String(aiResponse);
  }

  const detectedCodes = [];
  for (const [codeName, codeConfig] of Object.entries(SPECIAL_CODES)) {
    const extracted = extractCode(textToParse, codeConfig);
    if (extracted) {
      detectedCodes.push(extracted);
    }
  }

  let cleanedMessage = cleanMessage(textToParse, detectedCodes);
  if (jsonObj && jsonObj.mensaje_al_usuario) {
    cleanedMessage = jsonObj.mensaje_al_usuario;
  }

  const { updates, actions } = generateDatabaseUpdates(detectedCodes, context);

  if (jsonObj && jsonObj.memoria_update) {
    updates.resumen_ia = jsonObj.memoria_update;
    actions.push({ type: 'database_update', table: 'candidatos', field: 'resumen_ia', value: jsonObj.memoria_update });
  }

  return {
    message_to_user: cleanedMessage,
    detected_codes: detectedCodes.map(c => ({ code: c.code, action: c.action, value: c.value })),
    database_updates: updates,
    pending_actions: actions,
    text_para_whatsapp: cleanedMessage,
    nombre_detectado: updates.nombre,
    vacante_detectada: updates.vacante_interes,
    cita_creada: actions.some(a => a.type === 'send_confirmation'),
    cita_cancelada: detectedCodes.some(c => c.action === 'cita_cancelada'),
    motivo_final: updates.escalation_reason,
    es_cv_manual: !!updates.cv_manual,
    datos_cv_manual: updates.cv_manual ? JSON.parse(updates.cv_manual) : null,
    resumen_generado: updates.resumen_ia,
    has_special_codes: detectedCodes.length > 0 || (jsonObj && !!jsonObj.memoria_update),
    processed_at: new Date().toISOString(),
    _original_response: aiResponse
  };
};
