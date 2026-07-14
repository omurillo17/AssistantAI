"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Filter, Edit, Plus } from "lucide-react";

type Vacante = {
  id: string;
  nombre: string;
  naves: string[];
  detalles: string;
  activa: boolean;
  palabras_clave?: string;
};

type Recruiter = {
  reclutador_id: string;
  nombre: string;
  activo: boolean;
  telefono: string;
  calendar_id: string;
  color: string;
  usuario?: string;
  password?: string;
  vacantes: Vacante[];
};

const N8N_BASE_URL = "/api/n8n";
const API_URL = `/api/db/vacantes`; // Migrado a DB local

const COUNTRY_CODES = [
  { code: "52", label: "🇲🇽 +52" }, { code: "1", label: "🇺🇸/🇨🇦 +1" }, { code: "34", label: "🇪🇸 +34" },
  { code: "57", label: "🇨🇴 +57" }, { code: "54", label: "🇦🇷 +54" }, { code: "56", label: "🇨🇱 +56" },
  { code: "93", label: "🇦🇫 +93" }, { code: "355", label: "🇦🇱 +355" }, { code: "213", label: "🇩🇿 +213" },
  { code: "376", label: "🇦🇩 +376" }, { code: "244", label: "🇦🇴 +244" }, { code: "374", label: "🇦🇲 +374" },
  { code: "61", label: "🇦🇺 +61" }, { code: "43", label: "🇦🇹 +43" }, { code: "994", label: "🇦🇿 +994" },
  { code: "973", label: "🇧🇭 +973" }, { code: "880", label: "🇧🇩 +880" }, { code: "375", label: "🇧🇾 +375" },
  { code: "32", label: "🇧🇪 +32" }, { code: "501", label: "🇧🇿 +501" }, { code: "229", label: "🇧🇯 +229" },
  { code: "975", label: "🇧🇹 +975" }, { code: "591", label: "🇧🇴 +591" }, { code: "387", label: "🇧🇦 +387" },
  { code: "267", label: "🇧🇼 +267" }, { code: "55", label: "🇧🇷 +55" }, { code: "673", label: "🇧🇳 +673" },
  { code: "359", label: "🇧🇬 +359" }, { code: "226", label: "🇧🇫 +226" }, { code: "257", label: "🇧🇮 +257" },
  { code: "855", label: "🇰🇭 +855" }, { code: "237", label: "🇨🇲 +237" }, { code: "238", label: "🇨🇻 +238" },
  { code: "236", label: "🇨🇫 +236" }, { code: "235", label: "🇹🇩 +235" }, { code: "86", label: "🇨🇳 +86" },
  { code: "269", label: "🇰🇲 +269" }, { code: "242", label: "🇨🇬 +242" }, { code: "506", label: "🇨🇷 +506" },
  { code: "385", label: "🇭🇷 +385" }, { code: "53", label: "🇨🇺 +53" }, { code: "357", label: "🇨🇾 +357" },
  { code: "420", label: "🇨🇿 +420" }, { code: "45", label: "🇩🇰 +45" }, { code: "253", label: "🇩🇯 +253" },
  { code: "1809", label: "🇩🇴 +1" }, { code: "593", label: "🇪🇨 +593" }, { code: "20", label: "🇪🇬 +20" },
  { code: "503", label: "🇸🇻 +503" }, { code: "240", label: "🇬🇶 +240" }, { code: "291", label: "🇪🇷 +291" },
  { code: "372", label: "🇪🇪 +372" }, { code: "251", label: "🇪🇹 +251" }, { code: "679", label: "🇫🇯 +679" },
  { code: "358", label: "🇫🇮 +358" }, { code: "33", label: "🇫🇷 +33" }, { code: "241", label: "🇬🇦 +241" },
  { code: "220", label: "🇬🇲 +220" }, { code: "995", label: "🇬🇪 +995" }, { code: "49", label: "🇩🇪 +49" },
  { code: "233", label: "🇬🇭 +233" }, { code: "30", label: "🇬🇷 +30" }, { code: "502", label: "🇬🇹 +502" },
  { code: "224", label: "🇬🇳 +224" }, { code: "245", label: "🇬🇼 +245" }, { code: "592", label: "🇬🇾 +592" },
  { code: "509", label: "🇭🇹 +509" }, { code: "504", label: "🇭🇳 +504" }, { code: "36", label: "🇭🇺 +36" },
  { code: "354", label: "🇮🇸 +354" }, { code: "91", label: "🇮🇳 +91" }, { code: "62", label: "🇮🇩 +62" },
  { code: "98", label: "🇮🇷 +98" }, { code: "964", label: "🇮🇶 +964" }, { code: "353", label: "🇮🇪 +353" },
  { code: "972", label: "🇮🇱 +972" }, { code: "39", label: "🇮🇹 +39" }, { code: "225", label: "🇨🇮 +225" },
  { code: "1876", label: "🇯🇲 +1" }, { code: "81", label: "🇯🇵 +81" }, { code: "962", label: "🇯🇴 +962" },
  { code: "7", label: "🇰🇿/🇷🇺 +7" }, { code: "254", label: "🇰🇪 +254" }, { code: "686", label: "🇰🇮 +686" },
  { code: "965", label: "🇰🇼 +965" }, { code: "996", label: "🇰🇬 +996" }, { code: "856", label: "🇱🇦 +856" },
  { code: "371", label: "🇱🇻 +371" }, { code: "961", label: "🇱🇧 +961" }, { code: "266", label: "🇱🇸 +266" },
  { code: "231", label: "🇱🇷 +231" }, { code: "218", label: "🇱🇾 +218" }, { code: "423", label: "🇱🇮 +423" },
  { code: "370", label: "🇱🇹 +370" }, { code: "352", label: "🇱🇺 +352" }, { code: "261", label: "🇲🇬 +261" },
  { code: "265", label: "🇲🇼 +265" }, { code: "60", label: "🇲🇾 +60" }, { code: "960", label: "🇲🇻 +960" },
  { code: "223", label: "🇲🇱 +223" }, { code: "356", label: "🇲🇹 +356" }, { code: "692", label: "🇲🇭 +692" },
  { code: "222", label: "🇲🇷 +222" }, { code: "230", label: "🇲🇺 +230" }, { code: "691", label: "🇫🇲 +691" },
  { code: "373", label: "🇲🇩 +373" }, { code: "377", label: "🇲🇨 +377" }, { code: "976", label: "🇲🇳 +976" },
  { code: "382", label: "🇲🇪 +382" }, { code: "212", label: "🇲🇦 +212" }, { code: "258", label: "🇲🇿 +258" },
  { code: "95", label: "🇲🇲 +95" }, { code: "264", label: "🇳🇦 +264" }, { code: "674", label: "🇳🇷 +674" },
  { code: "977", label: "🇳🇵 +977" }, { code: "31", label: "🇳🇱 +31" }, { code: "64", label: "🇳🇿 +64" },
  { code: "505", label: "🇳🇮 +505" }, { code: "227", label: "🇳🇪 +227" }, { code: "234", label: "🇳🇬 +234" },
  { code: "850", label: "🇰🇵 +850" }, { code: "47", label: "🇳🇴 +47" }, { code: "968", label: "🇴🇲 +968" },
  { code: "92", label: "🇵🇰 +92" }, { code: "680", label: "🇵🇼 +680" }, { code: "507", label: "🇵🇦 +507" },
  { code: "675", label: "🇵🇬 +675" }, { code: "595", label: "🇵🇾 +595" }, { code: "51", label: "🇵🇪 +51" },
  { code: "63", label: "🇵🇭 +63" }, { code: "48", label: "🇵🇱 +48" }, { code: "351", label: "🇵🇹 +351" },
  { code: "974", label: "🇶🇦 +974" }, { code: "40", label: "🇷🇴 +40" }, { code: "250", label: "🇷🇼 +250" },
  { code: "378", label: "🇸🇲 +378" }, { code: "239", label: "🇸🇹 +239" }, { code: "966", label: "🇸🇦 +966" },
  { code: "221", label: "🇸🇳 +221" }, { code: "381", label: "🇷🇸 +381" }, { code: "248", label: "🇸🇨 +248" },
  { code: "232", label: "🇸🇱 +232" }, { code: "65", label: "🇸🇬 +65" }, { code: "421", label: "🇸🇰 +421" },
  { code: "386", label: "🇸🇮 +386" }, { code: "677", label: "🇸🇧 +677" }, { code: "252", label: "🇸🇴 +252" },
  { code: "27", label: "🇿🇦 +27" }, { code: "82", label: "🇰🇷 +82" }, { code: "211", label: "🇸🇸 +211" },
  { code: "94", label: "🇱🇰 +94" }, { code: "249", label: "🇸🇩 +249" }, { code: "597", label: "🇸🇷 +597" },
  { code: "268", label: "🇸🇿 +268" }, { code: "46", label: "🇸🇪 +46" }, { code: "41", label: "🇨🇭 +41" },
  { code: "963", label: "🇸🇾 +963" }, { code: "886", label: "🇹🇼 +886" }, { code: "992", label: "🇹🇯 +992" },
  { code: "255", label: "🇹🇿 +255" }, { code: "66", label: "🇹🇭 +66" }, { code: "228", label: "🇹🇬 +228" },
  { code: "676", label: "🇹🇴 +676" }, { code: "1868", label: "🇹🇹 +1" }, { code: "216", label: "🇹🇳 +216" },
  { code: "90", label: "🇹🇷 +90" }, { code: "993", label: "🇹🇲 +993" }, { code: "688", label: "🇹🇻 +688" },
  { code: "256", label: "🇺🇬 +256" }, { code: "380", label: "🇺🇦 +380" }, { code: "971", label: "🇦🇪 +971" },
  { code: "44", label: "🇬🇧 +44" }, { code: "598", label: "🇺🇾 +598" }, { code: "998", label: "🇺🇿 +998" },
  { code: "678", label: "🇻🇺 +678" }, { code: "58", label: "🇻🇪 +58" }, { code: "84", label: "🇻🇳 +84" },
  { code: "967", label: "🇾🇪 +967" }, { code: "260", label: "🇿🇲 +260" }, { code: "263", label: "🇿🇼 +263" }
];

export default function VacantesPage() {
  const router = useRouter();

  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myRecId, setMyRecId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);

  useEffect(() => {
    document.title = "Gestión de Vacantes | TCi";
    const auth = localStorage.getItem("tci_authenticated");
    if (!auth) {
      router.push("/login");
    } else {
      setIsAdmin(localStorage.getItem("tci_role") === "ADMIN");
      setMyRecId(localStorage.getItem("tci_reclutador_id"));
      loadData();
    }
  }, [router]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalRecruiterId, setModalRecruiterId] = useState<string | null>(null);
  const [modalVacancyId, setModalVacancyId] = useState<string | null>(null);

  const [vNombre, setVNombre] = useState("");
  const [vDetalles, setVDetalles] = useState("");
  const [vPalabrasClave, setVPalabrasClave] = useState("");
  const [vNaves, setVNaves] = useState<string[]>([]);

  // Recruiter Modal State
  const [isRecModalOpen, setIsRecModalOpen] = useState(false);
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [rNombre, setRNombre] = useState("");
  const [rCodigoPais, setRCodigoPais] = useState("52");
  const [rTelefonoNum, setRTelefonoNum] = useState("");
  const [rCalendar, setRCalendar] = useState("");
  const [rColor, setRColor] = useState("#6366f1");
  const [rUsuario, setRUsuario] = useState("");
  const [rPassword, setRPassword] = useState("");

  // Drag and Drop state
  const [draggedItem, setDraggedItem] = useState<{ recIndex: number; vacIndex: number } | null>(null);

  const showToast = (msg: string, isError: boolean) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const raw = Array.isArray(data) ? data : data.data || [];

      const normalized = raw.map((rec: any, i: number) => ({
        ...rec,
        reclutador_id: rec.reclutador_id || `rec_${i}_${Date.now()}`,
        activo: rec.activo !== false, // default to true
        telefono: rec.telefono || '',
        calendar_id: rec.calendar_id || '',
        color: rec.color || '#6366f1',
        usuario: rec.usuario || '',
        password: '',
        vacantes: (rec.vacantes || []).map((vac: any, j: number) => ({
          ...vac,
          id: vac.id || `vac_${i}_${j}_${Date.now()}`,
          activa: vac.activa !== false // default to true
        }))
      }));

      setRecruiters(normalized);
      showToast("Datos cargados", false);
    } catch (e) {
      showToast("Error al cargar datos de n8n.", true);
    } finally {
      setLoading(false);
    }
  };

  const saveData = async () => {
    try {
      showToast("Guardando...", false);
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recruiters),
      });
      if (!res.ok) throw new Error();
      showToast("✅ Cambios guardados con éxito", false);
    } catch (e) {
      showToast("❌ Error al guardar en n8n.", true);
    }
  };

  const toggleRecruiter = (recIndex: number) => {
    if (!isAdmin) return;
    const updated = [...recruiters];
    updated[recIndex].activo = !updated[recIndex].activo;
    setRecruiters(updated);
  };

  const toggleVacancy = (recIndex: number, vacIndex: number) => {
    const updated = [...recruiters];
    const isEditable = isAdmin || updated[recIndex].reclutador_id === myRecId;
    if (!isEditable) return;
    updated[recIndex].vacantes[vacIndex].activa = !updated[recIndex].vacantes[vacIndex].activa;
    setRecruiters(updated);
  };

  const openRecruiterModal = (rec?: Recruiter) => {
    if (rec) {
      setEditingRecId(rec.reclutador_id);
      setRNombre(rec.nombre);
      
      let tel = rec.telefono || "";
      let matchedCode = "52";
      let matchedNum = tel;
      const sortedCodes = [...COUNTRY_CODES].sort((a,b) => b.code.length - a.code.length);
      for (const c of sortedCodes) {
        if (tel.startsWith(c.code)) {
          matchedCode = c.code;
          matchedNum = tel.slice(c.code.length);
          break;
        }
      }
      setRCodigoPais(matchedCode);
      setRTelefonoNum(matchedNum);
      
      setRCalendar(rec.calendar_id);
      setRColor(rec.color);
      setRUsuario(rec.usuario || "");
      setRPassword("");
    } else {
      setEditingRecId(null);
      setRNombre("");
      setRCodigoPais("52");
      setRTelefonoNum("");
      setRCalendar("");
      setRColor("#6366f1");
      setRUsuario("");
      setRPassword("");
    }
    setIsRecModalOpen(true);
  };

  const saveRecruiter = () => {
    if (!rNombre.trim()) {
      showToast("Debes ingresar un nombre.", true);
      return;
    }
    const updated = [...recruiters];

    if (editingRecId) {
      // Editar
      const index = updated.findIndex(r => r.reclutador_id === editingRecId);
      if (index > -1) {
        updated[index].nombre = rNombre.toUpperCase();
        updated[index].telefono = rTelefonoNum ? rCodigoPais + rTelefonoNum : "";
        updated[index].calendar_id = rCalendar;
        updated[index].color = rColor;
        updated[index].usuario = rUsuario;
        if (rPassword) updated[index].password = rPassword;
      }
    } else {
      // Crear
      if (!rUsuario.trim() || !rPassword.trim()) {
        showToast("Debes ingresar un usuario y contraseña para el nuevo reclutador.", true);
        return;
      }
      updated.push({
        reclutador_id: "rec_" + Date.now().toString(),
        nombre: rNombre.toUpperCase(),
        telefono: rTelefonoNum ? rCodigoPais + rTelefonoNum : "",
        calendar_id: rCalendar,
        color: rColor,
        usuario: rUsuario,
        password: rPassword,
        activo: true,
        vacantes: []
      });
    }

    setRecruiters(updated);
    setIsRecModalOpen(false);
  };

  const removeRecruiter = (recIndex: number) => {
    if (!confirm("¿Seguro que deseas ELIMINAR este reclutador? SE BORRARÁN TODAS SUS VACANTES.")) return;
    const updated = [...recruiters];
    updated.splice(recIndex, 1);
    setRecruiters(updated);
  };

  const removeVacancy = (recIndex: number, vacIndex: number) => {
    if (!confirm("¿Seguro que deseas ELIMINAR esta vacante permanentemente?")) return;
    const updated = [...recruiters];
    updated[recIndex].vacantes.splice(vacIndex, 1);
    setRecruiters(updated);
  };

  const openModal = (recId: string, vac?: Vacante) => {
    setModalRecruiterId(recId);
    if (vac) {
      setModalVacancyId(vac.id);
      setVNombre(vac.nombre);
      setVDetalles(vac.detalles || "");
      setVPalabrasClave(vac.palabras_clave || "");
      setVNaves(Array.isArray(vac.naves) ? vac.naves : typeof vac.naves === "string" ? [vac.naves] : []);
    } else {
      setModalVacancyId(null);
      setVNombre("");
      setVDetalles("");
      setVPalabrasClave("");
      setVNaves([]);
    }
    setIsModalOpen(true);
  };

  const saveVacancy = () => {
    if (!vNombre.trim() || vNaves.length === 0) {
      showToast("Debes ingresar un nombre y seleccionar al menos una nave.", true);
      return;
    }
    const updated = [...recruiters];
    const recIndex = updated.findIndex((r) => r.reclutador_id === modalRecruiterId);
    if (recIndex === -1) return;

    if (modalVacancyId) {
      // Edit
      const vacIndex = updated[recIndex].vacantes.findIndex((v) => v.id === modalVacancyId);
      if (vacIndex > -1) {
        updated[recIndex].vacantes[vacIndex] = {
          ...updated[recIndex].vacantes[vacIndex],
          nombre: vNombre.toUpperCase(),
          detalles: vDetalles,
          palabras_clave: vPalabrasClave,
          naves: vNaves,
        };
      }
    } else {
      // Create
      updated[recIndex].vacantes.push({
        id: "v_" + Date.now().toString(),
        nombre: vNombre.toUpperCase(),
        detalles: vDetalles,
        palabras_clave: vPalabrasClave,
        naves: vNaves,
        activa: true,
      });
    }

    setRecruiters(updated);
    setIsModalOpen(false);
  };

  const toggleNave = (n: string) => {
    if (vNaves.includes(n)) {
      setVNaves(vNaves.filter((x) => x !== n));
    } else {
      setVNaves([...vNaves, n]);
    }
  };

  const handleDragStart = (recIndex: number, vacIndex: number) => {
    setDraggedItem({ recIndex, vacIndex });
  };

  const handleDrop = (e: React.DragEvent, targetRecIndex: number, targetVacIndex: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const updated = [...recruiters];
    const sourceList = updated[draggedItem.recIndex].vacantes;
    const targetList = updated[targetRecIndex].vacantes;

    const [moved] = sourceList.splice(draggedItem.vacIndex, 1);

    // Si lo movemos al final o a un array vacío
    if (targetVacIndex === -1) {
      targetList.push(moved);
    } else {
      targetList.splice(targetVacIndex, 0, moved);
    }

    setRecruiters(updated);
    setDraggedItem(null);
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Cargando...</div>;

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 px-10 pt-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded shadow-sm transition-colors text-sm border border-slate-200"
          >
            ⬅ Atrás
          </button>
          <h1 className="text-2xl font-bold text-slate-800">
            Gestión de Vacantes TCi
          </h1>
        </div>
        <div className="flex gap-4">
          {isAdmin && (
            <button onClick={() => openRecruiterModal()} className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded shadow-sm transition-all border border-indigo-200 flex items-center gap-2">
              <Plus size={18} /> Agregar Reclutador
            </button>
          )}
          <button onClick={loadData} className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded shadow-sm transition-all border border-slate-200">
            Descartar Cambios
          </button>
          <button onClick={saveData} className="px-4 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded shadow-sm transition-all">
            Guardar
          </button>
        </div>
      </div>

      <main className="flex-1 p-10 max-w-7xl mx-auto w-full">
        {loading ? (
          <div className="flex justify-center mt-20">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : isAdmin ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recruiters.map((rec, recIndex) => (
              <div
                key={rec.reclutador_id}
                className={`flex flex-col bg-white rounded-2xl border transition-all shadow-sm hover:shadow-md ${!rec.activo ? "border-red-500/30 opacity-75" : "border-black/10"}`}
                style={rec.activo ? { borderTop: `4px solid ${rec.color}` } : {}}
              >
                <div className={`p-5 border-b border-black/10 flex flex-col gap-3 rounded-t-2xl ${!rec.activo ? "bg-red-50" : "bg-slate-50"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">👤</span>
                      <h3 className={`font-bold text-lg ${!rec.activo ? "text-red-500" : "text-slate-800"}`}>{rec.nombre}</h3>
                    </div>
                    {(isAdmin || rec.reclutador_id === myRecId) && (
                      <div className="flex gap-2 items-center">
                        <button onClick={() => openRecruiterModal(rec)} className="text-slate-400 hover:text-indigo-600 transition-colors">
                          <Edit size={16} />
                        </button>
                        {isAdmin && (
                          <button onClick={() => removeRecruiter(recIndex)} className="text-slate-400 hover:text-red-600 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <label className={`flex items-center justify-end ${isAdmin ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}>
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={rec.activo} onChange={() => toggleRecruiter(recIndex)} disabled={!isAdmin} />
                      <div className={`block w-10 h-6 rounded-full transition-colors ${rec.activo ? "bg-primary" : "bg-slate-300"}`}></div>
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform flex items-center justify-center ${rec.activo ? "transform translate-x-4 text-primary" : "text-transparent"}`}>
                        <Check size={10} strokeWidth={4} className={rec.activo ? "opacity-100" : "opacity-0"} />
                      </div>
                    </div>
                  </label>
                </div>

                <div
                  className="p-5 flex-1 max-h-[400px] overflow-y-auto flex flex-col gap-3 custom-scrollbar min-h-[100px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, recIndex, -1)}
                >
                  {rec.vacantes.map((vac, vacIndex) => {
                    const isEditable = isAdmin || rec.reclutador_id === myRecId;
                    return (
                      <div
                        key={vac.id}
                        draggable={isEditable}
                        onDragStart={() => isEditable && handleDragStart(recIndex, vacIndex)}
                        onDragOver={(e) => isEditable && e.preventDefault()}
                        onDrop={(e) => {
                          if (!isEditable) return;
                          e.stopPropagation();
                          handleDrop(e, recIndex, vacIndex);
                        }}
                        className={`p-3 rounded-xl border transition-all ${isEditable ? "cursor-grab active:cursor-grabbing" : ""} ${!vac.activa ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-black/10 hover:bg-slate-50 hover:border-black/20"
                          }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-semibold text-[15px]">{vac.nombre}</div>
                          <input
                            type="checkbox"
                            className={`w-4 h-4 accent-indigo-500 ${isEditable ? "cursor-pointer" : "cursor-not-allowed"}`}
                            checked={vac.activa}
                            onChange={() => toggleVacancy(recIndex, vacIndex)}
                            disabled={!isEditable}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {Array.isArray(vac.naves) &&
                            vac.naves.map((n) => (
                              <span key={n} className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[11px] font-bold">
                                {n}
                              </span>
                            ))}
                        </div>
                        {vac.palabras_clave && (
                          <div className="text-[11px] text-slate-500 mb-3 italic">
                            <span className="font-semibold not-italic">Keywords: </span>
                            {vac.palabras_clave}
                          </div>
                        )}
                        <div className="flex gap-2 border-t border-black/5 pt-3">
                          {isEditable && (
                            <button onClick={() => openModal(rec.reclutador_id, vac)} className="text-xs bg-success hover:bg-success/90 text-white px-3 py-1.5 rounded font-semibold transition-colors">
                              Editar
                            </button>
                          )}
                          <button
                            onClick={() => router.push(`/vacantes/${vac.id}`)}
                            className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1.5 rounded font-semibold transition-colors flex items-center justify-center gap-1 flex-1"
                          >
                            <Filter size={12} /> Filtros{(vac as any).filtros?.filter((f: any) => f.activo).length > 0 ? ` (${(vac as any).filtros?.filter((f: any) => f.activo).length})` : ''}
                          </button>
                          {isEditable && (
                            <button onClick={() => removeVacancy(recIndex, vacIndex)} className="text-xs bg-danger hover:bg-danger/90 text-white px-3 py-1.5 rounded font-semibold transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {rec.activo && (isAdmin || rec.reclutador_id === myRecId) && (
                  <div className="p-4 border-t border-black/10 bg-slate-100/50 rounded-b-2xl">
                    <button onClick={() => openModal(rec.reclutador_id)} className="w-full py-2 border border-black/10 text-slate-700 font-semibold rounded-lg hover:bg-black/5 transition-colors">
                      + Añadir Vacante
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : recruiters.length > 0 ? (
          <div className="flex flex-col gap-4 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">Tus Vacantes</h2>
              <button onClick={() => openModal(recruiters[0].reclutador_id)} className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded shadow-sm transition-all border border-indigo-200 flex items-center gap-2">
                <Plus size={18} /> Añadir Vacante
              </button>
            </div>

            <div
              className="flex flex-col gap-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, 0, -1)}
            >
              {recruiters[0].vacantes.map((vac, vacIndex) => {
                const recIndex = 0;
                const isEditable = true;
                return (
                  <div
                    key={vac.id}
                    draggable={isEditable}
                    onDragStart={() => isEditable && handleDragStart(recIndex, vacIndex)}
                    onDragOver={(e) => isEditable && e.preventDefault()}
                    onDrop={(e) => {
                      if (!isEditable) return;
                      e.stopPropagation();
                      handleDrop(e, recIndex, vacIndex);
                    }}
                    className={`p-4 rounded-xl border transition-all ${isEditable ? "cursor-grab active:cursor-grabbing" : ""} ${!vac.activa ? "bg-slate-50 border-slate-200 opacity-60" : "bg-white border-black/10 hover:bg-slate-50 hover:border-black/20"
                      }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-semibold text-lg">{vac.nombre}</div>
                      <input
                        type="checkbox"
                        className={`w-5 h-5 accent-indigo-500 ${isEditable ? "cursor-pointer" : "cursor-not-allowed"}`}
                        checked={vac.activa}
                        onChange={() => toggleVacancy(recIndex, vacIndex)}
                        disabled={!isEditable}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {Array.isArray(vac.naves) &&
                        vac.naves.map((n) => (
                          <span key={n} className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold">
                            Nave {n}
                          </span>
                        ))}
                    </div>
                    {vac.palabras_clave && (
                      <div className="text-sm text-slate-500 mb-4 italic">
                        <span className="font-semibold not-italic">Keywords: </span>
                        {vac.palabras_clave}
                      </div>
                    )}
                    <div className="flex gap-3 border-t border-black/5 pt-4">
                      {isEditable && (
                        <button onClick={() => openModal(recruiters[0].reclutador_id, vac)} className="text-sm bg-success hover:bg-success/90 text-white px-4 py-2 rounded font-semibold transition-colors flex items-center gap-2">
                          <Edit size={16} /> Editar
                        </button>
                      )}
                      <button
                        onClick={() => router.push(`/vacantes/${vac.id}`)}
                        className="text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-4 py-2 rounded font-semibold transition-colors flex items-center gap-2"
                      >
                        <Filter size={16} /> Filtros{(vac as any).filtros?.filter((f: any) => f.activo).length > 0 ? ` (${(vac as any).filtros?.filter((f: any) => f.activo).length})` : ''}
                      </button>
                      {isEditable && (
                        <button onClick={() => removeVacancy(recIndex, vacIndex)} className="text-sm bg-danger hover:bg-danger/90 text-white px-4 py-2 rounded font-semibold transition-colors flex items-center gap-2">
                          <Trash2 size={16} /> Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {recruiters[0].vacantes.length === 0 && (
                <div className="text-center py-10 text-slate-500 bg-white border border-black/10 rounded-xl">
                  No tienes vacantes actualmente.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500">
            No se encontró información de tu cuenta.
          </div>
        )}
      </main>

      {/* Modal Añadir/Editar Vacante */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
              {modalVacancyId ? "Editar Vacante" : "Agregar Vacante"}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Nombre de la Vacante</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none uppercase transition-all shadow-sm"
                  placeholder="EJ: OPERADOR GENERAL"
                  value={vNombre}
                  onChange={(e) => setVNombre(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-2">Nave / Sucursal (Selecciona una o varias)</label>
                <div className="flex gap-4 p-4 bg-slate-50 border border-black/10 rounded-xl">
                  {["1", "2", "3"].map((n) => (
                    <label key={n} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-indigo-500"
                        checked={vNaves.includes(n)}
                        onChange={() => toggleNave(n)}
                      />
                      Nave {n}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Palabras Clave (Separadas por comas)</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="Ej: Chofer, Repartidor, Moto"
                  value={vPalabrasClave}
                  onChange={(e) => setVPalabrasClave(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">Si la IA lee estos nombres en el flyer, los relacionará con esta vacante.</p>
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Detalles (Sueldo, Horario, Requisitos)</label>
                <textarea
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none font-mono text-sm h-32 resize-y transition-all shadow-sm"
                  placeholder="-[REQUISITO EXCLUSIVO]&#10;-*Prestaciones de ley*&#10;-*$2,500 Semanales*..."
                  value={vDetalles}
                  onChange={(e) => setVDetalles(e.target.value)}
                ></textarea>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={saveVacancy} className="flex-1 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded shadow-sm transition-all">
                Guardar Vacante
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Añadir/Editar Reclutador */}
      {isRecModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4" onClick={() => setIsRecModalOpen(false)}>
          <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 md:p-8 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-black/10">
              {editingRecId ? "Editar Reclutador" : "Agregar Reclutador"}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Nombre</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none uppercase transition-all shadow-sm"
                  placeholder="EJ: Geronimo Murillo"
                  value={rNombre}
                  onChange={(e) => setRNombre(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Teléfono Whatsapp</label>
                <div className="flex gap-2">
                  <select
                    className="w-[120px] sm:w-[140px] p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm cursor-pointer"
                    value={rCodigoPais}
                    onChange={(e) => setRCodigoPais(e.target.value)}
                  >
                    {COUNTRY_CODES.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="flex-1 p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                    placeholder="3300000000"
                    value={rTelefonoNum}
                    onChange={(e) => setRTelefonoNum(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Correo Electrónico (Google Calendar ID)</label>
                <input
                  type="email"
                  className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="ejemplo@gmail.com"
                  value={rCalendar}
                  onChange={(e) => setRCalendar(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-500 font-medium mb-1">Color Identificador</label>
                <div className="flex items-center gap-4">
                  <input
                    type="color"
                    className="h-10 w-14 rounded cursor-pointer border-0 bg-transparent"
                    value={rColor}
                    onChange={(e) => setRColor(e.target.value)}
                  />
                  <span className="text-sm font-mono text-slate-500">{rColor}</span>
                </div>
              </div>

              {isAdmin && (
                <div className="pt-4 border-t border-black/10 space-y-4">
                  <h4 className="text-sm font-bold text-slate-800">Acceso al Sistema</h4>
                  <div>
                    <label className="block text-sm text-slate-500 font-medium mb-1">Usuario (Login)</label>
                    <input
                      type="text"
                      className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                      placeholder="usuario"
                      value={rUsuario}
                      onChange={(e) => setRUsuario(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-500 font-medium mb-1">
                      {editingRecId ? "Nueva Contraseña (deja en blanco para no cambiar)" : "Contraseña"}
                    </label>
                    <input
                      type="password"
                      className="w-full p-3 rounded-lg border border-black/10 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-sm"
                      placeholder="••••••••"
                      value={rPassword}
                      onChange={(e) => setRPassword(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setIsRecModalOpen(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors">
                Cancelar
              </button>
              <button onClick={saveRecruiter} className="flex-1 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded shadow-sm transition-all">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      <div className={`fixed bottom-6 right-6 px-5 py-3 rounded font-bold text-white shadow-xl transition-all duration-300 z-[2000] ${toast ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
        } ${toast?.isError ? "bg-danger" : "bg-success"}`}>
        {toast?.msg}
      </div>
    </div>
  );
}
