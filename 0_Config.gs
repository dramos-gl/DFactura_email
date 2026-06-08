// =================================================================
// MODULO: CONFIGURACIÓN GLOBAL Y DICCIONARIOS DE NEGOCIO
// =================================================================

/**
 * CONTROL DE VERSIONES DEL ECOSISTEMA
 * @constant {string} VERSION_SISTEMA - Identificador de despliegue para auditoría de procesos.
 */
const VERSION_SISTEMA = "v7.3 - Arquitectura Modular y Renombrado Semántico";

/**
 * CONSTANTES DE RUTA Y SISTEMA DE ARCHIVOS (Drive)
 * Define las entidades de almacenamiento en la nube para el motor Drive.
 */
const CARPETA_CONTENEDORA_PRINCIPAL = "Facturas CFDI";
const NOMBRE_CARPETA_RAIZ           = "Descarga CFDI Recibidos";
const NOMBRE_HOJA_CALCULO           = "Registro de Facturas CFDI";
const NOMBRE_CARPETA_DESORGANIZADA  = "Facturas CFDI Recibidas"; // Usado para la carga local manual

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
    label: "Facturas Municipales/Cancún",
    hojaDestino: "Cancún",
    nombreCarpeta: "Cancún",
    remitentesAprobados: ["*"]
  },
  "PLAYA": {
    label: "Facturas Municipales/Playa",
    hojaDestino: "Playa",
    nombreCarpeta: "Playa del Carmen",
    remitentesAprobados: ["*"]
  },
  "TULUM": {
    label: "Facturas Municipales/Tulum",
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
  "Fecha Procesamiento",        // Col 1
  "ID Origen (Correo/Local)",   // Col 2
  "Fecha Emisión",              // Col 3
  "Asunto / Contexto",          // Col 4
  "RFC Emisor",                 // Col 5
  "Nombre Emisor",              // Col 6
  "RFC Receptor",               // Col 7
  "Nombre Receptor",            // Col 8
  "Serie-Folio",                // Col 9
  "UUID Fiscal",                // Col 10
  "Forma de Pago",              // Col 11
  "Método de Pago",             // Col 12
  "Uso CFDI",                   // Col 13
  "Total Facturado",            // Col 14
  "Clave Catastral",            // Col 15
  "Descripción / Conceptos",    // Col 16
  "Fecha Límite Pago",          // Col 17
  "Referencia Bancaria",        // Col 18
  "Nombre Archivo PDF",         // Col 19
  "Enlace PDF",                 // Col 20
  "Enlace XML",                 // Col 21
  "Hash XML"                    // Col 22 - nuevo campo para detección de duplicados en Drive
];

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
  // Must contain a hyphen (to differentiate from plain numeric SAT certificates)
  if (!clave.includes('-')) return false;
  // Remove any non‑digit characters (including hyphens)
  const soloDigitos = clave.replace(/[^0-9]/g, '');
  // Require at least 15 digits (covers typical formats like 801068006001006-)
  return soloDigitos.length >= 15;
}
