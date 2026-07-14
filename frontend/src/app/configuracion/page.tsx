"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PromptFile = {
  filename: string;
  content: string;
};

export default function ConfiguracionPage() {
  const router = useRouter();
  const [files, setFiles] = useState<PromptFile[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  // Autenticación simple para esta página
  const [isAuthValid, setIsAuthValid] = useState(false);

  useEffect(() => {
    document.title = "Configuración | TCi";
    const role = localStorage.getItem("tci_role");
    if (role !== "ADMIN") {
      setIsAuthValid(false);
    } else {
      setIsAuthValid(true);
      loadFiles();
    }
  }, [router]);

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prompts");
      const data = await res.json();
      if (data.success) {
        setFiles(data.files);
        if (data.files.length > 0 && !selectedFilename) {
          selectFile(data.files[0]);
        }
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast("Error al cargar los prompts", true);
    } finally {
      setLoading(false);
    }
  };

  const selectFile = (file: PromptFile) => {
    setSelectedFilename(file.filename);
    setCurrentContent(file.content);
  };

  const handleSave = async () => {
    if (!selectedFilename) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: selectedFilename, content: currentContent }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Archivo guardado correctamente", false);
        // Actualizar estado local
        setFiles((prev) =>
          prev.map((f) =>
            f.filename === selectedFilename ? { ...f, content: currentContent } : f
          )
        );
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast("Error al guardar archivo", true);
    } finally {
      setSaving(false);
    }
  };



  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando archivos...</div>;
  }

  if (!isAuthValid) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-black/10 w-full max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Acceso Restringido</h1>
          <p className="text-slate-500 mb-6 text-sm">No tienes permisos de Administrador para acceder a esta área.</p>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800">

      <main className="flex-1 flex overflow-hidden max-w-7xl w-full mx-auto p-6 gap-6">
        {/* Sidebar: Lista de Archivos */}
        <aside className="w-80 bg-white rounded-2xl border border-black/10 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-black/10 bg-slate-50">
            <h2 className="font-bold text-slate-700">Archivos (Prompts)</h2>
            <p className="text-xs text-slate-500 mt-1">Selecciona un archivo para editar su contenido.</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
            {files.map((file) => (
              <button
                key={file.filename}
                onClick={() => selectFile(file)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-all ${
                  selectedFilename === file.filename
                    ? "bg-primary text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {file.filename.includes(".md") ? "📝" : "📄"} {file.filename}
              </button>
            ))}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex-1 bg-white rounded-2xl border border-black/10 shadow-sm flex flex-col overflow-hidden">
          {selectedFilename ? (
            <>
              <div className="p-4 border-b border-black/10 flex justify-between items-center bg-slate-50">
                <div className="font-bold text-slate-700 text-lg">
                  Editando: <span className="text-indigo-600">{selectedFilename}</span>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-semibold rounded shadow-sm transition-all flex items-center gap-2"
                >
                  {saving ? "Guardando..." : "💾 Guardar Cambios"}
                </button>
              </div>
              <div className="flex-1 p-0 relative">
                <textarea
                  className="w-full h-full p-6 outline-none resize-none font-mono text-sm leading-relaxed text-slate-700 bg-transparent custom-scrollbar"
                  value={currentContent}
                  onChange={(e) => setCurrentContent(e.target.value)}
                  spellCheck="false"
                  placeholder="Escribe el contenido aquí..."
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              Selecciona un archivo de la lista para comenzar a editar
            </div>
          )}
        </section>
      </main>

      {/* Toast */}
      <div
        className={`fixed bottom-6 right-6 px-5 py-3 rounded font-semibold text-white shadow-xl transition-all duration-300 transform ${
          toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
        } ${toast?.isError ? "bg-danger" : "bg-success"}`}
      >
        {toast?.msg}
      </div>
    </div>
  );
}
