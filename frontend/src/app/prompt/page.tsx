"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Save, RotateCcw, Eye, EyeOff, Sparkles, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { useIsHydrated, useLocalStorageValue } from "@/hooks/useLocalStorageValue";

export default function PromptEditorPage() {
  const router = useRouter();
  const hidratado = useIsHydrated();
  const rolGuardado = useLocalStorageValue("tci_role");
  // null hasta que hidrata (en el servidor no hay localStorage): la vista
  // muestra "cargando" mientras tanto y solo después decide si hay permiso.
  const isAuthorized = hidratado
    ? ["ROOT", "ADMIN", "ENCARGADO"].includes(rolGuardado || "")
    : null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [empresaId, setEmpresaId] = useState("");
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [promptText, setPromptText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  // true mientras se muestra la plantilla global porque la empresa todavía no
  // ha guardado un prompt propio.
  const [esPlantilla, setEsPlantilla] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  // Stats
  const charCount = promptText.length;
  const lineCount = promptText.split("\n").length;
  const hasChanges = promptText !== originalText;

  const fetchPrompt = useCallback(async () => {
    setLoading(true);
    try {
      // /api/prompts resuelve la empresa desde la sesión. Antes se pedía la
      // lista completa y se tomaba `empresas[0]`, así que un ADMIN podía
      // acabar editando el prompt de OTRA empresa.
      const res = await fetch("/api/prompts");
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al cargar el prompt", true);
        return;
      }
      setEmpresaId(data.empresa_id);
      setEmpresaNombre(data.empresa_nombre);
      setPromptText(data.prompt || "");
      // Cuando la empresa aún no tiene prompt propio se carga la plantilla
      // global; se deja `originalText` vacío para que el botón de guardar
      // aparezca habilitado y pueda adoptarla tal cual.
      setOriginalText(data.personalizado ? (data.prompt || "") : "");
      setEsPlantilla(!data.personalizado);
    } catch {
      showToast("Error al cargar el prompt", true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Configurar Prompt IA | TCi";
    if (!isAuthorized) return;
    const cargar = async () => { await fetchPrompt(); };
    cargar();
  }, [isAuthorized, fetchPrompt]);

  const handleSave = useCallback(async () => {
    if (!empresaId) return;
    setSaving(true);
    try {
      // PATCH, no PUT: /api/db/empresas nunca expuso PUT, así que el guardado
      // respondía 405 y el prompt jamás se modificaba.
      const res = await fetch("/api/prompts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa_id: empresaId, prompt: promptText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOriginalText(promptText);
        setEsPlantilla(false);
        showToast("Prompt guardado. El bot lo usará en el siguiente mensaje ✨");
      } else {
        showToast(data.error || "Error al guardar", true);
      }
    } catch {
      showToast("Error de conexión", true);
    } finally {
      setSaving(false);
    }
  }, [empresaId, empresaNombre, promptText]);

  const handleRevert = () => {
    if (confirm("¿Descartar todos los cambios y volver a la versión guardada?")) {
      setPromptText(originalText);
    }
  };

  // Keyboard shortcut: Ctrl+S
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges && !saving) handleSave();
      }
    },
    [hasChanges, saving, handleSave]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (isAuthorized === null || (isAuthorized && loading)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-400 font-medium animate-pulse">Cargando editor de prompt...</div>
      </div>
    );
  }

  if (isAuthorized === false) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-black/10 w-full max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Acceso Restringido</h1>
          <p className="text-slate-500 mb-6 text-sm">Necesitas permisos de administrador para configurar el prompt de la IA.</p>
          <button onClick={() => router.push("/")} className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors">
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-0 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-violet-100 text-violet-700 text-xs font-bold rounded-full mb-3 uppercase tracking-wider">
            <Sparkles size={14} /> Prompt de IA
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mb-1">
            Configurar Sofía
          </h1>
          <p className="text-slate-500 text-sm max-w-xl">
            Edita las instrucciones que recibe la IA para responder en WhatsApp. Empresa: <span className="font-bold text-slate-700">{empresaNombre}</span>
          </p>
          {esPlantilla && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-xl">
              Esta empresa aún no tiene un prompt propio: se muestra la plantilla
              general. Al guardar quedará como su versión personalizada.
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-colors"
          >
            {previewMode ? <EyeOff size={16} /> : <Eye size={16} />}
            {previewMode ? "Editar" : "Preview"}
          </button>

          <button
            onClick={handleRevert}
            disabled={!hasChanges}
            className={`flex items-center gap-2 px-4 py-2.5 font-semibold rounded-xl text-sm transition-all ${
              hasChanges
                ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "bg-slate-50 text-slate-300 cursor-not-allowed"
            }`}
          >
            <RotateCcw size={16} /> Descartar
          </button>

          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`flex items-center gap-2 px-6 py-2.5 font-bold rounded-xl text-sm transition-all shadow-lg ${
              hasChanges
                ? "bg-violet-600 hover:bg-violet-700 text-white shadow-violet-600/25 transform hover:-translate-y-0.5"
                : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
            }`}
          >
            <Save size={16} /> {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-t-xl">
        <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <FileText size={13} /> {lineCount} líneas
          </span>
          <span>{charCount.toLocaleString()} caracteres</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-400">Ctrl+S para guardar</span>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
              <AlertCircle size={12} /> Sin guardar
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              <CheckCircle size={12} /> Guardado
            </span>
          )}
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 min-h-0">
        {previewMode ? (
          <div className="bg-white border border-t-0 border-slate-200 rounded-b-xl p-6 overflow-y-auto h-[calc(100vh-320px)]">
            <div className="prose prose-slate prose-sm max-w-none whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-700">
              {promptText || <span className="text-slate-300 italic">El prompt está vacío...</span>}
            </div>
          </div>
        ) : (
          <textarea
            id="prompt-editor"
            name="prompt_ia"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            spellCheck={false}
            className="w-full bg-slate-900 text-slate-100 border border-t-0 border-slate-700 rounded-b-xl p-6 font-mono text-sm leading-relaxed resize-none outline-none focus:ring-2 focus:ring-violet-500/30 h-[calc(100vh-320px)] placeholder:text-slate-600"
            placeholder="Escribe aquí las instrucciones para Sofía..."
          />
        )}
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl font-semibold text-white shadow-xl transition-all duration-300 transform z-[200] ${
          toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
        } ${toast?.isError ? "bg-red-500" : "bg-slate-800"}`}
      >
        {toast?.msg}
      </div>
    </div>
  );
}
