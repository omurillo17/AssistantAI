"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Phone,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Briefcase,
  MapPin,
  Check,
  Lock
} from "lucide-react";

type Empresa = {
  id: string;
  nombre: string;
  naves: { id: string; empresa_id: string; nombre: string }[];
};

type CandidatoEnc = {
  id: string;
  telefono: string;
  nombre: string;
  vacante_interes: string;
  nave_interes: string;
  estado: string;
  alerta_identidad_estado: string | null;
  alerta_identidad_motivo: string | null;
  tiene_cv: boolean;
  link_cv: string | null;
  tiene_archivos_previos?: boolean;
};

export default function PortalCandidatoPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);

  // Form states
  const [selectedEmpresaId, setSelectedEmpresaId] = useState("");
  const [selectedNaveId, setSelectedNaveId] = useState("");
  const [telefono, setTelefono] = useState("");

  const [searching, setSearching] = useState(false);
  const [candidato, setCandidato] = useState<CandidatoEnc | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState("");

  // Multi-file upload states
  const [fileIne, setFileIne] = useState<File | null>(null);
  const [fileRfc, setFileRfc] = useState<File | null>(null);
  const [fileCv, setFileCv] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    async function loadEmpresas() {
      try {
        const res = await fetch("/api/portal/empresas");
        if (res.ok) {
          const data = await res.json();
          setEmpresas(data.empresas || []);
          if (data.empresas?.length > 0) {
            setSelectedEmpresaId(data.empresas[0].id);
          }
        }
      } catch (err) {
        console.error("Error cargando empresas:", err);
      } finally {
        setLoadingEmpresas(false);
      }
    }
    loadEmpresas();
  }, []);

  const navesDisponibles = empresas.find(e => e.id === selectedEmpresaId)?.naves || [];

  const handleBuscar = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotFoundMsg("");
    setUploadError("");
    setSuccessMsg("");
    setFileIne(null);
    setFileRfc(null);
    setFileCv(null);

    if (!telefono || telefono.replace(/\D/g, "").length < 8) {
      setNotFoundMsg("Por favor ingresa un número de teléfono válido de 10 dígitos.");
      return;
    }

    setSearching(true);
    try {
      const res = await fetch("/api/portal/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefono,
          empresa_id: selectedEmpresaId || null,
          nave_id: selectedNaveId || null,
        }),
      });

      const data = await res.json();
      if (res.ok && data.encontrado) {
        setCandidato(data.candidato);
      } else {
        setCandidato(null);
        setNotFoundMsg(
          data.mensaje ||
          "No se encontró ninguna solicitud registrada con ese número. Tu proceso aún sigue esperando la autorización de un reclutador."
        );
      }
    } catch {
      setNotFoundMsg("Ocurrió un error al buscar tu solicitud. Intenta nuevamente.");
    } finally {
      setSearching(false);
    }
  };

  // Verificación de si se pueden enviar los archivos
  const necesitaCv = candidato ? !candidato.tiene_cv : true;
  const ineValida = fileIne !== null;
  const rfcValido = fileRfc !== null;
  const cvValido = !necesitaCv || fileCv !== null;

  const puedeEnviar = ineValida && rfcValido && cvValido;

  const handleSubirDocumentos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puedeEnviar || !candidato) {
      setUploadError("Debes adjuntar todos los documentos requeridos (INE y RFC obligatorios).");
      return;
    }

    setUploading(true);
    setUploadError("");
    setSuccessMsg("");

    try {
      const formData = new FormData();
      formData.append("telefono", candidato.telefono);
      if (fileIne) formData.append("file_ine", fileIne);
      if (fileRfc) formData.append("file_rfc", fileRfc);
      if (fileCv) formData.append("file_cv", fileCv);

      const res = await fetch("/api/portal/subir", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(data.mensaje || "¡Todos los documentos fueron enviados con éxito!");
        setCandidato(prev => prev ? { ...prev, estado: "INE_VALIDADA" } : null);
      } else {
        setUploadError(data.error || "Ocurrió un error al subir los documentos.");
      }
    } catch {
      setUploadError("Error de conexión al subir los archivos.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-full w-full bg-[#f3f3f3] text-slate-800 flex flex-col justify-between font-sans flex-1">
      {/* HEADER TCi */}
      <header className="bg-[#0c66ac] text-white shadow-md sticky top-0 z-30 shrink-0">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white text-[#0c66ac] font-black text-xl px-2.5 py-0.5 rounded-md shadow-xs">
              TCi
            </div>
            <div>
              <h1 className="font-extrabold text-base sm:text-lg leading-tight tracking-wide">Portal del Candidato</h1>
              <p className="text-[11px] sm:text-xs text-white/80">Recepción Oficial de Expedientes</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-white bg-white/10 px-3 py-1.5 rounded-full border border-white/20">
            <ShieldCheck size={14} className="shrink-0" /> <span className="hidden sm:inline">Canal Oficial</span>
          </div>
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-6 sm:py-10 flex-1 flex flex-col justify-start">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 md:p-10 shadow-lg space-y-6 sm:space-y-8">

          {/* PASO 1: BÚSQUEDA DE SOLICITUD */}
          {!candidato && !successMsg && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="text-center space-y-2">
                <span className="inline-block text-xs font-bold uppercase tracking-wider text-white bg-[#d41c6d] px-3 py-1 rounded-full shadow-xs">
                  Paso 1 de 2
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800">Identifica tu Solicitud</h2>
                <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                  Selecciona la empresa e ingresa el número telefónico que registraste en WhatsApp.
                </p>
              </div>

              <form onSubmit={handleBuscar} className="space-y-5">
                {/* EMPRESA / NAVE */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
                    <Building2 size={16} className="text-[#0c66ac]" /> Empresa
                  </label>
                  {loadingEmpresas ? (
                    <div className="h-12 bg-slate-100 animate-pulse rounded-xl"></div>
                  ) : (
                    <select
                      id="portal-empresa"
                      name="empresa"
                      value={selectedEmpresaId}
                      onChange={(e) => {
                        setSelectedEmpresaId(e.target.value);
                        setSelectedNaveId("");
                      }}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 font-bold focus:outline-none focus:border-[#0c66ac] focus:ring-2 focus:ring-[#0c66ac]/20 transition-all cursor-pointer shadow-xs text-sm sm:text-base"
                    >
                      {empresas.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* SUCURSAL / NAVE ESPECIFICA */}
                {navesDisponibles.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
                      <MapPin size={16} className="text-[#0c66ac]" /> Sucursal / Nave Específica (Opcional)
                    </label>
                    <select
                      id="portal-nave"
                      name="nave"
                      value={selectedNaveId}
                      onChange={(e) => setSelectedNaveId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 font-bold focus:outline-none focus:border-[#0c66ac] focus:ring-2 focus:ring-[#0c66ac]/20 transition-all cursor-pointer shadow-xs text-sm sm:text-base"
                    >
                      <option value="">Todas las sucursales de esta empresa</option>
                      {navesDisponibles.map((nave) => (
                        <option key={nave.id} value={nave.id}>
                          {nave.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* TELEFONO */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
                    <Phone size={16} className="text-[#0c66ac]" /> Número de Teléfono (10 dígitos)
                  </label>
                  <input
                    id="portal-telefono"
                    name="telefono"
                    type="tel"
                    placeholder="Ej. 33 3248 3278"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    className="w-full px-4 py-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono font-bold text-base sm:text-lg tracking-wider focus:outline-none focus:border-[#0c66ac] focus:ring-2 focus:ring-[#0c66ac]/20 transition-all placeholder:text-slate-400 placeholder:font-normal placeholder:text-sm shadow-xs"
                    required
                  />
                </div>

                {/* ERROR NOT FOUND */}
                {notFoundMsg && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs sm:text-sm flex items-start gap-3 shadow-xs">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold">{notFoundMsg}</p>
                      <p className="text-amber-700 text-[11px]">
                        Si tu expediente está en revisión, verifica que hayas seleccionado la empresa correcta o espera la indicación de tu reclutador.
                      </p>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={searching}
                  className="w-full py-3.5 bg-[#0c66ac] hover:bg-[#09518a] text-white font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 text-sm sm:text-base"
                >
                  {searching ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" /> Buscando solicitud...
                    </>
                  ) : (
                    <>
                      Buscar Solicitud <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* PASO 2: CARGA DE DOCUMENTOS INTELIGENTE */}
          {candidato && !successMsg && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-white bg-[#17afc6] px-3 py-1 rounded-full shadow-xs">
                  Paso 2 de 2: Adjuntar Documentación
                </span>
                <button
                  onClick={() => {
                    setCandidato(null);
                    setFileIne(null);
                    setFileRfc(null);
                    setFileCv(null);
                  }}
                  className="text-xs font-bold text-[#0c66ac] hover:underline transition-all"
                >
                  ← Cambiar de número
                </button>
              </div>

              {/* ENCABEZADO Y RESUMEN DEL CANDIDATO */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0c66ac]/10 text-[#0c66ac] flex items-center justify-center font-bold text-lg border border-[#0c66ac]/20 shrink-0">
                    <UserCheck size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base sm:text-lg font-bold text-slate-800 truncate">{candidato.nombre}</h3>
                    <p className="text-xs text-slate-500 font-mono">{candidato.telefono}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="text-slate-400 block mb-0.5 font-medium flex items-center gap-1">
                      <Briefcase size={12} className="text-[#0c66ac]" /> Vacante:
                    </span>
                    <span className="font-bold text-[#0c66ac]">{candidato.vacante_interes}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="text-slate-400 block mb-0.5 font-medium flex items-center gap-1">
                      <MapPin size={12} className="text-slate-500" /> Sucursal:
                    </span>
                    <span className="font-bold text-slate-700">{candidato.nave_interes}</span>
                  </div>
                </div>

                {candidato.alerta_identidad_motivo && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <span>{candidato.alerta_identidad_motivo}</span>
                  </div>
                )}

                {candidato.tiene_archivos_previos && (
                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2.5 shadow-xs">
                    <ShieldCheck size={18} className="text-[#0c66ac] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-extrabold block text-[#0c66ac]">🔒 Aviso de Protección y Reemplazo de Archivos</span>
                      <p className="text-[11px] text-blue-800 mt-0.5 leading-relaxed">
                        Detectamos que tu expediente ya contaba con archivos registrados previamente. Al subir nuevos documentos, los archivos anteriores serán <span className="font-bold">reemplazados y eliminados del servidor</span> para mantener tu información limpia y segura.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* SECCIÓN DE DOCUMENTOS REQUERIDOS */}
              <form onSubmit={handleSubirDocumentos} className="space-y-6">
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-800 mb-1">
                    Adjunta los Archivos Solicitados
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Es indispensable adjuntar <span className="font-bold text-slate-700">INE</span> y <span className="font-bold text-slate-700">Constancia RFC</span> para activar el botón de envío.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

                    {/* CAMPO 1: INE (OBLIGATORIO) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-[#0c66ac] transition-all">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText size={16} className="text-[#0c66ac]" /> 1. INE (Credencial)
                        </span>
                        {ineValida ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check size={12} /> Adjuntado
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            Requerido
                          </span>
                        )}
                      </div>

                      <div className="relative border-2 border-dashed border-slate-300 hover:border-[#0c66ac] rounded-xl p-4 text-center transition-colors bg-white cursor-pointer">
                        <input
                          id="portal-file-ine"
                          name="file_ine"
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => setFileIne(e.target.files?.[0] || null)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        <UploadCloud size={28} className="mx-auto text-[#0c66ac] mb-1" />
                        {fileIne ? (
                          <div className="text-xs font-bold text-emerald-700 truncate px-1">
                            📄 {fileIne.name}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 font-medium">
                            Subir foto o PDF del INE
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CAMPO 2: CONSTANCIA RFC (OBLIGATORIO) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-[#0c66ac] transition-all">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText size={16} className="text-[#0c66ac]" /> 2. Constancia RFC
                        </span>
                        {rfcValido ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check size={12} /> Adjuntado
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            Requerido
                          </span>
                        )}
                      </div>

                      <div className="relative border-2 border-dashed border-slate-300 hover:border-[#0c66ac] rounded-xl p-4 text-center transition-colors bg-white cursor-pointer">
                        <input
                          id="portal-file-rfc"
                          name="file_rfc"
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => setFileRfc(e.target.files?.[0] || null)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        <UploadCloud size={28} className="mx-auto text-[#0c66ac] mb-1" />
                        {fileRfc ? (
                          <div className="text-xs font-bold text-emerald-700 truncate px-1">
                            📄 {fileRfc.name}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 font-medium">
                            Subir Constancia o Cédula RFC
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CAMPO 3: CV / SOLICITUD DE EMPLEO (SOLO SI NO LO TIENE PREVIAMENTE) */}
                    {necesitaCv ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-[#0c66ac] transition-all">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                            <FileText size={16} className="text-[#0c66ac]" /> 3. CV / Solicitud
                          </span>
                          {fileCv ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Check size={12} /> Adjuntado
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                              Requerido
                            </span>
                          )}
                        </div>

                        <div className="relative border-2 border-dashed border-slate-300 hover:border-[#0c66ac] rounded-xl p-4 text-center transition-colors bg-white cursor-pointer">
                          <input
                            id="portal-file-cv"
                            name="file_cv"
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => setFileCv(e.target.files?.[0] || null)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                          <UploadCloud size={28} className="mx-auto text-[#0c66ac] mb-1" />
                          {fileCv ? (
                            <div className="text-xs font-bold text-emerald-700 truncate px-1">
                              📄 {fileCv.name}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500 font-medium">
                              Subir CV o foto de Solicitud
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* SI YA TIENE CV, SE MUESTRA COMO COMPLETADO/REGISTRADO */
                      <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4 flex flex-col justify-between space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                            <FileText size={16} className="text-emerald-600" /> 3. CV / Solicitud
                          </span>
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check size={12} /> Registrado
                          </span>
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-emerald-200/80 text-center space-y-1">
                          <Lock size={20} className="mx-auto text-emerald-600" />
                          <p className="text-xs font-bold text-emerald-800">
                            CV o Solicitud previamente entregada
                          </p>
                          <p className="text-[10px] text-emerald-700">
                            No es necesario adjuntarlo de nuevo.
                          </p>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {uploadError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-bold">
                    {uploadError}
                  </div>
                )}

                {/* BOTÓN CONFIRMAR Y ENVIAR */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!puedeEnviar || uploading}
                    className={`w-full py-4 rounded-xl font-extrabold transition-all shadow-md flex items-center justify-center gap-2 text-sm sm:text-base ${puedeEnviar && !uploading
                      ? "bg-[#b5c827] hover:bg-[#a2b420] text-slate-900 cursor-pointer active:scale-[0.99]"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                      }`}
                  >
                    {uploading ? (
                      <>
                        <RefreshCw size={18} className="animate-spin" /> Guardando expedientes...
                      </>
                    ) : puedeEnviar ? (
                      <>
                        <CheckCircle2 size={18} /> Confirmar y Enviar Documentos
                      </>
                    ) : (
                      <>
                        <Lock size={16} /> Adjunta INE y RFC para habilitar el envío
                      </>
                    )}
                  </button>

                  {!puedeEnviar && (
                    <p className="text-center text-[11px] text-slate-500 mt-2">
                      Falta por seleccionar: {!ineValida && "• INE "} {!rfcValido && "• Constancia RFC "} {!cvValido && "• CV/Solicitud "}
                    </p>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* PASO 3: MENSAJE DE ÉXITO */}
          {successMsg && (
            <div className="text-center py-6 sm:py-10 space-y-6 animate-fade-in max-w-lg mx-auto">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 border border-emerald-300 rounded-full flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 size={48} />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-800">¡Documentos Recibidos!</h3>
                <p className="text-xs sm:text-sm text-slate-600 font-medium">
                  {successMsg}
                </p>
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 text-left mt-4 space-y-1">
                  <span className="font-bold block">✓ Estado actualizado a: LISTO</span>
                  <p>
                    Se le ha permitido el acceso a tu expediente y se notificó al reclutador asignado para la validación final.
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setSuccessMsg("");
                  setCandidato(null);
                  setFileIne(null);
                  setFileRfc(null);
                  setFileCv(null);
                  setTelefono("");
                }}
                className="px-6 py-3 bg-[#0c66ac] hover:bg-[#09518a] text-white font-bold rounded-xl text-xs transition-colors shadow-sm"
              >
                Volver al inicio
              </button>
            </div>
          )}

        </div>
      </main>

      {/* FOOTER TCi */}
      <footer className="w-full max-w-4xl mx-auto px-4 py-6 text-center text-xs text-slate-500">
        Plataforma TCi © {new Date().getFullYear()} — Sistema de Reclutamiento por Seventeen Corp
      </footer>
    </div>
  );
}
