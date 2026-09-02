import { describe, expect, it } from "vitest";
import {
  cleanName,
  detectMediaUrl,
  formatNaveName,
  formatPhoneNumber,
  getCandidateDisplayName,
  proxyMediaUrl,
} from "@/lib/formatters";

describe("cleanName", () => {
  it("quita caracteres invisibles que llegan desde WhatsApp", () => {
    expect(cleanName("Ana️​")).toBe("Ana");
  });

  it("descarta los placeholders que no son un nombre real", () => {
    expect(cleanName("Candidato")).toBe("");
    expect(cleanName("No registrado")).toBe("");
    expect(cleanName("Desconocido")).toBe("");
  });

  it("descarta un teléfono usado como nombre", () => {
    expect(cleanName("+5215512345678")).toBe("");
    expect(cleanName("5512345678")).toBe("");
  });

  it("tolera nulo y vacío", () => {
    expect(cleanName(null)).toBe("");
    expect(cleanName(undefined)).toBe("");
    expect(cleanName("   ")).toBe("");
  });

  // Los casos de aquí abajo son pushnames reales de la tabla candidatos.
  it("conserva el nombre y le quita los emojis decorativos", () => {
    expect(cleanName("Michelle Torres\u{1F352}")).toBe("Michelle Torres");
    expect(cleanName("angel Ramirez \u{1F61C}\u{1F4A5}\u{2728}\u{1F4AF}")).toBe("angel Ramirez");
    expect(cleanName("\u{1F31F} JAVIER \u{1F31F}")).toBe("JAVIER");
    expect(cleanName("Carlos Monta\u00f1o \u270C\u{1F3FC}")).toBe("Carlos Monta\u00f1o");
    expect(cleanName("CAPC \u{1F1EB}\u{1F1EE}\u2694\uFE0F\u{1F977}\u{1F3FB}\u{1F98D}")).toBe("CAPC");
  });

  it("descarta el pushname que era puro emoji", () => {
    expect(cleanName("\u{1F339}\u{1F339}")).toBe("");
    expect(cleanName("\u{1F1F2}\u{1F1E8}\u{1F1F2}\u{1F1E8}")).toBe("");
  });

  it("normaliza el unicode decorativo a letras normales", () => {
    expect(cleanName("\u{1D4D2}\u{1D4D0}\u{1D4E1}\u{1D4E3}\u{1D4D4}\u{1D4E1}")).toBe("CARTER");
  });

  it("descarta los handles de red social, que no son un nombre", () => {
    expect(cleanName("cervantezgerardo91")).toBe("");
    expect(cleanName("joelharo01")).toBe("");
    expect(cleanName("Rdgoluv16")).toBe("");
  });

  it("descarta los placeholders aunque vengan envueltos en llaves", () => {
    expect(cleanName("{Desconocido}")).toBe("");
    expect(cleanName("{{{Desconocido}}}")).toBe("");
    expect(cleanName("{Candidato}")).toBe("");
  });

  it("respeta un nombre real escrito en otro alfabeto", () => {
    expect(cleanName("\u0623\u0644\u0641\u0631\u064A\u062F\u0648 \u0631\u0648\u064A\u0632")).toBe(
      "\u0623\u0644\u0641\u0631\u064A\u062F\u0648 \u0631\u0648\u064A\u0632"
    );
  });
});

describe("formatPhoneNumber", () => {
  it("formatea el móvil mexicano con prefijo 521", () => {
    expect(formatPhoneNumber("5215512345678")).toBe("+52 55 1234 5678");
  });

  it("formatea el número mexicano sin el 1", () => {
    expect(formatPhoneNumber("525512345678")).toBe("+52 55 1234 5678");
  });

  it("formatea 10 dígitos como número local", () => {
    expect(formatPhoneNumber("5512345678")).toBe("55 1234 5678");
  });

  it("ignora la puntuación antes de formatear", () => {
    expect(formatPhoneNumber("+52 (55) 1234-5678")).toBe("+52 55 1234 5678");
  });

  it("devuelve vacío para un LID largo de WhatsApp, que no es teléfono", () => {
    expect(formatPhoneNumber("12345678901234567")).toBe("");
  });
});

describe("getCandidateDisplayName", () => {
  it("prefiere el nombre del INE sobre el resto", () => {
    const nombre = getCandidateDisplayName({
      nombre_ine: "Ana López",
      nombre_solicitud: "Ana L.",
      nombre_chat: "Anita",
    });
    expect(nombre).toBe("Ana López");
  });

  it("respeta el orden INE > solicitud > constancia > chat > nombre", () => {
    expect(getCandidateDisplayName({ nombre_solicitud: "Ana L.", nombre_chat: "Anita" })).toBe("Ana L.");
    expect(getCandidateDisplayName({ nombre_constancia: "Ana C.", nombre_chat: "Anita" })).toBe("Ana C.");
    expect(getCandidateDisplayName({ nombre_chat: "Anita", nombre: "Ana" })).toBe("Anita");
  });

  it("salta los nombres que son placeholders y cae al siguiente", () => {
    expect(getCandidateDisplayName({ nombre_ine: "Candidato", nombre_chat: "Anita" })).toBe("Anita");
  });

  it("cae al teléfono formateado cuando no hay ningún nombre", () => {
    expect(getCandidateDisplayName({ telefono: "5215512345678" })).toBe("+52 55 1234 5678");
  });

  it("cae al teléfono cuando el pushname es puro emoji o un handle", () => {
    expect(
      getCandidateDisplayName({ nombre_chat: "\u{1F339}\u{1F339}", telefono: "5215512345678" })
    ).toBe("+52 55 1234 5678");
    expect(
      getCandidateDisplayName({ nombre_chat: "joelharo01", telefono: "5215512345678" })
    ).toBe("+52 55 1234 5678");
    expect(
      getCandidateDisplayName({ nombre_chat: "{Desconocido}", telefono: "5215512345678" })
    ).toBe("+52 55 1234 5678");
  });

  it("prefiere el nombre limpio antes que el teléfono", () => {
    expect(
      getCandidateDisplayName({ nombre_chat: "Michelle Torres\u{1F352}", telefono: "5215512345678" })
    ).toBe("Michelle Torres");
  });

  it("cae a 'Candidato' cuando no hay nombre ni teléfono usable", () => {
    expect(getCandidateDisplayName({})).toBe("Candidato");
    expect(getCandidateDisplayName({ telefono: "12345678901234567" })).toBe("Candidato");
  });
});

describe("formatNaveName", () => {
  it("traduce los ids numéricos a nombre de nave", () => {
    expect(formatNaveName("1")).toBe("DULCERIA");
    expect(formatNaveName("2")).toBe("CEDIS");
    expect(formatNaveName("3")).toBe("MATERIAS PRIMAS");
  });

  it("reconoce la nave escrita con acento o minúsculas", () => {
    expect(formatNaveName("dulcería")).toBe("DULCERIA");
    expect(formatNaveName("Nave 2")).toBe("CEDIS");
  });

  it("devuelve vacío cuando no reconoce la nave o es placeholder", () => {
    expect(formatNaveName("bodega norte")).toBe("");
    expect(formatNaveName("GENERAL")).toBe("");
  });
});

describe("proxyMediaUrl", () => {
  // El allowlist de /api/waha-media/[...path] solo acepta paths que empiecen
  // con "api/files/" o "files/". Si esta reescritura cambia y deja de producir
  // esos prefijos, la media deja de cargar en producción con un 403.
  it("reescribe la URL de WAHA al proxy interno conservando el prefijo permitido", () => {
    expect(proxyMediaUrl("http://waha:3000/api/files/default/audio.oga")).toBe(
      "/api/waha-media/api/files/default/audio.oga"
    );
    expect(proxyMediaUrl("http://localhost:3000/api/files/default/foto.jpg")).toBe(
      "/api/waha-media/api/files/default/foto.jpg"
    );
  });

  it("deja intactas las URLs que no son de WAHA", () => {
    expect(proxyMediaUrl("/uploads/cv.pdf")).toBe("/uploads/cv.pdf");
    expect(proxyMediaUrl("https://ejemplo.com/foto.jpg")).toBe("https://ejemplo.com/foto.jpg");
  });

  it("tolera nulo y vacío", () => {
    expect(proxyMediaUrl(null)).toBe("");
    expect(proxyMediaUrl("  ")).toBe("");
  });
});

describe("detectMediaUrl", () => {
  it("extrae la URL de un adjunto embebido en el texto", () => {
    expect(detectMediaUrl("mira esto http://waha:3000/api/files/default/cv.pdf gracias")).toBe(
      "http://waha:3000/api/files/default/cv.pdf"
    );
  });

  it("devuelve null cuando el mensaje es solo texto", () => {
    expect(detectMediaUrl("hola, sigo interesada")).toBeNull();
    expect(detectMediaUrl(null)).toBeNull();
  });
});
