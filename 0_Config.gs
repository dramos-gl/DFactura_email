// =================================================================
// MODULO: CONFIGURACIÓN GLOBAL Y DICCIONARIOS DE NEGOCIO
// =================================================================

/**
 * CONTROL DE VERSIONES DEL ECOSISTEMA
 * @constant {string} VERSION_SISTEMA - Identificador de despliegue para auditoría de procesos.
 */
const VERSION_SISTEMA = "v9.1 - Prevención de Duplicados e Integridad de Formato";

/**
 * CONSTANTES DE RUTA Y SISTEMA DE ARCHIVOS (Drive)
 * Define las entidades de almacenamiento en la nube para el motor Drive.
 */
const CARPETA_CONTENEDORA_PRINCIPAL = "Facturas CFDI";
const NOMBRE_CARPETA_RAIZ           = "Descarga CFDI Recibidos";
const NOMBRE_HOJA_CALCULO           = "Registro de Facturas CFDI";
const NOMBRE_CARPETA_DESORGANIZADA  = "Facturas no Organizadas"; // Usado para la carga local manual

/**
 * CRONOLOGÍA CORPORATIVA
 * Nombres abreviados estandarizados para la creación automática de subcarpetas mensuales.
 */
const MESES_ABREVIADOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * MATRIZ DE CONFIGURACIÓN INTEGRAL DE MUNICIPIOS
 * Vincula la interfaz gráfica, las reglas de búsqueda en Gmail y las rutas de destino en Drive.
 * * CAMPOS POR NODO:
 * - label:               Etiqueta jerárquica exacta requerida en Gmail.
 * - hojaDestino:         Nombre exacto de la pestaña dentro del Spreadsheet.
 * - nombreCarpeta:       Carpeta física regional dentro del repositorio en Google Drive.
 * - remitentesAprobados: Remitentes autorizados para la query de Gmail (usar ["*"] para omitir filtro y aceptar cualquiera).
 */
const CONFIG_MUNICIPIOS = {
  "CANCUN": {
    label: "Facturas Municipios/Cancun",
    hojaDestino: "Cancun",
    nombreCarpeta: "Cancun",
    remitentesAprobados: ["*"]
  },
  "PLAYA": {
    label: "Facturas Municipios/Playa",
    hojaDestino: "Playa",
    nombreCarpeta: "Playa del Carmen",
    remitentesAprobados: ["*"]
  },
  "TULUM": {
    label: "Facturas Municipios/Tulum",
    hojaDestino: "Tulum",
    nombreCarpeta: "Tulum",
    remitentesAprobados: ["*"]
  }
};

/**
 * ESTRUCTURA UNIFICADA DE LA BASE DE DATOS (Spreadsheet)
 * Mapeo oficial y estricto de las 22 columnas del reporte corporativo.
 * El motor de Drive se sincronizará matemáticamente con este arreglo exacto.
 */
const ENCABEZADOS_ESTANDAR = [
  "Fecha Emisión",              // Col 1
  "Nombre Emisor",              // Col 2
  "Nombre Receptor",            // Col 3
  "Serie-Folio",                // Col 4
  "UUID Fiscal",                // Col 5
  "Forma de Pago",              // Col 6
  "Total Facturado",            // Col 7
  "Clave Catastral",            // Col 8
  "Descripción / Conceptos",    // Col 9
  "Fecha Límite Pago",          // Col 10
  "Referencia Bancaria",        // Col 11
  "Nombre Archivo PDF",         // Col 12
  "Enlace PDF",                 // Col 13
  "Enlace XML",                 // Col 14
  "Fecha Procesamiento",        // Col 15
  "ID Origen (Correo/Local)",   // Col 16
  "Hash XML"                    // Col 17
];

const ENCABEZADOS_CANCUN = [
  "Fecha Emisión",              // Col 1
  "Nombre Emisor",              // Col 2
  "Nombre Receptor",            // Col 3
  "Serie-Folio",                // Col 4
  "UUID Fiscal",                // Col 5
  "Forma de Pago",              // Col 6
  "Total Facturado",            // Col 7
  "Clave Catastral",            // Col 8
  "Descripción / Conceptos",    // Col 9
  "Fecha Límite Pago",          // Col 10
  "Referencia Bancaria",        // Col 11
  "Padrón",                     // Col 12 (Cancún exclusivo)
  "Nombre Archivo PDF",         // Col 13
  "Enlace PDF",                 // Col 14
  "Enlace XML",                 // Col 15
  "Fecha Procesamiento",        // Col 16
  "ID Origen (Correo/Local)",   // Col 17
  "Hash XML"                    // Col 18
];

function obtenerEncabezadosPorMunicipio(municipioClave) {
  if (municipioClave === "CANCUN") {
    return ENCABEZADOS_CANCUN;
  }
  return ENCABEZADOS_ESTANDAR;
}

/**
 * CATÁLOGO HOMOLOGADO DEL SAT: FORMAS DE PAGO (CFDI 4.0)
 * Traduce claves numéricas oficiales a descripciones contables legibles.
 */
const FORMAS_DE_PAGO_CATALOG = {
  '01': 'Efectivo',
  '02': 'Cheque nominativo',
  '03': 'Transferencia electrónica de fondos',
  '04': 'Tarjeta de crédito',
  '05': 'Monedero electrónico',
  '06': 'Dinero electrónico',
  '08': 'Vales de despensa',
  '12': 'Dación en pago',
  '13': 'Pago por subrogación',
  '14': 'Pago por consignación',
  '15': 'Condonación',
  '17': 'Compensación',
  '23': 'Novación',
  '24': 'Confusión',
  '25': 'Remisión de deuda',
  '26': 'Prescripción o caducidad',
  '27': 'A satisfacción del acreedor',
  '28': 'Tarjeta de débito',
  '29': 'Tarjeta de servicios',
  '30': 'Aplicación de anticipos',
  '99': 'Por definir'
};

/**
 * PATRÓN DE RENOMBRADO SEMÁNTICO INTELIGENTE (v7.3)
 * Catálogo controlado de palabras clave prioritarias para el renombrado de archivos.
 * El sistema buscará estas palabras en la descripción final purificada y usará la primera coincidencia.
 */
const CATALOGO_PALABRAS_RENOMBRADO = [
  "CEDULA", 
  "AVALUO", 
  "CONSTANCIA", 
  "PREDIAL", 
  "FUSION", 
  "SUBDIVISION",
  "DESLINDE", 
  "LICENCIA"
];

/**
 * CONCEPTO DE RESPALDO PARA RENOMBRADO
 * Término genérico de seguridad en caso de que la descripción no contenga ninguna palabra del catálogo.
 */
const RESPALDO_CONCEPTO_RENOMBRADO = "CONCEPTO";

// Utilidad para obtener un hash SHA‑256 hexadecimal del XML (uso interno para detección de duplicados)
function obtenerHashXml(xmlString) {
  // Utilities.computeDigest devuelve un Blob; convertimos a base‑64 y luego a hex
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, xmlString);
  // Convertir bytes a cadena hexadecimal
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * DETECTAR LÍMITE DE TIEMPO DINÁMICO (v7.4 Autocalibrado)
 * Identifica si el usuario ejecuta el script desde una cuenta estándar (@gmail.com) 
 * o un dominio corporativo de Google Workspace, asignando el umbral de seguridad adecuado.
 * @return {number} Límite seguro en milisegundos (27 minutos o 4.6 minutos).
 */
function obtenerLimiteTiempoProcesamientoMs() {
  const email = Session.getEffectiveUser().getEmail().toLowerCase();
  
  // Si termina en gmail.com o está vacío (triggers anónimos), límite estándar de 6 minutos
  if (email.endsWith("@gmail.com") || email.endsWith("@googlemail.com") || email === "") {
    return 280000; // 4.6 minutos de seguridad
  }
  
  // Dominio personalizado corporativo (Google Workspace), límite de 30 minutos
  return 1620000; // 27 minutos de seguridad
}

/* Helper to validate Clave Catastral */
function esClaveCatastralValida(clave) {
  if (!clave) return false;
  const limpia = clave.toString().trim().toUpperCase();
  
  // Regla 1: Nunca inicia con 0
  if (limpia.indexOf("0") === 0) return false;
  
  // Regla 2: Solo caracteres alfanuméricos y guiones
  const regexPermitido = /^[A-Z0-9\-]+$/;
  if (!regexPermitido.test(limpia)) return false;
  
  // Regla 3: Si contiene guión (Playa/Tulum)
  if (limpia.includes("-")) {
    const partes = limpia.split("-");
    // La base antes del guión debe tener exactamente 15 caracteres
    if (partes[0].length !== 15) return false;
    // El total incluyendo el guión debe ser de máximo 19 caracteres
    if (limpia.length < 16 || limpia.length > 19) return false;
    // No debe contener letras
    const tieneLetra = /[A-Z]/i.test(limpia);
    return !tieneLetra;
  } else {
    const digitosCount = (limpia.match(/\d/g) || []).length;
    const letrasCount = (limpia.match(/[A-Z]/g) || []).length;
    
    // Formato 1: 15 dígitos exactos numéricos (Playa/Tulum sin guion)
    if (limpia.length === 15) {
      return digitosCount === 15 && letrasCount === 0;
    }
    
    // Formato 2: 17 caracteres exactos para Cancún (16 números y 1 letra)
    if (limpia.length === 17) {
      return digitosCount === 16 && letrasCount === 1;
    }
    
    // Formato 3: 18 caracteres exactos para Cancún (18 números, o 17 números y 1 letra)
    if (limpia.length === 18) {
      const esTodoNumerico = (digitosCount === 18 && letrasCount === 0);
      const esAlfaNumerico = (digitosCount === 17 && letrasCount === 1);
      return esTodoNumerico || esAlfaNumerico;
    }
    
    return false;
  }
}

/* Helper to extract Padrón number from text (XML or PDF) */
function extraerPadronDeTexto(texto) {
  if (!texto) return "N/A";
  const match = texto.toString().match(/Padr\u00f3n\s*[:\-\.\s]*\s*(\d+)|Padron\s*[:\-\.\s]*\s*(\d+)/i);
  if (match) {
    return match[1] || match[2];
  }
  return "N/A";
}

