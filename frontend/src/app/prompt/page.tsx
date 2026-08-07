"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Save, RotateCcw, Eye, EyeOff, Sparkles, FileText, AlertCircle, CheckCircle } from "lucide-react";

export default function PromptEditorPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [empresaId, setEmpresaId] = useState("");
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [promptText, setPromptText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [previewMode, setPreviewMode] = useState(false);

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

  useEffect(() => {
    document.title = "Configurar Prompt IA | TCi";
    const role = localStorage.getItem("tci_role");
    if (role === "ROOT" || role === "ADMIN" || role === "ENCARGADO") {
      setIsAuthorized(true);
      fetchPrompt();
    } else {
      setIsAuthorized(false);
    }
  }, []);

  const fetchPrompt = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/db/empresas");
      const data = await res.json();
      if (data.empresas && data.empresas.length > 0) {
        const emp = data.empresas[0];
        setEmpresaId(emp.id);
        setEmpresaNombre(emp.nombre);
        setPromptText(emp.prompt_ia || "");
        setOriginalText(emp.prompt_ia || "");
      }
    } catch (err) {
      showToast("Error al cargar el prompt", true);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!empresaId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/db/empresas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: empresaId,
          nombre: empresaNombre,
          prompt_ia: promptText,
        }),
      });
      if (res.ok) {
        setOriginalText(promptText);
        showToast("Prompt guardado exitosamente ✨");
      } else {
        showToast("Error al guardar", true);
      }
    } catch (err) {
      showToast("Error de conexión", true);
    } finally {
      setSaving(false);
    }
  };

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
    [hasChanges, saving, promptText, empresaId]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (isAuthorized === null || loading) {
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
