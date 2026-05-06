/**
 * Abstraction localStorage avec gestion du quota.
 * Toutes les lectures/écritures de l'app passent par ce module.
 */

export const STORAGE_SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = 'geoint_schema_version';

let _onQuotaWarning = null;
let _onQuotaCritical = null;

export function initStorage({ onQuotaWarning, onQuotaCritical } = {}) {
  _onQuotaWarning = onQuotaWarning || null;
  _onQuotaCritical = onQuotaCritical || null;
  _checkSchemaVersion();
}

function _checkSchemaVersion() {
  const stored = parseInt(localStorage.getItem(SCHEMA_VERSION_KEY) || '0', 10);
  if (stored < STORAGE_SCHEMA_VERSION) {
    _migrateSchema(stored, STORAGE_SCHEMA_VERSION);
    localStorage.setItem(SCHEMA_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
  }
}

// Point d'extension : ajouter des migrations ici quand la structure évolue.
// ex: if (from < 2) { /* migrer v1 → v2 */ }
function _migrateSchema(from, _to) {
  if (from === 0) {
    // Premier lancement ou données antérieures au versioning : rien à migrer.
  }
}

export function storageGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (isQuotaError(e)) {
      _onQuotaWarning?.();
      // Nettoyage FIFO navLog sur tous les projets connus
      pruneNavLogs();
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e2) {
        if (isQuotaError(e2)) {
          _onQuotaCritical?.();
        }
        return false;
      }
    }
    return false;
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // rien
  }
}

function isQuotaError(e) {
  return (
    e instanceof DOMException &&
    (e.code === 22 ||
      e.code === 1014 ||
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/**
 * Supprime les 20 entrées navLog les plus anciennes sur chaque projet
 * pour libérer de l'espace.
 */
function pruneNavLogs() {
  const index = storageGet('geoint_index') || [];
  for (const id of index) {
    const project = storageGet(`geoint_project_${id}`);
    if (!project || !Array.isArray(project.navLog) || project.navLog.length <= 20) continue;
    project.navLog = project.navLog.slice(20);
    try {
      localStorage.setItem(`geoint_project_${id}`, JSON.stringify(project));
    } catch {
      // Si ça échoue encore, on laisse passer
    }
  }
}

